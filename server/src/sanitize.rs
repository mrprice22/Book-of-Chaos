//! Server-side HTML sanitization.
//!
//! The trust boundary is the reducer, so block HTML is cleaned on write, once,
//! and the stored string is what every reader renders. Sanitizing on read would
//! mean the database holds hostile markup and every future consumer — an export,
//! a feed, a search index — has to remember to clean it again.
//!
//! Pure functions over plain strings: no SpacetimeDB types, so the interesting
//! cases are testable with `cargo test`.

use std::sync::OnceLock;

use ammonia::Builder;

/// The v0.1 allowlist: headings, paragraphs, lists, code, links, images.
///
/// Deliberately narrow. Anything not named here is stripped, which means the
/// failure mode of a tag we forgot is "the author's formatting vanished", not
/// "the reader ran someone else's script".
const ALLOWED_TAGS: &[&str] = &[
    // headings
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6", // text
    "p",
    "br",
    "hr",
    "strong",
    "em",
    "b",
    "i",
    "u",
    "s",
    "blockquote",
    // lists
    "ul",
    "ol",
    "li", // code
    "pre",
    "code", // links and images
    "a",
    "img",
];

/// `rel` and `target` are set by the builder, not accepted from the author.
const ALLOWED_ATTRS_A: &[&str] = &["href", "title"];
const ALLOWED_ATTRS_IMG: &[&str] = &["src", "alt", "title"];

/// `javascript:`, `data:` and friends are absent by construction. `data:` is
/// excluded even for images: a `data:` URI is an arbitrary payload the sanitizer
/// cannot inspect, and inline images are not worth that in v0.1.
const ALLOWED_SCHEMES: &[&str] = &["http", "https", "mailto"];

fn cleaner() -> &'static Builder<'static> {
    static CLEANER: OnceLock<Builder<'static>> = OnceLock::new();
    CLEANER.get_or_init(|| {
        let mut b = Builder::default();
        b.tags(ALLOWED_TAGS.iter().copied().collect())
            .generic_attributes(std::collections::HashSet::new())
            .url_schemes(ALLOWED_SCHEMES.iter().copied().collect())
            // Off-site links open in a new tab with the opener severed —
            // `rel` is forced here so an author cannot omit it.
            .link_rel(Some("noopener noreferrer nofollow"));
        let mut attrs = std::collections::HashMap::new();
        attrs.insert("a", ALLOWED_ATTRS_A.iter().copied().collect());
        attrs.insert("img", ALLOWED_ATTRS_IMG.iter().copied().collect());
        b.tag_attributes(attrs);
        b
    })
}

/// Strip everything outside the allowlist and return what is safe to render.
///
/// Never fails: hostile input yields empty or reduced output rather than an
/// error, because an author pasting from a word processor should get their text
/// through with the junk removed, not a rejection they cannot act on.
pub fn sanitize_html(input: &str) -> String {
    cleaner().clean(input).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_allowed_subset() {
        let input = "<h2>Attractors</h2><p>A <strong>strange</strong> one.</p>\
                     <ul><li>first</li></ul><pre><code>x = 1</code></pre>";
        assert_eq!(sanitize_html(input), input);
    }

    #[test]
    fn strips_script_tags_and_their_contents() {
        let out = sanitize_html("<p>hi</p><script>alert(1)</script>");
        assert!(!out.contains("script"), "{out}");
        assert!(!out.contains("alert"), "script body survived: {out}");
        assert!(out.contains("hi"));
    }

    #[test]
    fn strips_event_handler_attributes() {
        let out = sanitize_html(r#"<p onclick="steal()">text</p>"#);
        assert!(!out.contains("onclick"), "{out}");
        assert!(out.contains("text"));
    }

    #[test]
    fn strips_javascript_urls() {
        let out = sanitize_html(r#"<a href="javascript:alert(1)">click</a>"#);
        assert!(!out.contains("javascript"), "{out}");
        // The text survives even though the link does not.
        assert!(out.contains("click"), "{out}");
    }

    #[test]
    fn strips_data_uri_images() {
        let out = sanitize_html(r#"<img src="data:text/html;base64,PHNjcmlwdD4=">"#);
        assert!(!out.contains("data:"), "{out}");
    }

    #[test]
    fn keeps_http_links_and_forces_rel() {
        let out = sanitize_html(r#"<a href="https://example.com">docs</a>"#);
        assert!(out.contains("https://example.com"), "{out}");
        assert!(out.contains("noopener"), "rel not applied: {out}");
    }

    #[test]
    fn strips_iframes_objects_and_style() {
        for hostile in [
            r#"<iframe src="https://evil.example"></iframe>"#,
            r#"<object data="x"></object>"#,
            r#"<style>body{display:none}</style>"#,
            r#"<form action="/x"><input name="p"></form>"#,
        ] {
            let out = sanitize_html(hostile);
            assert!(
                !out.contains("iframe")
                    && !out.contains("object")
                    && !out.contains("display:none")
                    && !out.contains("<input"),
                "hostile markup survived: {hostile} -> {out}"
            );
        }
    }

    #[test]
    fn strips_presentational_attributes() {
        // No generic attributes: class/style/id are not an author-controlled
        // surface in v0.1 (themes and custom CSS are deferred).
        let out = sanitize_html(r#"<p class="x" style="color:red" id="y">t</p>"#);
        assert_eq!(out, "<p>t</p>");
    }

    #[test]
    fn is_idempotent() {
        // Sanitizing stored output again must not degrade it — updates re-clean
        // whatever the client echoed back.
        let once = sanitize_html(r#"<p>a</p><a href="https://e.com">b</a><script>x</script>"#);
        assert_eq!(sanitize_html(&once), once);
    }

    #[test]
    fn handles_empty_and_plain_text() {
        assert_eq!(sanitize_html(""), "");
        assert_eq!(sanitize_html("just words"), "just words");
    }
}
