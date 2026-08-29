/**
 * @jest-environment jsdom
 */

/**
 * `deck:` codeblock parsing — a ```randomness block whose whole body
 * is one deck line renders as a block-sized card display instead of
 * running the engine.
 */

import {
    parseDeckBlock,
    parseDeckSpan,
} from "../../src/views/deckInlineProcessor";

describe("parseDeckBlock", () => {
    test("a single deck line is a deck block", () => {
        expect(parseDeckBlock("deck:Weather")).toEqual({
            name: "Weather",
            count: 1,
            mod: false,
        });
        expect(parseDeckBlock("  deck: Playing Cards  \n")).toEqual({
            name: "Playing Cards",
            count: 1,
            mod: false,
        });
    });

    test("comments and blank lines are ignored", () => {
        expect(
            parseDeckBlock("// today's weather\n\ndeck:Weather\n")
        ).toEqual({ name: "Weather", count: 1, mod: false });
    });

    test("anything else falls through to the engine", () => {
        expect(parseDeckBlock("Table: T\nhello")).toBeNull();
        expect(parseDeckBlock("deck:A\ndeck:B")).toBeNull();
        expect(parseDeckBlock("[@Table]")).toBeNull();
        expect(parseDeckBlock("deck:")).toBeNull();
        expect(parseDeckBlock("")).toBeNull();
    });
});

describe("parseDeckSpan (unchanged contract)", () => {
    test("prefix + name", () => {
        expect(parseDeckSpan("deck:Tarot")).toBe("Tarot");
        expect(parseDeckSpan("deck:")).toBeNull();
        expect(parseDeckSpan("rdm:[@x]")).toBeNull();
    });
});
