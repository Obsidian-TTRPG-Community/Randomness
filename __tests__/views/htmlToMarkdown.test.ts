/**
 * @jest-environment jsdom
 */

/**
 * Tests for the engine-HTML → markdown converter used by the
 * result-panel Copy button.
 *
 * Context: Copy used to put a `text/html` flavour on the clipboard
 * and let Obsidian convert it on paste. Android's WebView returns
 * that flavour as a *file*, so Obsidian saved it to the attachment
 * folder as `tempNNNN.html` and pasted a link instead of the text.
 * We now convert here and write plain text only, which makes this
 * module the thing that has to preserve formatting.
 *
 * The tag vocabulary tracks ALLOWED_TAGS in sanitiser.ts.
 */

import { htmlToMarkdown } from "../../src/views/htmlToMarkdown";

describe("htmlToMarkdown — inline formatting", () => {
    test("bold and strong become **", () => {
        expect(htmlToMarkdown("<b>hi</b>")).toBe("**hi**");
        expect(htmlToMarkdown("<strong>hi</strong>")).toBe("**hi**");
    });

    test("italic and em become *", () => {
        expect(htmlToMarkdown("<i>hi</i>")).toBe("*hi*");
        expect(htmlToMarkdown("<em>hi</em>")).toBe("*hi*");
    });

    test("strikethrough variants become ~~", () => {
        expect(htmlToMarkdown("<s>hi</s>")).toBe("~~hi~~");
        expect(htmlToMarkdown("<strike>hi</strike>")).toBe("~~hi~~");
        expect(htmlToMarkdown("<del>hi</del>")).toBe("~~hi~~");
    });

    test("code becomes a backtick span", () => {
        expect(htmlToMarkdown("<code>x</code>")).toBe("`x`");
    });

    test("nested emphasis nests", () => {
        expect(htmlToMarkdown("<b>bold <i>both</i></b>")).toBe(
            "**bold *both***"
        );
    });

    test("delimiters hug the text, spaces pushed outside", () => {
        // CommonMark: "** hi **" is literal asterisks, not emphasis.
        expect(htmlToMarkdown("a<b> hi </b>b")).toBe("a **hi** b");
    });

    test("empty emphasis doesn't emit bare delimiters", () => {
        expect(htmlToMarkdown("<b></b>")).toBe("");
        expect(htmlToMarkdown("x<b>   </b>y")).toBe("x   y");
    });

    test("tags with no markdown equivalent pass through as HTML", () => {
        expect(htmlToMarkdown("<u>hi</u>")).toBe("<u>hi</u>");
        expect(htmlToMarkdown("H<sub>2</sub>O")).toBe("H<sub>2</sub>O");
        expect(htmlToMarkdown("<mark>hi</mark>")).toBe("<mark>hi</mark>");
    });

    test("span is a transparent wrapper", () => {
        expect(htmlToMarkdown("<span>hi</span>")).toBe("hi");
    });

    test("entities are decoded", () => {
        expect(htmlToMarkdown("Smith &amp; Jones")).toBe("Smith & Jones");
        expect(htmlToMarkdown("&lt;not a tag&gt;")).toBe("<not a tag>");
    });
});

describe("htmlToMarkdown — line breaks", () => {
    test("literal newlines survive untouched", () => {
        // The engine joins multi-rep results with \n. In markdown a
        // newline is already a line break, so there's nothing to do —
        // this is what the old HTML clipboard path kept losing.
        expect(htmlToMarkdown("one\ntwo\nthree")).toBe("one\ntwo\nthree");
    });

    test("<br> becomes a newline", () => {
        expect(htmlToMarkdown("one<br>two")).toBe("one\ntwo");
    });

    test("CRLF is normalised", () => {
        expect(htmlToMarkdown("one\r\ntwo")).toBe("one\ntwo");
    });

    test("newlines inside formatting still work", () => {
        expect(htmlToMarkdown("<b>a</b>\n<b>b</b>")).toBe("**a**\n**b**");
    });
});

describe("htmlToMarkdown — blocks", () => {
    test("headings become #", () => {
        expect(htmlToMarkdown("<h1>Title</h1>")).toBe("# Title");
        expect(htmlToMarkdown("<h3>Sub</h3>")).toBe("### Sub");
    });

    test("heading content is forced onto one line", () => {
        expect(htmlToMarkdown("<h2>a<br>b</h2>")).toBe("## a b");
    });

    test("paragraphs are separated by a blank line", () => {
        expect(htmlToMarkdown("<p>one</p><p>two</p>")).toBe("one\n\ntwo");
    });

    test("hr becomes ---", () => {
        expect(htmlToMarkdown("<p>a</p><hr><p>b</p>")).toBe(
            "a\n\n---\n\nb"
        );
    });

    test("blockquote prefixes every line", () => {
        expect(htmlToMarkdown("<blockquote>a<br>b</blockquote>")).toBe(
            "> a\n> b"
        );
    });

    test("pre becomes a fenced code block", () => {
        expect(htmlToMarkdown("<pre>let x = 1;</pre>")).toBe(
            "```\nlet x = 1;\n```"
        );
    });

    test("pre containing a fence gets a longer fence", () => {
        // A rolled result containing ``` must not break out of the
        // block it's wrapped in.
        const out = htmlToMarkdown("<pre>a\n```\nb</pre>");
        expect(out.startsWith("````\n")).toBe(true);
        expect(out.endsWith("\n````")).toBe(true);
        expect(out).toContain("```\n");
    });

    test("pre content stays literal", () => {
        // A nested <code> inside <pre> must not sprinkle backticks.
        expect(htmlToMarkdown("<pre><code>x</code></pre>")).toBe(
            "```\nx\n```"
        );
    });

    test("leading and trailing whitespace is trimmed", () => {
        expect(htmlToMarkdown("<p>  a  </p>")).toBe("a");
    });
});

