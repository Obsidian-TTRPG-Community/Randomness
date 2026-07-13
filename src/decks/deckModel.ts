/**
 * Persistent decks — pure model (design: docs/persistent-decks-design.md).
 *
 * A folder deck is `<Generator Root>/Decks/<Name>/`: card images
 * (one image = one card), an optional `.rdm` file (textual cards,
 * `Type: Dictionary` recommended), and a `deck.json` holding the
 * deck's settings + drawn/remaining state so the folder is fully
 * self-contained and syncs with the vault.
 *
 * Unlike IPP3-style deck picks (per-run, reshuffled every invocation),
 * a folder deck's `remaining` array IS the shuffled order: shuffling
 * produces a random permutation once, drawing takes from the front.
 * That is what makes "peek at the next card" meaningful and keeps
 * draws honest across sessions — the order was fixed when the deck
 * was shuffled, exactly like a physical deck.
 *
 * Everything here is pure and Obsidian-free (unit-testable): the
 * vault-facing loader/saver lives in deckService.ts.
 */

export type Facing = "upright" | "reversed";

export interface DeckCard {
    /** Display name: image basename or dictionary key. */
    name: string;
    /** Vault path of the card's image, when it has one. */
    imagePath?: string;
    /** Dictionary key into the deck's .rdm table, when it has text. */
    textKey?: string;
    /**
     * For decks whose .rdm table is weighted (not a dictionary):
     * the raw item content, evaluated at render time.
     */
    rawText?: string;
}

export interface DeckSettings {
    /**
     * Percent chance (0–100) that a draw comes up reversed. 0 (the
     * default) disables orientation entirely — decks are tarot-ish
     * only when the user opts in.
     */
    flip: number;
}

export const DEFAULT_DECK_SETTINGS: DeckSettings = { flip: 0 };

export interface DrawnRecord {
    /** Index into the deck's card list. */
    index: number;
    facing: Facing;
    /** Epoch ms of the draw. */
    ts: number;
}

export interface DeckState {
    /** Card count when this state was created — staleness check. */
    total: number;
    /**
     * Indices still in the deck, IN DRAW ORDER (front = top). Set at
     * shuffle time; draws shift from the front.
     */
    remaining: number[];
    /** Draw history, oldest first. */
    drawn: DrawnRecord[];
    /** Reserved: cards removed from the game (survive shuffles). v2. */
    removed: number[];
}

/** The serialised shape of a deck folder's deck.json. */
export interface DeckFileJson {
    settings?: Partial<DeckSettings>;
    state?: DeckState;
}

/** RNG signature: returns [0, 1). Injectable for tests. */
export type Rand = () => number;

// ────────────────────────────────────────────────────────────────────
// Card-list construction: pair images with text entries by slug.
// ────────────────────────────────────────────────────────────────────

/**
 * Normalise a card name for image↔key pairing: lowercase, `-`/`_`
 * treated as spaces, whitespace collapsed. `the-tower` ⇔ `The Tower`.
 */
