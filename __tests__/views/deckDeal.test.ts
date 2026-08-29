/**
 * @jest-environment jsdom
 */

/**
 * Dealing multiple cards (issue #8): `deck:Name|5` / `deck-mod:Name|5|200`
 * parsing, the markdown a dealt hand bakes as, and the source
 * targeting that replaces the right codespan.
 */

import {
    parseDeckCall,
    parseDeckSpan,
    parseDeckBlock,
    formatDealtHand,
    bakeDeckSpanInSource,
    deckSpanOccurrenceBase,
    MAX_DEAL,
} from "../../src/views/deckInlineProcessor";
import type { DeckCard } from "../../src/decks/deckModel";
import type { Facing } from "../../src/decks/deckModel";

function card(over: Partial<DeckCard> & { name: string }): DeckCard {
    return { ...over } as DeckCard;
}

function dealt(
    name: string,
    opts: { imagePath?: string; facing?: Facing; text?: string } = {}
) {
    return {
        card: card({ name, imagePath: opts.imagePath }),
        facing: opts.facing ?? ("upright" as Facing),
        text: opts.text,
    };
}

describe("parseDeckCall", () => {
    test("plain call: count defaults to 1", () => {
        expect(parseDeckCall("deck:Tarot")).toEqual({
            name: "Tarot",
            count: 1,
            mod: false,
        });
        expect(parseDeckCall("deck: Playing Cards ")).toEqual({
            name: "Playing Cards",
            count: 1,
            mod: false,
        });
    });

    test("count and size params", () => {
        expect(parseDeckCall("deck:Tarot|5")).toEqual({
            name: "Tarot",
            count: 5,
            mod: false,
        });
        expect(parseDeckCall("deck:Tarot|5|200")).toEqual({
            name: "Tarot",
            count: 5,
            size: 200,
            mod: false,
        });
        expect(parseDeckCall("deck:Tarot | 3 | 140")).toEqual({
            name: "Tarot",
            count: 3,
            size: 140,
            mod: false,
        });
    });

    test("deck-mod: prefix marks an auto-bake call", () => {
        expect(parseDeckCall("deck-mod:Poker|5")).toEqual({
            name: "Poker",
            count: 5,
            mod: true,
        });
        expect(parseDeckCall("deck-mod:Poker")).toEqual({
            name: "Poker",
            count: 1,
            mod: true,
        });
    });

    test("rejects what isn't a call", () => {
        expect(parseDeckCall("rdm:[@x]")).toBeNull();
        expect(parseDeckCall("deck:")).toBeNull();
        expect(parseDeckCall("deck-mod:")).toBeNull();
        expect(parseDeckCall("deck:Tarot|banana")).toBeNull();
        expect(parseDeckCall("deck:Tarot|5|200|9")).toBeNull();
        expect(parseDeckCall("deck:Tarot|0")).toBeNull();
        expect(parseDeckCall("deck:Tarot|-2")).toBeNull();
        expect(parseDeckCall(`deck:Tarot|${MAX_DEAL + 1}`)).toBeNull();
        expect(parseDeckCall("deck:Tarot|5|0")).toBeNull();
    });
});

describe("parseDeckSpan (original contract)", () => {
    test("name of a plain span; null for deck-mod", () => {
        expect(parseDeckSpan("deck:Tarot")).toBe("Tarot");
        expect(parseDeckSpan("deck:")).toBeNull();
        expect(parseDeckSpan("deck-mod:Tarot")).toBeNull();
    });
});

describe("parseDeckBlock with counts", () => {
    test("count survives; deck-mod demotes to plain deck", () => {
        expect(parseDeckBlock("deck:Weather|3")).toEqual({
            name: "Weather",
            count: 3,
            mod: false,
        });
        // Codeblocks have no note-rewriting machinery: a deck-mod
        // line renders as an ordinary deck block instead.
        expect(parseDeckBlock("deck-mod:Weather|3")).toEqual({
            name: "Weather",
            count: 3,
            mod: false,
        });
    });

    test("non-deck bodies still fall through", () => {
        expect(parseDeckBlock("deck:A\ndeck:B")).toBeNull();
        expect(parseDeckBlock("Table: T\nhello")).toBeNull();
    });
});