describe("htmlToMarkdown — lists", () => {
    test("unordered list", () => {
        expect(htmlToMarkdown("<ul><li>a</li><li>b</li></ul>")).toBe(
            "- a\n- b"
        );
    });

    test("ordered list numbers ascend", () => {
        expect(htmlToMarkdown("<ol><li>a</li><li>b</li><li>c</li></ol>")).toBe(
            "1. a\n2. b\n3. c"
        );
    });

    test("list items keep inline formatting", () => {
        expect(htmlToMarkdown("<ul><li><b>a</b></li></ul>")).toBe("- **a**");
    });

    test("nested lists indent by four spaces", () => {
        expect(
            htmlToMarkdown(
                "<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>"
            )
        ).toBe("- a\n    - a1\n    - a2\n- b");
    });

    test("wrapped item text aligns under the marker", () => {
        expect(htmlToMarkdown("<ul><li>a<br>continued</li></ul>")).toBe(
            "- a\n  continued"
        );
    });

    test("whitespace between list tags doesn't create phantom items", () => {
        expect(
            htmlToMarkdown("<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>")
        ).toBe("- a\n- b");
    });

    test("empty list produces nothing", () => {
        expect(htmlToMarkdown("<ul></ul>")).toBe("");
    });

    test("stray li outside a list still renders", () => {
        expect(htmlToMarkdown("<li>a</li>")).toBe("- a");
    });
});

describe("htmlToMarkdown — tables", () => {
    test("first row becomes the header even without thead", () => {
        expect(
            htmlToMarkdown(
                "<table><tr><td>a</td><td>b</td></tr>" +
                    "<tr><td>1</td><td>2</td></tr></table>"
            )
        ).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
    });

    test("thead/tbody structure is flattened correctly", () => {
        expect(
            htmlToMarkdown(
                "<table><thead><tr><th>h</th></tr></thead>" +
                    "<tbody><tr><td>v</td></tr></tbody></table>"
            )
        ).toBe("| h |\n| --- |\n| v |");
    });

    test("pipes in cell content are escaped", () => {
        expect(
            htmlToMarkdown("<table><tr><td>a|b</td></tr></table>")
        ).toBe("| a\\|b |\n| --- |");
    });

    test("ragged rows are padded to the widest row", () => {
        expect(
            htmlToMarkdown(
                "<table><tr><td>a</td><td>b</td></tr>" +
                    "<tr><td>1</td></tr></table>"
            )
        ).toBe("| a | b |\n| --- | --- |\n| 1 |  |");
    });

    test("cell content is forced onto one line", () => {
        expect(
            htmlToMarkdown("<table><tr><td>a<br>b</td></tr></table>")
        ).toBe("| a b |\n| --- |");
    });
});

describe("htmlToMarkdown — edge cases", () => {
    test("empty input", () => {
        expect(htmlToMarkdown("")).toBe("");
    });

    test("plain text passes through unchanged", () => {
        expect(htmlToMarkdown("just words")).toBe("just words");
    });

    test("unknown tags are unwrapped, content kept", () => {
        expect(htmlToMarkdown("<article>hi</article>")).toBe("hi");
    });

    test("existing markdown in the source is left alone", () => {
        // Generators can emit markdown directly; we must not double-
        // escape or re-interpret it.
        expect(htmlToMarkdown("**already bold**")).toBe("**already bold**");
        expect(htmlToMarkdown("[[Some Note]]")).toBe("[[Some Note]]");
    });

    test("runs of blank lines collapse to one", () => {
        // Block padding is emitted liberally; the tidy pass keeps
        // output readable without changing how it renders.
        expect(htmlToMarkdown("<p>a</p>\n\n\n<p>b</p>")).toBe("a\n\nb");
    });

    test("a realistic mixed result", () => {
        expect(
            htmlToMarkdown(
                "<h2>Altar</h2>An altar of <b>black stone</b>." +
                    "\nIt bears:<ul><li><i>runes</i></li><li>a bowl</li></ul>"
            )
        ).toBe(
            "## Altar\n\nAn altar of **black stone**.\nIt bears:\n\n" +
                "- *runes*\n- a bowl"
        );
    });
});
