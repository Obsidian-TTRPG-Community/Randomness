/**
 * @jest-environment jsdom
 */

/**
 * Tests for markdown-lite result rendering — line/block rolls return
 * raw note markdown, which should read as formatted text in the
 * inline span, not as syntax soup.
 */

import { markdownLite, setSanitisedHtml } from "../../src/views/sanitiser";

describe("markdownLite", () => {
    test("inline constructs convert to whitelisted HTML", () => {
        expect(markdownLite("**bold** and *italic* and ~~gone~~")).toBe(
            "<b>bold</b> and <i>italic</i> and <s>gone</s>"
        );
        expect(markdownLite("run `rdm:[@x]` now")).toBe(
            "run <code>rdm:[@x]</code> now"
        );
    });

    test("heading markers render bold (a heading can't live mid-sentence)", () => {
        expect(markdownLite("### Inline direct calls")).toBe(
            "<b>Inline direct calls</b>"
        );
    });

    test("code span content stays literal — no formatting inside", () => {
        expect(markdownLite("`dice: 1d20+2|text(**x**)`")).toBe(
            "<code>dice: 1d20+2|text(**x**)</code>"
        );
        // HTML inside code is escaped, not interpreted.
        expect(markdownLite("`<b>raw</b>`")).toBe(
            "<code>&lt;b&gt;raw&lt;/b&gt;</code>"
        );
    });

    test("plain text and existing HTML pass through untouched", () => {
        expect(markdownLite("The Prancing Pony")).toBe("The Prancing Pony");
        expect(markdownLite("<b>from a filter</b>")).toBe(
            "<b>from a filter</b>"
        );
        expect(markdownLite("3 * 4 * 5")).toBe("3 * 4 * 5"); // math, not italics
    });

    test("end to end through the sanitiser", () => {
        const el = document.createElement("span");
        setSanitisedHtml(el, markdownLite("**Ambush!** `{2d4}` bandits"));
        expect(el.querySelector("b")?.textContent).toBe("Ambush!");
        expect(el.querySelector("code")?.textContent).toBe("{2d4}");
    });
});
