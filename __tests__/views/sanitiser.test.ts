/**
 * @jest-environment jsdom
 */

/**
 * Tests for the HTML sanitiser.
 *
 * The two things that matter:
 *   1. Allowed tags survive (formatters keep working).
 *   2. Disallowed tags + attributes are dropped (attacks neutralised).
 *
 * The attack tests are deliberately exhaustive — this is the file
 * that stops a malicious .ipt from running arbitrary code in the
 * user's vault.
 */

import {
    sanitiseHtmlToFragment,
    setSanitisedHtml,
    engineOutputToHtml,
} from "../../src/views/sanitiser";

function sanitise(input: string): string {
    const target = document.createElement("div");
    setSanitisedHtml(target, input);
    return target.innerHTML;
}

// ────────── Allowed formatting survives ──────────

describe("sanitiser: allowed tags", () => {
    test("plain text passes through unchanged", () => {
        expect(sanitise("hello world")).toBe("hello world");
    });

    test("bold", () => {
        expect(sanitise("<b>x</b>")).toBe("<b>x</b>");
    });

    test("italic", () => {
        expect(sanitise("<i>x</i>")).toBe("<i>x</i>");
    });

    test("underline", () => {
        expect(sanitise("<u>x</u>")).toBe("<u>x</u>");
    });

    test("br (void)", () => {
        // jsdom serialises <br> as <br> (no closing tag).
        const result = sanitise("a<br>b");
        expect(result).toContain("a");
        expect(result).toContain("b");
        expect(result).toMatch(/<br\s*\/?>/);
    });

    test("br self-closing form", () => {
        const result = sanitise("a<br />b");
        expect(result).toContain("a");
        expect(result).toContain("b");
        expect(result).toMatch(/<br\s*\/?>/);
    });

    test("nested formatting", () => {
        expect(sanitise("<b><i>x</i></b>")).toBe("<b><i>x</i></b>");
    });

    test("lists (real corpus shape)", () => {
        const out = sanitise("<ul><li>Coins: 5</li><li>Gems: 2</li></ul>");
        expect(out).toBe("<ul><li>Coins: 5</li><li>Gems: 2</li></ul>");
    });

    test("paragraphs and divs", () => {
        expect(sanitise("<p>a</p><div>b</div>")).toBe(
            "<p>a</p><div>b</div>"
        );
    });

    test("headings h1-h6", () => {
        expect(sanitise("<h1>a</h1><h6>b</h6>")).toBe("<h1>a</h1><h6>b</h6>");
    });

    test("tables", () => {
        const out = sanitise(
            "<table><tr><td>a</td><td>b</td></tr></table>"
        );
        // jsdom may add tbody implicitly; check structurally rather than
        // by exact string.
        expect(out).toContain("<table>");
        expect(out).toContain("<td>a</td>");
        expect(out).toContain("<td>b</td>");
    });

    test("BR (uppercase) tag name normalises to lowercase and is allowed", () => {
        // IPP3 corpora use <BR /> mixed case — we should accept that.
        const out = sanitise("a<BR />b");
        expect(out).toContain("a");
        expect(out).toContain("b");
        expect(out).toMatch(/<br\s*\/?>/);
    });
});

// ────────── Attack vectors blocked ──────────

describe("sanitiser: scripts are dropped", () => {
    test("script tag entirely removed including content", () => {
        const out = sanitise("before<script>alert(1)</script>after");
        expect(out).not.toContain("alert");
        expect(out).not.toContain("<script");
        // before/after text survives.
        expect(out).toContain("before");
        expect(out).toContain("after");
    });

    test("script tag with text-y content", () => {
        const out = sanitise(
            "good<script>document.cookie='stolen'</script>night"
        );
        expect(out).not.toContain("cookie");
        expect(out).not.toContain("stolen");
        expect(out).toContain("good");
        expect(out).toContain("night");
    });

    test("script with attributes", () => {
        const out = sanitise(
            "<script src='https://evil.example.com/x.js'></script>safe"
        );
        expect(out).not.toContain("script");
        expect(out).not.toContain("evil.example.com");
        expect(out).toContain("safe");
    });
});

