/**
 * Which inline calls Live Preview replaces with a widget.
 *
 * This is the decision layer of the Live Preview extension, kept free
 * of CodeMirror so it can be tested directly. Each rule below exists
 * because getting it wrong has a specific, visible cost:
 *
 *   - decorate inside a fenced block and the reference note's own
 *     ```text examples start rolling at the reader;
 *   - decorate a call the cursor is in and there is no way to edit an
 *     expression ever again;
 *   - get the occurrence wrong and clicking Lock on the third roll
 *     writes the answer into the first.
 */

import {
    inlineCallRanges,
    fencedRanges,
} from "../../src/views/livePreviewRanges";

const noSelection = { from: -1, to: -1 };

/** The text each returned range covers. */
function covered(text: string, sel = noSelection, compatOn = true): string[] {
    return inlineCallRanges({ text, selection: sel, compatOn }).map((r) =>
        text.slice(r.from, r.to)
    );
}

describe("inlineCallRanges: what gets replaced", () => {
    test("a plain inline call", () => {
        expect(covered("You meet `rdm:[@npc]` here.")).toEqual([
            "`rdm:[@npc]`",
        ]);
    });

    test("a locked call is included — it renders its stored result", () => {
        expect(covered("You meet `rdm:[@npc]⟹Bob` here.")).toEqual([
            "`rdm:[@npc]⟹Bob`",
        ]);
    });

    test("several calls on one line", () => {
        expect(covered("`rdm:[@a]` and `rdm:[@b]`")).toEqual([
            "`rdm:[@a]`",
            "`rdm:[@b]`",
        ]);
    });

    test("ordinary inline code is left alone", () => {
        expect(covered("Run `npm test` first.")).toEqual([]);
    });

    test("prose containing no calls yields nothing", () => {
        expect(covered("Just a sentence.")).toEqual([]);
    });
});

describe("inlineCallRanges: the selection reveals the source", () => {
    const text = "You meet `rdm:[@npc]` here.";
    const from = text.indexOf("`");
    const to = text.lastIndexOf("`") + 1;

    test("a cursor inside the call reveals it", () => {
        expect(covered(text, { from: from + 3, to: from + 3 })).toEqual([]);
    });

    test("a cursor at the opening backtick reveals it", () => {
        expect(covered(text, { from, to: from })).toEqual([]);
    });

    test("a cursor just past the closing backtick reveals it", () => {
        // Inclusive on purpose: arrowing rightwards off the end of a
        // roll must not re-render it under the cursor, or you can
        // never get back into it.
        expect(covered(text, { from: to, to })).toEqual([]);
    });

    test("a cursor elsewhere on the line leaves it rendered", () => {
        expect(covered(text, { from: 2, to: 2 })).toEqual(["`rdm:[@npc]`"]);
    });

    test("a selection spanning the call reveals it", () => {
        expect(covered(text, { from: 0, to: text.length })).toEqual([]);
    });

    test("only the touched call of several is revealed", () => {
        const two = "`rdm:[@a]` and `rdm:[@b]`";
        const second = two.lastIndexOf("`rdm:");
        expect(covered(two, { from: second + 2, to: second + 2 })).toEqual([
            "`rdm:[@a]`",
        ]);
    });
});

describe("inlineCallRanges: fenced blocks", () => {
    test("a call inside a fenced block is left as text", () => {
        const text = [
            "Before.",
            "```text",
            "`rdm:[@npc]`",
            "```",
            "After `rdm:[@real]`.",
        ].join("\n");
        expect(covered(text)).toEqual(["`rdm:[@real]`"]);
    });

    test("a randomness block's body is left alone", () => {
        const text = ["```randomness", "Table: T", "`rdm:[@x]`", "```"].join(
            "\n"
        );
        expect(covered(text)).toEqual([]);
    });

    test("an unterminated fence swallows the rest of the note", () => {
        // What you are looking at halfway through typing a block.
        const text = ["```text", "`rdm:[@npc]`", "still inside"].join("\n");
        expect(covered(text)).toEqual([]);
    });

    test("tilde fences count too", () => {
        const text = ["~~~text", "`rdm:[@npc]`", "~~~"].join("\n");
        expect(covered(text)).toEqual([]);
    });

    test("a longer fence is not closed by a shorter one", () => {
        const text = [
            "````text",
            "```randomness",
            "`rdm:[@npc]`",
            "```",
            "````",
        ].join("\n");
        expect(covered(text)).toEqual([]);
    });

    test("fencedRanges reports the block, not the whole document", () => {
        const text = ["a", "```", "b", "```", "c"].join("\n");
        const [range] = fencedRanges(text);
        expect(text.slice(range[0], range[1])).toBe("```\nb\n```");
    });
});

describe("inlineCallRanges: compat prefixes", () => {
    const text = "Roll `dice:1d20` and `rdm:{1d20}`.";

    test("with compat on, both are replaced", () => {
        expect(covered(text, noSelection, true)).toEqual([
            "`dice:1d20`",
            "`rdm:{1d20}`",
        ]);
    });

    test("with compat off, dice: belongs to the other plugin", () => {
        expect(covered(text, noSelection, false)).toEqual(["`rdm:{1d20}`"]);
    });
});

describe("inlineCallRanges: occurrence numbering", () => {
    test("identical calls are numbered in source order", () => {
        const text = "`rdm:[@T]` `rdm:[@T]` `rdm:[@T]`";
        expect(
            inlineCallRanges({
                text,
                selection: noSelection,
                compatOn: true,
            }).map((r) => r.occurrence)
        ).toEqual([0, 1, 2]);
    });

    test("numbering survives one of them being revealed", () => {
        // The middle call is under the cursor, so it is not decorated —
        // but the third must still know it is occurrence 2, or its
        // Lock button would write into the wrong one.
        const text = "`rdm:[@T]` `rdm:[@T]` `rdm:[@T]`";
        const middle = text.indexOf("`rdm:[@T]`", 1) + 3;
        expect(
            inlineCallRanges({
                text,
                selection: { from: middle, to: middle },
                compatOn: true,
            }).map((r) => r.occurrence)
        ).toEqual([0, 2]);
    });

    test("different expressions are numbered independently", () => {
        const text = "`rdm:[@A]` `rdm:[@B]` `rdm:[@A]`";
        expect(
            inlineCallRanges({
                text,
                selection: noSelection,
                compatOn: true,
            }).map((r) => `${r.call.expr}#${r.occurrence}`)
        ).toEqual(["[@A]#0", "[@B]#0", "[@A]#1"]);
    });
});