export function cardSlug(s: string): string {
    return s
        .toLowerCase()
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export interface ImageEntry {
    /** Vault path. */
    path: string;
    /** Filename without extension. */
    basename: string;
}

export interface TextEntry {
    /** Dictionary key (display name). */
    key: string;
    /** Raw content for weighted (non-dictionary) tables. */
    rawText?: string;
}

/**
 * Build the deck's card list from its folder contents.
 *
 * Text entries come first in their declared order (the .rdm author's
 * order), each picking up a matching image by slug. Images that match
 * no text entry follow, sorted by name, as image-only cards. Order
 * only matters for stable indices — play order comes from shuffling.
 */
export function buildCards(
    images: ImageEntry[],
    texts: TextEntry[]
): DeckCard[] {
    const bySlug = new Map<string, ImageEntry>();
    for (const img of images) {
        const slug = cardSlug(img.basename);
        // First image wins on a slug collision; later dupes become
        // their own image-only cards below rather than vanishing.
        if (!bySlug.has(slug)) bySlug.set(slug, img);
    }
    const used = new Set<ImageEntry>();
    const cards: DeckCard[] = [];
    for (const t of texts) {
        const img = bySlug.get(cardSlug(t.key));
        if (img && !used.has(img)) {
            used.add(img);
            cards.push({
                name: t.key,
                imagePath: img.path,
                ...(t.rawText !== undefined
                    ? { rawText: t.rawText }
                    : { textKey: t.key }),
            });
        } else {
            cards.push({
                name: t.key,
                ...(t.rawText !== undefined
                    ? { rawText: t.rawText }
                    : { textKey: t.key }),
            });
        }
    }
    const leftovers = images
        .filter((i) => !used.has(i))
        .sort((a, b) => a.basename.localeCompare(b.basename));
    for (const img of leftovers) {
        cards.push({ name: img.basename, imagePath: img.path });
    }
    return cards;
}

// ────────────────────────────────────────────────────────────────────
// State operations. All mutate the passed state in place and return
// what the caller needs; persistence is the service's problem.
// ────────────────────────────────────────────────────────────────────

/** A full deck: every index present, freshly shuffled. */
export function freshState(cardCount: number, rand: Rand): DeckState {
    return {
        total: cardCount,
        remaining: shuffledIndices(cardCount, rand),
        drawn: [],
        removed: [],
    };
}

function shuffledIndices(n: number, rand: Rand): number[] {
    const idx = Array.from({ length: n }, (_, i) => i);
    // Fisher–Yates.
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
}

/**
 * Check a loaded state against the current card list. If the deck
 * changed since the state was saved (cards added/removed → count
 * mismatch, or indices out of range), the state is stale: return a
 * fresh shuffle instead of half-valid history.
 */
export function validateState(
    state: DeckState | undefined,
    cardCount: number,
    rand: Rand
): { state: DeckState; wasStale: boolean } {
    if (
        !state ||
        state.total !== cardCount ||
        !Array.isArray(state.remaining) ||
        !Array.isArray(state.drawn) ||
        hasBadIndex(state, cardCount)
    ) {
        return { state: freshState(cardCount, rand), wasStale: state !== undefined };
    }
    if (!Array.isArray(state.removed)) state.removed = [];
    return { state, wasStale: false };
}

function hasBadIndex(state: DeckState, cardCount: number): boolean {
    const bad = (i: number): boolean =>
        !Number.isInteger(i) || i < 0 || i >= cardCount;
    return (
        state.remaining.some(bad) ||
        state.drawn.some((d) => bad(d.index)) ||
        (Array.isArray(state.removed) && state.removed.some(bad))
    );
}

/**
 * Draw the top card. Returns the record (also appended to `drawn`),
 * or null when the deck is empty. Facing rolls against `flip`.
 */
export function drawTop(
    state: DeckState,
    flip: number,
    rand: Rand,
    now: () => number = Date.now
): DrawnRecord | null {
    const index = state.remaining.shift();
    if (index === undefined) return null;
    const facing: Facing =
        flip > 0 && rand() * 100 < flip ? "reversed" : "upright";
    const rec: DrawnRecord = { index, facing, ts: now() };
    state.drawn.push(rec);
    return rec;
}

/** Look at the next n cards without drawing them. */
export function peekTop(state: DeckState, n: number): number[] {
    return state.remaining.slice(0, Math.max(0, n));
}

/**
 * Draw-and-replace: reveal the top card, then slide it back into the
 * deck at a random position. No history entry — the deck is unchanged
 * except that its order shifted, like showing a card and burying it.
 */
export function drawAndReplace(
    state: DeckState,
    flip: number,
    rand: Rand
): { index: number; facing: Facing } | null {
    const index = state.remaining.shift();
    if (index === undefined) return null;
    const facing: Facing =
        flip > 0 && rand() * 100 < flip ? "reversed" : "upright";
    const pos = Math.floor(rand() * (state.remaining.length + 1));
    state.remaining.splice(pos, 0, index);
    return { index, facing };
}

/**
 * Undo the most recent draw: the card goes back on TOP (as if the
 * draw never happened). Returns the undone record or null.
 */
export function undoDraw(state: DeckState): DrawnRecord | null {
    const rec = state.drawn.pop();
    if (!rec) return null;
    state.remaining.unshift(rec.index);
    return rec;
}

/** Shuffle: everything (except `removed`) back in, history cleared. */
export function reshuffle(state: DeckState, rand: Rand): void {
    const removed = new Set(state.removed);
    const all = Array.from({ length: state.total }, (_, i) => i).filter(
        (i) => !removed.has(i)
    );
    // Fisher–Yates over the kept indices.
    for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
    }
    state.remaining = all;
    state.drawn = [];
}

// ────────────────────────────────────────────────────────────────────
// In-generator persistent table decks (`Deck: persistent`). These
// keep IPP3's weighted-random draw (weights are meaningful on tables,
// unlike physical decks), so `remaining` is a pool, not an order.
// ────────────────────────────────────────────────────────────────────

/**
 * Weighted draw from a persistent table-deck state. `weights[i]` is
 * the weight of card/item i. Returns the drawn index or null.
 */
export function drawWeighted(
    state: DeckState,
    weights: number[],
    rand: Rand,
    now: () => number = Date.now
): number | null {
    if (state.remaining.length === 0) return null;
    let totalWeight = 0;
    for (const i of state.remaining) totalWeight += weights[i] ?? 1;
    let r = rand() * totalWeight;
    let pickPos = state.remaining.length - 1;
    for (let p = 0; p < state.remaining.length; p++) {
        const w = weights[state.remaining[p]] ?? 1;
        if (r < w) {
            pickPos = p;
            break;
        }
        r -= w;
    }
    const [index] = state.remaining.splice(pickPos, 1);
    state.drawn.push({ index, facing: "upright", ts: now() });
    return index;
}
