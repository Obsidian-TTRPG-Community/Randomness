/**
 * @jest-environment jsdom
 */

/**
 * Dungeon grids — `deck:Dungeon|2x2` parsing, the uniform grid
 * facing roll, the return-then-redeal state ops behind Roll and the
 * per-tile reroll/rotate, and the markdown a grid copies as.
 */

import {
    parseDeckCall,
    parseDeckBlock,
    formatDealtGrid,
    MAX_DEAL,
} from "../../src/views/deckInlineProcessor";
import {
    DeckState,
    Facing,
    freshState,
    nextFacing,
    returnLastDrawn,
    rerollDrawnAt,
    rollGridFacing,
    rotateDrawnAt,
    drawTop,
} from "../../src/decks/deckModel";
import type { DeckCard } from "../../src/decks/deckModel";

/** A deterministic rand that plays back the given values. */
function seq(...vals: number[]): () => number {
    let i = 0;
    return () => vals[Math.min(i++, vals.length - 1)];
}

function dealt(
    name: string,
    opts: { imagePath?: string; facing?: Facing; text?: string } = {}
) {
    return {
        card: { name, imagePath: opts.imagePath } as DeckCard,
        facing: opts.facing ?? ("upright" as Facing),
        text: opts.text,
    };
}

/** A state with cards 0..n-1 in order, `drawnN` of them drawn. */
function stateWith(n: number, drawnN: number): DeckState {
    const state = freshState(n, () => 0.99999);
    for (let i = 0; i < drawnN; i++) {
        drawTop(state, 0, () => 0);
    }
    return state;
}

/** Every index 0..total-1 appears exactly once across the state. */
function conserved(state: DeckState): boolean {
    const all = [
        ...state.remaining,
        ...state.drawn.map((d) => d.index),
        ...state.removed,
    ].sort((a, b) => a - b);
    return all.every((v, i) => v === i) && all.length === state.total;
}

describe("parseDeckCall grid forms", () => {
    test("WxH first param", () => {
        expect(parseDeckCall("deck:Dungeon|2x2")).toEqual({
            name: "Dungeon",
            count: 4,
            mod: false,
            grid: { w: 2, h: 2 },
        });
        expect(parseDeckCall("deck:Dungeon|3x2|150")).toEqual({
            name: "Dungeon",
            count: 6,
            size: 150,
            mod: false,
            grid: { w: 3, h: 2 },
        });
    });

    test("× and spacing variants parse too", () => {
        expect(parseDeckCall("deck:Dungeon | 4×1")).toEqual({
            name: "Dungeon",
            count: 4,
            mod: false,
            grid: { w: 4, h: 1 },
        });
        expect(parseDeckCall("deck:Dungeon|2 x 3")).toEqual({
            name: "Dungeon",
            count: 6,
            mod: false,
            grid: { w: 2, h: 3 },
        });
    });

    test("rejects degenerate and oversized grids", () => {
        expect(parseDeckCall("deck:D|0x2")).toBeNull();
        expect(parseDeckCall("deck:D|2x0")).toBeNull();
        // 10×10 = 100 tiles > MAX_DEAL (99).
        expect(MAX_DEAL).toBeLessThan(100);
        expect(parseDeckCall("deck:D|10x10")).toBeNull();
        // Grid takes at most one trailing number (tile width).
        expect(parseDeckCall("deck:D|2x2|100|9")).toBeNull();
        expect(parseDeckCall("deck:D|2x2|0")).toBeNull();
        // WxH only works as the FIRST param.
        expect(parseDeckCall("deck:D|5|2x2")).toBeNull();
    });

    test("plain counted calls are unchanged", () => {
        expect(parseDeckCall("deck:Tarot|5|200")).toEqual({
            name: "Tarot",
            count: 5,
            size: 200,
            mod: false,
        });
    });
});

describe("parseDeckBlock with grids", () => {
    test("grid survives; deck-mod still demotes", () => {
        expect(parseDeckBlock("deck:Dungeon|2x2")).toEqual({
            name: "Dungeon",
            count: 4,
            mod: false,
            grid: { w: 2, h: 2 },
        });
        expect(parseDeckBlock("deck-mod:Dungeon|2x2")).toEqual({
            name: "Dungeon",
            count: 4,
            mod: false,
            grid: { w: 2, h: 2 },
        });
    });
});

describe("rollGridFacing", () => {
    test("flip 0 always lands upright — rectangle decks stay lengthways", () => {
        expect(rollGridFacing({ flip: 0, turn: "quarter" }, seq(0.9))).toBe(
            "upright"
        );
    });

    test("quarter mode is uniform over all four facings", () => {
        const opts = { flip: 100, turn: "quarter" as const };
        expect(rollGridFacing(opts, seq(0.1))).toBe("upright");
        expect(rollGridFacing(opts, seq(0.3))).toBe("right");
        expect(rollGridFacing(opts, seq(0.6))).toBe("reversed");
        expect(rollGridFacing(opts, seq(0.9))).toBe("left");
    });

    test("half mode is a coin flip, flip % ignored beyond on/off", () => {
        const opts = { flip: 5, turn: "half" as const };
        expect(rollGridFacing(opts, seq(0.2))).toBe("upright");
        expect(rollGridFacing(opts, seq(0.8))).toBe("reversed");
    });
});