describe("sanitiser: event handler attributes stripped", () => {
    test("onclick on a bold tag is removed", () => {
        // <b> survives, but its onclick attribute does NOT.
        const out = sanitise('<b onclick="alert(1)">x</b>');
        expect(out).toBe("<b>x</b>");
        expect(out).not.toContain("onclick");
        expect(out).not.toContain("alert");
    });

    test("onerror on an img tag — img itself is also disallowed", () => {
        const out = sanitise('<img src=x onerror="alert(1)">');
        expect(out).not.toContain("img");
        expect(out).not.toContain("onerror");
        expect(out).not.toContain("alert");
    });

    test("onmouseover on a span", () => {
        const out = sanitise('<span onmouseover="evil()">x</span>');
        // span survives because it's in the whitelist
        expect(out).toContain("<span>x</span>");
        expect(out).not.toContain("onmouseover");
        expect(out).not.toContain("evil");
    });

    test("style attribute stripped (could load remote URLs)", () => {
        const out = sanitise(
            '<div style="background:url(javascript:alert(1))">x</div>'
        );
        expect(out).toContain("<div>x</div>");
        expect(out).not.toContain("style");
        expect(out).not.toContain("javascript");
    });
});

describe("sanitiser: dangerous tags dropped", () => {
    test("iframe", () => {
        const out = sanitise(
            '<iframe src="https://evil.example.com"></iframe>fine'
        );
        expect(out).not.toContain("iframe");
        expect(out).not.toContain("evil");
        expect(out).toContain("fine");
    });

    test("object", () => {
        const out = sanitise(
            '<object data="bad.swf"></object>x'
        );
        expect(out).not.toContain("object");
        expect(out).toContain("x");
    });

    test("embed", () => {
        const out = sanitise('<embed src="bad.swf">x');
        expect(out).not.toContain("embed");
        expect(out).toContain("x");
    });

    test("link rel=stylesheet", () => {
        // <link> tags can pull in remote CSS that can execute JS in
        // some browsers via expression(). Drop entirely.
        const out = sanitise(
            '<link rel="stylesheet" href="https://evil.example.com/x.css">y'
        );
        expect(out).not.toContain("link");
        expect(out).not.toContain("evil");
        expect(out).toContain("y");
    });

    test("meta refresh", () => {
        const out = sanitise(
            '<meta http-equiv="refresh" content="0;url=https://evil.example.com">y'
        );
        expect(out).not.toContain("meta");
        expect(out).not.toContain("evil");
        expect(out).toContain("y");
    });

    test("form + input", () => {
        const out = sanitise(
            '<form action="https://evil.example.com"><input name="x"></form>y'
        );
        expect(out).not.toContain("form");
        expect(out).not.toContain("input");
        expect(out).not.toContain("evil");
        expect(out).toContain("y");
    });

    test("a tag — links not allowed in v0", () => {
        // <a> isn't on the whitelist. Generators that want links can
        // emit markdown-style [text](url) and we'd need to teach the
        // renderer to convert. For now, no links.
        const out = sanitise(
            '<a href="https://evil.example.com">click</a>y'
        );
        expect(out).not.toContain("<a");
        expect(out).not.toContain("href");
        expect(out).not.toContain("evil");
        expect(out).toContain("y");
    });
});

describe("sanitiser: comments + processing instructions dropped", () => {
    test("HTML comments removed", () => {
        const out = sanitise("<!-- evil thoughts --><b>safe</b>");
        expect(out).toBe("<b>safe</b>");
    });
});

describe("sanitiser: edge cases", () => {
    test("empty input yields empty output", () => {
        expect(sanitise("")).toBe("");
    });

    test("whitespace preserved", () => {
        expect(sanitise("  hi  ")).toBe("  hi  ");
    });

    test("HTML entities are decoded then re-encoded safely", () => {
        // &amp; should round-trip; &lt;script&gt; (entity-encoded) is
        // just literal text, NOT an actual script tag.
        const out = sanitise("a &amp; b &lt;script&gt;");
        expect(out).toContain("&amp;");
        // jsdom escapes < and > on output too; the key invariant:
        // there's no actual <script> tag, only its escaped form.
        expect(out).not.toMatch(/<script/i);
    });

    test("nested disallowed within allowed: drops just the disallowed", () => {
        const out = sanitise("<b>safe<script>alert(1)</script>also safe</b>");
        // The script tag and its content are gone; the surrounding
        // <b> with its safe text content survives.
        expect(out).toContain("<b>");
        expect(out).toContain("safe");
        expect(out).toContain("also safe");
        expect(out).not.toContain("alert");
        expect(out).not.toContain("script");
    });

    test("svg + onload — both stripped", () => {
        const out = sanitise('<svg onload="alert(1)"><circle/></svg>safe');
        expect(out).not.toContain("svg");
        expect(out).not.toContain("onload");
        expect(out).toContain("safe");
    });
});

