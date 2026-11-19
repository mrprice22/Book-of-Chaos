//! M14.4 spike: does a subscription filtered by `work_id` and `branch_id` keep a client
//! from receiving every work's every node?
//!
//! Two shapes, because v0.3 needs both:
//!
//! - `pub_nodes` is a plain public table. This is the easy case.
//! - `nodes` is private, and `visible_nodes` is a `ViewContext` view returning the nodes
//!   on public branches plus the caller's own branches. Private branches (M17.2) force
//!   this shape, so the question is whether a `WHERE` on a *view* is also applied
//!   server-side.

use spacetimedb::{Identity, ReducerContext, Table, ViewContext, reducer, table, view};

#[table(accessor = pub_nodes, public)]
pub struct PubNode {
    #[primary_key]
    #[auto_inc]
    id: u64,
    #[index(btree)]
    work_id: u64,
    #[index(btree)]
    branch_id: u64,
    body: String,
}

#[table(accessor = branches, public)]
pub struct Branch {
    #[primary_key]
    branch_id: u64,
    work_id: u64,
    #[index(btree)]
    owner: Identity,
    #[index(btree)]
    is_public: bool,
}

#[table(accessor = nodes)]
#[derive(Clone)]
pub struct Node {
    #[primary_key]
    #[auto_inc]
    id: u64,
    #[index(btree)]
    work_id: u64,
    #[index(btree)]
    branch_id: u64,
    body: String,
}

/// `works` works, each with `branches_per_work` branches of `nodes_per_branch` nodes,
/// written to both tables. The last branch of each work is private to the caller.
/// Branch ids are `work_id * 100 + n`, so a probe can name one without a lookup.
#[reducer]
pub fn seed(
    ctx: &ReducerContext,
    works: u64,
    branches_per_work: u64,
    nodes_per_branch: u64,
) -> Result<(), String> {
    for work_id in 1..=works {
        for n in 1..=branches_per_work {
            let branch_id = work_id * 100 + n;
            ctx.db.branches().insert(Branch {
                branch_id,
                work_id,
                owner: ctx.sender(),
                is_public: n != branches_per_work,
            });
            for i in 0..nodes_per_branch {
                let body = format!("w{work_id} b{branch_id} n{i}");
                ctx.db.pub_nodes().insert(PubNode {
                    id: 0,
                    work_id,
                    branch_id,
                    body: body.clone(),
                });
                ctx.db.nodes().insert(Node {
                    id: 0,
                    work_id,
                    branch_id,
                    body,
                });
            }
        }
    }
    Ok(())
}

/// One node on one branch, in both tables: the live-update probe.
#[reducer]
pub fn append(
    ctx: &ReducerContext,
    work_id: u64,
    branch_id: u64,
    body: String,
) -> Result<(), String> {
    ctx.db.pub_nodes().insert(PubNode {
        id: 0,
        work_id,
        branch_id,
        body: body.clone(),
    });
    ctx.db.nodes().insert(Node {
        id: 0,
        work_id,
        branch_id,
        body,
    });
    Ok(())
}

#[view(accessor = visible_nodes, public)]
fn visible_nodes(ctx: &ViewContext) -> Vec<Node> {
    let me = ctx.sender();
    let public = ctx.db.branches().is_public().filter(true);
    let mine = ctx
        .db
        .branches()
        .owner()
        .filter(me)
        .filter(|b| !b.is_public);
    public
        .chain(mine)
        .flat_map(|b| ctx.db.nodes().branch_id().filter(b.branch_id))
        .collect()
}
