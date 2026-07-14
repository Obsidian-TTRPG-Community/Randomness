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
        expect(parseDeckBlock("deck:Weather")).toBe("Weather");
        expect(parseDeckBlock("  deck: Playing Cards  \n")).toBe(
            "Playing Cards"
        );
    });

    test("comments and blank lines are ignored", () => {
        expect(
            parseDeckBlock("// today's weather\n\ndeck:Weather\n")
        ).toBe("Weather");
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