// ────────── Direct fragment API ──────────

describe("sanitiseHtmlToFragment", () => {
    test("returns a DocumentFragment that can be appended", () => {
        const frag = sanitiseHtmlToFragment("<b>hi</b>");
        const target = document.createElement("div");
        target.appendChild(frag);
        expect(target.innerHTML).toBe("<b>hi</b>");
    });

    test("fragment is reusable across multiple appends only once (consumed on append)", () => {
        const frag = sanitiseHtmlToFragment("<b>x</b>");
        const a = document.createElement("div");
        a.appendChild(frag);
        // After appendChild, fragment is empty (this is standard DOM
        // behaviour). Verify the consumer pattern is what we expect.
        expect(frag.childNodes.length).toBe(0);
        expect(a.innerHTML).toBe("<b>x</b>");
    });
});

// ────────── engineOutputToHtml ──────────

/**
 * Tests for the engine-output→HTML translation. The engine emits
 * literal `\n` characters (from `\n` escapes in source content, and
 * from joining multi-rep results). Browsers' HTML parsers collapse
 * those newlines into single spaces during innerHTML assignment, so
 * without the translation a five-rep altar table renders as one
 * wall of text. Real-world bug.
 */
describe("engineOutputToHtml", () => {
    test("single \\n becomes <br>", () => {
        expect(engineOutputToHtml("line 1\nline 2")).toBe(
            "line 1<br>line 2"
        );
    });

    test("multiple \\n become multiple <br>", () => {
        expect(engineOutputToHtml("a\nb\nc")).toBe("a<br>b<br>c");
    });

    test("consecutive \\n\\n becomes <br><br>", () => {
        // Two newlines often signal a paragraph break in markdown.
        // We emit <br><br>; Obsidian's HTML-to-markdown converter
        // handles that as a paragraph break on paste.
        expect(engineOutputToHtml("a\n\nb")).toBe("a<br><br>b");
    });

    test("\\r\\n (Windows) is normalised first", () => {
        // Some IPP3 corpora were authored on Windows and have
        // CRLF line endings. Without normalising, we'd produce
        // `<br>\r<br>` which round-trips as a literal CR char.
        expect(engineOutputToHtml("a\r\nb")).toBe("a<br>b");
    });

    test("bare \\r (Mac classic) is normalised too", () => {
        expect(engineOutputToHtml("a\rb")).toBe("a<br>b");
    });

    test("preserves all non-newline content verbatim", () => {
        expect(engineOutputToHtml("<b>bold</b> text & symbols")).toBe(
            "<b>bold</b> text & symbols"
        );
    });

    test("empty input returns empty string", () => {
        expect(engineOutputToHtml("")).toBe("");
    });

    test("input with only newlines becomes only <br> tags", () => {
        expect(engineOutputToHtml("\n\n\n")).toBe("<br><br><br>");
    });
});

// ────────── setSanitisedHtml + newline preservation (end-to-end) ──────────

describe("setSanitisedHtml: newline preservation", () => {
    test("multi-line engine output renders with <br> separators", () => {
        // This is the bug scenario: a multi-rep table joins its
        // results with \n, the engine output reaches setSanitisedHtml
        // with literal newlines, and prior to the fix the HTML
        // parser collapsed those into spaces. Now they survive as
        // <br> tags.
        const target = document.createElement("div");
        setSanitisedHtml(target, "altar 1\naltar 2\naltar 3");
        // Three <br> tags between the four text segments? No — three
        // text segments separated by two <br>s. Verify by counting.
        const brs = target.querySelectorAll("br");
        expect(brs.length).toBe(2);
        // And the content is still all there.
        expect(target.textContent).toContain("altar 1");
        expect(target.textContent).toContain("altar 2");
        expect(target.textContent).toContain("altar 3");
    });

    test("formatted multi-line content keeps both tags and breaks", () => {
        // A roll might combine bold filter output with newlines —
        // verify both survive.
        const target = document.createElement("div");
        setSanitisedHtml(target, "<b>Bramath Guk</b>\nHit Points: 18");
        const bold = target.querySelector("b");
        expect(bold?.textContent).toBe("Bramath Guk");
        const brs = target.querySelectorAll("br");
        expect(brs.length).toBe(1);
    });
});
