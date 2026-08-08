# Testing Runbook

A human walkthrough of the demo, start to finish, in under ten minutes. If every box
here ticks, the demo does what it claims.

Covers v0.1 plus the v0.2 work that has landed. The quiz in §4 arrived with M11;
hosting is still to come (M13), so everything below is local.

Automated coverage is not this document's job — `./scripts/verify.sh` owns that, and
`client/e2e/smoke.spec.ts` already drives most of the path below in a headless
browser. What this is for is the part a person has to judge: whether the thing is
actually usable.

**Prerequisites:** `podman` and `distrobox` on the host, and `./scripts/dev.sh setup`
run once. Nothing else — no Rust, no Node, no SpacetimeDB on the host.

---

## 0. Gate (≈3 min, or ≈8 from cold)

```bash
./scripts/verify.sh
```

Expect `VERIFY GREEN  15 ran, 0 skipped`.

If `preflight` FAILs, stop and read it: it means the toolchain does not match the pins
in `scripts/toolchain-versions.sh`, and every stage after it would be testing something
other than what this repo specifies.

A stage reporting SKIP means its source directory is missing, which from v0.1 onward
means something is wrong with the checkout rather than the milestone. Cold runs are slower:
the Rust build and the Playwright browser download dominate.

- [ ] Gate is green, nothing skipped

---

## 1. Bring it up (≈1 min)

```bash
./scripts/deploy.sh local
```

This starts SpacetimeDB, publishes the module, regenerates the client bindings, seeds
the demo book, and serves the client. It runs in the foreground; **Ctrl-C stops
everything it started**. An instance already running on port 3000 is reused and left
running on exit.

Open <http://localhost:5173>.

- [ ] The page shows **Connected as** followed by a long hex identity

If it says *Connection lost — retrying…*, the database is not up: check
`.devhome/logs/spacetime.log`.

To start from nothing instead: `./scripts/deploy.sh local --clear`.

---

## 2. The book and its map (≈1 min)

On the landing page:

- [ ] Title **Chaos, Briefly** and a one-line description
- [ ] **6 chapters** and an *About N min read* estimate
- [ ] A map below it with six nodes and arrows between them

The graph is a diamond with two extras:

```
Foundations ──┬─> Attractors ──┬─> Synthesis ──> Appendix (pinned)
              └─> Bifurcation ─┘
              └─> Aside (optional)
```

Node badges: `○` available · `🔒` blocked · `◐` in progress · `✓` complete, plus `⭐`
optional and `📌` pinned.

- [ ] Foundations is `○`; Attractors, Bifurcation and Synthesis are `🔒`
- [ ] Aside carries `⭐`, Appendix carries `📌`
- [ ] Appendix is **not** `🔒`, even though it depends on Synthesis — that is what
      pinned means

---

## 3. Locked means locked (≈1 min)

Click the **Synthesis** node.

- [ ] The chapter says *This chapter is locked.* and shows no block content
- [ ] There is no way to mark anything complete

Copy that URL (`/chapter/N`), open it in a new tab, and load it directly.

- [ ] Still locked. The lock is not a link that was hidden from you.

---

## 4. Read something (≈2 min)

Back to the book, click **Foundations**.

- [ ] Three blocks, in order: *State and evolution*, *Sensitive dependence*, then
      *Check yourself*
- [ ] The first two render as formatted HTML — headings, paragraphs, a list — not as
      visible tags, and each has a **Mark as complete** button
- [ ] *Check yourself* has **no** Mark as complete button. It is a quiz, and the
      server refuses that call on one — see §4a

Mark the first two complete.

- [ ] Each button becomes *Completed* immediately, with no page reload

Click **Back to the book**.

- [ ] Foundations is `◐`, not `✓` — the quiz is not done
- [ ] Attractors and Bifurcation are still `🔒`

Open **Attractors** and note its third block is a resource link with an **Open
resource** link out to Wikipedia. (It is locked until §4a is finished; come back to
it then.)

---

## 4a. Earn the unlock (≈2 min)

**This is what v0.2 is for.** Completion is no longer something the reader asserts.

Back in **Foundations**, at *Check yourself*:

- [ ] Two questions. The first offers radio buttons — one answer — and the second
      checkboxes, because more than one of its answers is correct
- [ ] A pass mark of 100% is stated above them

Answer both **wrongly** and press **Submit answers**.

- [ ] It says *You scored 0%.* and *Not passed yet — try again.*
- [ ] Both questions are marked *You got this one wrong.* — which ones, not just how
      many