describe("formatDealtHand", () => {
    test("image cards bake as embeds, joined with spaces", () => {
        const out = formatDealtHand(
            [
                dealt("Ace", { imagePath: "Decks/Poker/ace.png" }),
                dealt("King", { imagePath: "Decks/Poker/king.png" }),
            ],
            200
        );
        expect(out).toBe(
            "![[Decks/Poker/ace.png|200]] ![[Decks/Poker/king.png|200]]"
        );
    });

    test("no size param means a plain embed", () => {
        expect(formatDealtHand([dealt("Ace", { imagePath: "a.png" })])).toBe(
            "![[a.png]]"
        );
    });

    test("a non-upright image card keeps its facing as text", () => {
        expect(
            formatDealtHand([
                dealt("Death", { imagePath: "d.png", facing: "reversed" }),
            ])
        ).toBe("![[d.png]] *(reversed)*");
    });

    test("text cards bake as bold name — meaning, one per line", () => {
        const out = formatDealtHand([
            dealt("Storm", { text: "Rain and thunder." }),
            dealt("Sun", { text: "Clear skies." }),
        ]);
        expect(out).toBe(
            "**Storm** — Rain and thunder.\n**Sun** — Clear skies."
        );
    });

    test("a mixed hand switches to newlines for everything", () => {
        const out = formatDealtHand([
            dealt("Ace", { imagePath: "a.png" }),
            dealt("Storm", { text: "Rain." }),
        ]);
        expect(out).toBe("![[a.png]]\n**Storm** — Rain.");
    });

    test("facing label lands inside the bold name for text cards", () => {
        expect(formatDealtHand([dealt("Tower", { facing: "reversed" })])).toBe(
            "**Tower (reversed)**"
        );
    });
});

describe("bakeDeckSpanInSource", () => {
    const src = "before `deck:T|2` mid `deck:T|2` after";

    test("replaces exactly the asked-for occurrence", () => {
        expect(bakeDeckSpanInSource(src, "deck:T|2", 0, "X")).toBe(
            "before X mid `deck:T|2` after"
        );
        expect(bakeDeckSpanInSource(src, "deck:T|2", 1, "X")).toBe(
            "before `deck:T|2` mid X after"
        );
    });

    test("missing occurrence leaves the source untouched (same ref)", () => {
        expect(bakeDeckSpanInSource(src, "deck:T|2", 2, "X")).toBe(src);
        expect(bakeDeckSpanInSource(src, "deck:Other", 0, "X")).toBe(src);
    });
});

describe("deckSpanOccurrenceBase", () => {
    test("counts identical spans on earlier lines only", () => {
        const src = [
            "one `deck:T` here",
            "`deck:T` and `deck:T` again",
            "target line `deck:T`",
        ].join("\n");
        expect(deckSpanOccurrenceBase(src, "deck:T", 0)).toBe(0);
        expect(deckSpanOccurrenceBase(src, "deck:T", 1)).toBe(1);
        expect(deckSpanOccurrenceBase(src, "deck:T", 2)).toBe(3);
    });

    test("base + in-block index targets the right span end-to-end", () => {
        const src = "`deck:T` prose\n\npara two `deck:T` and `deck:T`";
        // Second span of the last paragraph: base at its line is 1,
        // in-block index 1 → occurrence 2.
        const occ = deckSpanOccurrenceBase(src, "deck:T", 2) + 1;
        expect(bakeDeckSpanInSource(src, "deck:T", occ, "BAKED")).toBe(
            "`deck:T` prose\n\npara two `deck:T` and BAKED"
        );
    });
});
