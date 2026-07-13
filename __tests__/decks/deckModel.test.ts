/**
 * Persistent decks — pure model tests (deckModel.ts).
 *
 * Covers: image↔text pairing by slug, shuffled-order draw semantics
 * (draw from the top, peek without consuming, undo restores, bury
 * keeps the deck whole), facing rolls, stale-state invalidation, and
 * weighted draws for `Deck: persistent` tables.
 */

import {
    buildCards,
    cardSlug,
    drawAndReplace,
    drawTop,
    drawWeighted,
    freshState,
    peekTop,
    reshuffle,
    undoDraw,
    validateState,
} from "../../src/decks/deckModel";

/** Deterministic rand: cycles through the provided values. */
function seq(...values: number[]): () => number {
    let i = 0;
    return () => values[i++ % values.length];
}

describe("cardSlug pairing", () => {
    test("filename slug matches dictionary key", () => {
        expect(cardSlug("the-tower")).toBe(cardSlug("The Tower"));
        expect(cardSlug("Ace_of_Wands")).toBe(cardSlug("ace of wands"));
        expect(cardSlug("  Two  of Cups ")).toBe(cardSlug("two-of-cups"));
    });

    test("buildCards pairs images with text entries by slug", () => {
        const cards = buildCards(
            [
                { path: "Decks/T/the-tower.png", basename: "the-tower" },
                { path: "Decks/T/extra.png", basename: "extra" },
            ],
            [{ key: "The Tower" }, { key: "The Moon" }]
        );
        expect(cards).toHaveLength(3);
        // Text order first, with the matched image attached.
        expect(cards[0]).toMatchObject({
            name: "The Tower",
            imagePath: "Decks/T/the-tower.png",
            textKey: "The Tower",
        });
        // Text-only card.
        expect(cards[1]).toMatchObject({ name: "The Moon" });
        expect(cards[1].imagePath).toBeUndefined();
        // Unmatched image becomes an image-only card.
        expect(cards[2]).toMatchObject({
            name: "extra",
            imagePath: "Decks/T/extra.png",
        });
    });
});

describe("draw semantics (folder decks)", () => {
    test("draws come from the front of the shuffled order, no repeats", () => {
        const state = freshState(5, seq(0.99, 0.5, 0.01));
        const drawn: number[] = [];
        for (;;) {
            const rec = drawTop(state, 0, seq(0));
            if (!rec) break;
            drawn.push(rec.index);
        }
        expect(drawn).toHaveLength(5);
        expect(new Set(drawn).size).toBe(5); // all distinct
        expect(state.remaining).toHaveLength(0);
        expect(state.drawn).toHaveLength(5);
        // Empty deck: further draws return null, not wraparound.
        expect(drawTop(state, 0, seq(0))).toBeNull();
    });

    test("peek shows the next card without consuming it", () => {
        const state = freshState(3, seq(0.1, 0.9));
        const next = peekTop(state, 1);
        expect(next).toHaveLength(1);
        const rec = drawTop(state, 0, seq(0));
        expect(rec?.index).toBe(next[0]); // peek told the truth
    });

    test("undo puts the last draw back on top", () => {
        const state = freshState(3, seq(0.2));
        const rec = drawTop(state, 0, seq(0));
        expect(rec).not.toBeNull();
        const undone = undoDraw(state);
        expect(undone?.index).toBe(rec?.index);
        expect(state.remaining[0]).toBe(rec?.index); // back on top
        expect(state.drawn).toHaveLength(0);
    });

    test("draw-and-bury keeps every card in the deck", () => {
        const state = freshState(4, seq(0.3, 0.8));
        const before = [...state.remaining];
        const r = drawAndReplace(state, 0, seq(0.5));
        expect(r).not.toBeNull();
        expect(state.remaining).toHaveLength(4);
        expect([...state.remaining].sort()).toEqual([...before].sort());
        expect(state.drawn).toHaveLength(0); // no history entry
    });

    test("facing: flip% controls reversed draws", () => {
        const state = freshState(2, seq(0.5));
        // rand 0.2 → 20 < 50 → reversed.
        const r1 = drawTop(state, 50, seq(0.2));
        expect(r1?.facing).toBe("reversed");
        // rand 0.9 → 90 >= 50 → upright.
        const r2 = drawTop(state, 50, seq(0.9));
        expect(r2?.facing).toBe("upright");
    });

    test("flip 0 never reverses and skips the facing roll", () => {
        const state = freshState(1, seq(0.5));
        const r = drawTop(state, 0, () => {
            throw new Error("facing roll should not happen at flip 0");
        });
        expect(r?.facing).toBe("upright");
    });

    test("reshuffle restores everything and clears history", () => {
        const state = freshState(4, seq(0.7, 0.2));
        drawTop(state, 0, seq(0));
        drawTop(state, 0, seq(0));
        reshuffle(state, seq(0.4, 0.6));
        expect(state.remaining).toHaveLength(4);
        expect(state.drawn).toHaveLength(0);
    });

    test("reshuffle honours removed-from-game cards", () => {
        const state = freshState(4, seq(0.1));
        state.removed = [2];
        reshuffle(state, seq(0.5));
        expect(state.remaining).toHaveLength(3);
        expect(state.remaining).not.toContain(2);
    });
});

describe("validateState", () => {
    test("valid saved state passes through untouched", () => {
        const saved = freshState(3, seq(0.5, 0.1));
        const order = [...saved.remaining];
        const { state, wasStale } = validateState(saved, 3, seq(0));
        expect(wasStale).toBe(false);
        expect(state.remaining).toEqual(order); // pinned order kept
    });

    test("card-count mismatch invalidates (deck changed on disk)", () => {
        const saved = freshState(3, seq(0.5));
        const { state, wasStale } = validateState(saved, 5, seq(0.2));
        expect(wasStale).toBe(true);
        expect(state.total).toBe(5);
        expect(state.remaining).toHaveLength(5);
    });

    test("out-of-range indices invalidate", () => {
        const saved = freshState(3, seq(0.5));
        saved.remaining.push(99);
        saved.total = 4; // count matches remaining+drawn lie
        const { wasStale } = validateState(saved, 4, seq(0.2));
        expect(wasStale).toBe(true);
    });

    test("missing state builds fresh without the stale flag", () => {
        const { state, wasStale } = validateState(undefined, 2, seq(0.3));
        expect(wasStale).toBe(false);
        expect(state.remaining).toHaveLength(2);
    });
});

describe("drawWeighted (persistent table decks)", () => {
    test("draws every item exactly once, honouring weights", () => {
        const state = freshState(3, seq(0.5));
        const weights = [1, 5, 1];
        const drawn: number[] = [];
        for (;;) {
            const idx = drawWeighted(state, weights, seq(0.01));
            if (idx === null) break;
            drawn.push(idx);
        }
        expect(drawn.sort()).toEqual([0, 1, 2]);
        expect(drawWeighted(state, weights, seq(0))).toBeNull();
    });

    test("heavier items are proportionally likelier", () => {
        // weight [1, 9]: rand 0.5 → r=5 ≥ w0=1 → item 1.
        const state = freshState(2, seq(0.5));
        const idx = drawWeighted(state, [1, 9], seq(0.5));
        expect(idx).toBe(1);
    });
});