- [ ] The button now reads **Try again**

Click **Back to the book**.

- [ ] Foundations is still `◐` and Attractors still `🔒`. A failed quiz earns nothing.

Return to Foundations and answer both correctly — sensitive dependence for the first,
and both of the "trajectories…" options for the second.

- [ ] *You scored 100%.* and *Passed.*, with no question marked wrong
- [ ] The block shows *Completed* and the button reads **Take it again**: retakes are
      unlimited, and a pass is not undone by a later failure

Click **Back to the book**.

- [ ] Foundations is now `✓`
- [ ] Attractors and Bifurcation are now `○`
- [ ] Synthesis is still `🔒` — it waits for *both* arms of the diamond

Last, the thing the whole release rests on. Open the browser's devtools, and search
the page source and the network frames for the correct answers.

- [ ] The option *text* is there — the reader has to read it. Nothing anywhere says
      which option is correct. The answer key is in a table no client can subscribe
      to, and grading happened on the server

---

## 5. Two tabs, no reload (≈1 min)

**This is the load-bearing test.** It is item 4 of the Definition of Done.

Open a second tab on <http://localhost:5173> and arrange them side by side. Both tabs
share the identity token in localStorage, so they are the same reader.

- [ ] Both tabs show the same identity and the same node states

In tab A, open **Bifurcation** and mark both blocks complete.

- [ ] In tab B — untouched, not reloaded, not clicked — the map updates: Bifurcation
      becomes `✓` and **Synthesis** becomes `○`

If tab B needs a refresh to catch up, v0.1 has failed its central claim.

---

## 6. Author a book (≈2 min)

Click **Author** in the navigation.

- [ ] Your own books are listed (empty on a fresh identity), with a *New book* form
- [ ] **Chaos, Briefly** is *not* listed — it belongs to the seed script's identity

Create a book with any title, then open it from the list.

- [ ] It says *Draft — only you can see this book*
- [ ] Add two chapters; both appear in the list
- [ ] Add a block to the first chapter; it appears under that chapter
- [ ] Under the second chapter, tick the first chapter under **Depends on** and press
      **Save prerequisites**

Now the quiz surface. Under the first chapter's **New block** form, set **Type** to
**Quiz**, give it a title, and press **Create**.

- [ ] A **Quiz** form appears under that block and under no other block
- [ ] It starts with one question and two answer slots, numbered *Question 1*,
      *Answer 1*, *Answer 2*

Press **Save quiz** without filling anything in.

- [ ] It is refused, and the message names the problem by question number —
      *Question 1 has no text.* Nothing was validated in the browser; that sentence
      came from the reducer

Fill in the question and both answers, tick **Answer 1 is correct**, and save.

- [ ] Accepted. Press **Add a question** and note the new one is *Question 2* — the
      numbers the rejections use are the numbers on screen
- [ ] Saving again warns that it *replaces the quiz already on this block* and that
      the correct answers must be marked again. They cannot be read back: not even
      the author's browser can see the answer key

Now make a loop: under the *first* chapter, tick the second one and save.

- [ ] It is refused, and the message names the cycle — under that chapter's form only,
      not the other one

Press **Publish**.

- [ ] It changes to *Published — readers can see this book*, and the Publish button is
      gone. Publishing is one-way in v0.1.

Finally, check authorization is real rather than cosmetic: copy the `/author/book/N`
URL, open a **private/incognito window** (a fresh identity), and load it.

- [ ] It refuses with *That book does not exist, or is not yours* — the same message a
      missing book gets

---

## 7. Tear down

Ctrl-C in the terminal running `deploy.sh`.

- [ ] Both <http://localhost:5173> and <http://localhost:3000/v1/ping> stop responding

---

## If something fails

| Symptom | Look at |
|---|---|
| Client stuck on *Connecting…* | `.devhome/logs/spacetime.log`; is port 3000 up? |
| Landing page says no book is published | Re-run `./scripts/deploy.sh local` (the seed is idempotent) |
| Seed stops with *was seeded before the quiz block existed* | The local database predates v0.2. `./scripts/deploy.sh local --clear` |
| Map area blank or *could not be drawn* | Browser console — a Mermaid parse error means a chapter title broke the source builder |
| A reducer rejection you cannot explain | The message is the server's own; grep `server/src/rules.rs` for it |
| Ports still busy after Ctrl-C | `./scripts/dev.sh run 'fuser -k 3000/tcp; fuser -k 5173/tcp'` |