describe("nextFacing", () => {
    test("quarter steps clockwise through all four", () => {
        expect(nextFacing("upright", "quarter")).toBe("right");
        expect(nextFacing("right", "quarter")).toBe("reversed");
        expect(nextFacing("reversed", "quarter")).toBe("left");
        expect(nextFacing("left", "quarter")).toBe("upright");
    });

    test("half toggles upright/reversed; quarter facings normalise", () => {
        expect(nextFacing("upright", "half")).toBe("reversed");
        expect(nextFacing("reversed", "half")).toBe("upright");
        expect(nextFacing("right", "half")).toBe("upright");
    });
});

describe("returnLastDrawn", () => {
    test("buries the last n draws back into the deck", () => {
        const state = stateWith(6, 4);
        const returned = returnLastDrawn(state, 3, () => 0.5);
        expect(returned).toBe(3);
        expect(state.drawn.length).toBe(1);
        expect(state.remaining.length).toBe(5);
        expect(conserved(state)).toBe(true);
    });

    test("stops at an empty history", () => {
        const state = stateWith(4, 1);
        expect(returnLastDrawn(state, 3, () => 0)).toBe(1);
        expect(state.drawn.length).toBe(0);
        expect(conserved(state)).toBe(true);
    });

    test("rand 0 buries on top — order comes from the rand, not a stack", () => {
        const state = stateWith(3, 2);
        const last = state.drawn[1].index;
        returnLastDrawn(state, 1, () => 0);
        expect(state.remaining[0]).toBe(last);
    });
});

describe("rerollDrawnAt", () => {
    test("replaces the record in its slot; cards conserved", () => {
        const state = stateWith(6, 4);
        const before = state.drawn.map((d) => d.index);
        // Bury deep (rand high for the bury roll), take the old top.
        const rec = rerollDrawnAt(
            state,
            1,
            { flip: 100, turn: "quarter" },
            seq(0.99, 0.3)
        );
        expect(rec).not.toBeNull();
        expect(state.drawn.length).toBe(4);
        expect(state.drawn[1].index).toBe(rec?.index);
        // The other three slots kept their cards.
        expect(state.drawn[0].index).toBe(before[0]);
        expect(state.drawn[2].index).toBe(before[2]);
        expect(state.drawn[3].index).toBe(before[3]);
        expect(conserved(state)).toBe(true);
    });

    test("on an empty deck the tile rerolls in place (same card)", () => {
        const state = stateWith(2, 2);
        const old = state.drawn[0].index;
        const rec = rerollDrawnAt(
            state,
            0,
            { flip: 100, turn: "quarter" },
            seq(0.0, 0.9)
        );
        // Buried at position 0 of an empty pile, drawn right back.
        expect(rec?.index).toBe(old);
        expect(state.drawn.length).toBe(2);
        expect(conserved(state)).toBe(true);
    });

    test("out-of-range position is a no-op", () => {
        const state = stateWith(4, 2);
        expect(
            rerollDrawnAt(state, 2, 0, seq(0.5))
        ).toBeNull();
        expect(rerollDrawnAt(state, -1, 0, seq(0.5))).toBeNull();
        expect(state.drawn.length).toBe(2);
    });
});

describe("rotateDrawnAt", () => {
    test("turns the record and keeps it in place", () => {
        const state = stateWith(4, 2);
        expect(state.drawn[0].facing).toBe("upright");
        const rec = rotateDrawnAt(state, 0, "quarter");
        expect(rec?.facing).toBe("right");
        expect(state.drawn[0].facing).toBe("right");
        expect(rotateDrawnAt(state, 0, "quarter")?.facing).toBe("reversed");
        expect(rotateDrawnAt(state, 9, "quarter")).toBeNull();
    });
});

describe("formatDealtGrid", () => {
    test("rows of embeds, one line per grid row", () => {
        const out = formatDealtGrid(
            [
                dealt("A", { imagePath: "a.png" }),
                dealt("B", { imagePath: "b.png", facing: "right" }),
                dealt("C", { imagePath: "c.png" }),
                dealt("D", { imagePath: "d.png", facing: "reversed" }),
            ],
            2,
            150
        );
        expect(out).toBe(
            "![[a.png|150]] ![[b.png|150]] *(right)*\n" +
                "![[c.png|150]] ![[d.png|150]] *(reversed)*"
        );
    });

    test("a short last row still formats", () => {
        const out = formatDealtGrid(
            [
                dealt("A", { imagePath: "a.png" }),
                dealt("B", { imagePath: "b.png" }),
                dealt("C", { imagePath: "c.png" }),
            ],
            2
        );
        expect(out).toBe("![[a.png]] ![[b.png]]\n![[c.png]]");
    });
});
