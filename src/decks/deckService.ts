/**
 * Deck service — the vault-facing side of persistent decks.
 *
 * Owns:
 *   - Discovery of folder decks under `<Generator Root>/Decks/`.
 *   - Loading a deck folder: card images + optional .rdm text +
 *     deck.json (settings + state), paired via deckModel.buildCards.
 *   - Debounced persistence of deck.json back into the deck folder
 *     (state travels WITH the deck — copy the folder, keep the state).
 *   - The plugin-folder deck-state.json for in-generator
 *     `Deck: persistent` tables (they have no folder of their own).
 *   - Change notifications so the Decks tab and inline spans refresh.
 *
 * Draw semantics live in deckModel.ts (pure); rendering card text
 * runs the deck's .rdm through the normal Evaluator so card entries
 * can use full generator syntax, including `{$facing}` branching.
 */

import { Notice, TFile, TFolder } from "obsidian";
import { parseGeneratorFile } from "../engine/fileParser";
import { Evaluator } from "../engine/evaluator";
import { isGeneratorPath } from "../generatorFormat";
import {
    DeckCard,
    DeckFileJson,
    DeckSettings,
    DeckState,
    DEFAULT_DECK_SETTINGS,
    DrawnRecord,
    Facing,
    ImageEntry,
    TextEntry,
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
} from "./deckModel";
import type RandomnessPlugin from "../views/main";

/** Obsidian's renderable image extensions. */
const IMAGE_EXTS = new Set([
    "avif",
    "bmp",
    "gif",
    "jpeg",
    "jpg",
    "png",
    "svg",
    "webp",
]);

/** Reserved basename for the deck's card-back image. */
const BACK_BASENAME = "_back";

export const DECK_JSON = "deck.json";

export interface FolderDeck {
    /** Deck name = folder name. */
    name: string;
    /** Vault path of the deck folder. */
    folderPath: string;
    cards: DeckCard[];
    settings: DeckSettings;
    state: DeckState;
    /** Vault path of the deck's card-back image, if present. */
    backImagePath?: string;
    /** Vault path of the deck's .rdm file, if present. */
    rdmPath?: string;
    /** Parsed .rdm source (kept for card-text evaluation). */
    rdmSource?: string;
    /** Name of the table inside the .rdm that holds the cards. */
    tableName?: string;
}

/** A drawn card, resolved for display. */
export interface DrawResult {
    deck: FolderDeck;
    card: DeckCard;
    facing: Facing;
    /** Rendered card text (dictionary value / item content), if any. */
    text?: string;
}

export class DeckService {
    private plugin: RandomnessPlugin;
    /** folderPath → loaded deck. Invalidated by vault events. */
    private cache = new Map<string, FolderDeck>();
    private listeners = new Set<() => void>();
    private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** In-generator persistent table-deck states, keyed
     * `<entry path>::<table name lowercased>`. */
    private tableStates: Record<string, DeckState> | null = null;
    private tableStateSaveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(plugin: RandomnessPlugin) {
        this.plugin = plugin;
    }

    // ── Change notification ─────────────────────────────────────────

    /** Subscribe to deck changes. Returns an unsubscribe function. */
    onChange(cb: () => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    private notify(): void {
        for (const cb of [...this.listeners]) {
            try {
                cb();
            } catch {
                // A broken listener must not take down the others.
            }
        }
    }

    /** Vault-event hook: drop cached decks affected by a path. */
    invalidatePath(path: string): void {
        const root = this.decksFolderPath() + "/";
        if (path !== this.decksFolderPath() && !path.startsWith(root)) return;
        // Deck folders are direct children: Decks/<Name>/...
        for (const key of [...this.cache.keys()]) {
            if (path === key || path.startsWith(key + "/")) {
                // Don't invalidate on our own deck.json writes — the
                // in-memory deck IS the source of those bytes.
                if (path.endsWith("/" + DECK_JSON)) return;
                this.cache.delete(key);
            }
        }
        this.notify();
    }

    // ── Discovery ───────────────────────────────────────────────────

    /** `<Generator Root>/Decks`, or `Decks` when no root is set. */
    decksFolderPath(): string {
        const root = this.plugin.settings.generatorRoot?.trim() ?? "";
        return root === "" ? "Decks" : `${root}/Decks`;
    }

    /** List all folder decks (loads/caches each). */
    async listDecks(): Promise<FolderDeck[]> {
        const folder = this.plugin.app.vault.getAbstractFileByPath(
            this.decksFolderPath()
        );
        if (!(folder instanceof TFolder)) return [];
        const decks: FolderDeck[] = [];
        for (const child of folder.children) {
            if (child instanceof TFolder) {
                const deck = await this.loadDeck(child);
                if (deck !== null) decks.push(deck);
            }
        }
        decks.sort((a, b) => a.name.localeCompare(b.name));
        return decks;
    }

    /** Find a deck by name (slug-insensitive). */
    async getDeck(name: string): Promise<FolderDeck | null> {
        const want = cardSlug(name);
        for (const deck of await this.listDecks()) {
            if (cardSlug(deck.name) === want) return deck;
        }
        return null;
    }

    private async loadDeck(folder: TFolder): Promise<FolderDeck | null> {
        const cached = this.cache.get(folder.path);
        if (cached) return cached;

        const images: ImageEntry[] = [];
        let backImagePath: string | undefined;
        let rdmFile: TFile | null = null;
        let jsonFile: TFile | null = null;
        for (const child of folder.children) {
            if (!(child instanceof TFile)) continue;
            const ext = child.extension.toLowerCase();
            if (IMAGE_EXTS.has(ext)) {
                if (child.basename.toLowerCase() === BACK_BASENAME) {
                    backImagePath = child.path;
                } else {
                    images.push({
                        path: child.path,
                        basename: child.basename,
                    });
                }
            } else if (isGeneratorPath(child.path) && rdmFile === null) {
                rdmFile = child;
            } else if (child.name === DECK_JSON) {
                jsonFile = child;
            }
        }

        // Textual cards from the .rdm, when present. The FIRST table
        // is the deck (dictionary keys, or weighted items as raw
        // card text) — matching the "first table is main" convention.
        let texts: TextEntry[] = [];
        let rdmSource: string | undefined;
        let tableName: string | undefined;
        if (rdmFile !== null) {
            try {
                rdmSource = await this.plugin.app.vault.cachedRead(rdmFile);
                const parsed = parseGeneratorFile(rdmSource);
                const table = parsed.tables[0];
                if (table) {
                    tableName = table.name;
                    if (table.type === "dictionary") {
                        texts = table.items
                            .filter((i) => i.dictKey !== undefined)
                            .map((i) => ({ key: i.dictKey as string }));
                    } else {
                        texts = table.items.map((i, n) => ({
                            key: itemDisplayName(i.rawContent, n),
                            rawText: i.rawContent,
                        }));
                    }
                }
            } catch (e) {
                new Notice(
                    `Randomness: couldn't parse deck file in "${folder.name}" — ` +
                        (e instanceof Error ? e.message : String(e))
                );
            }
        }

        const cards = buildCards(images, texts);
        if (cards.length === 0) return null;

        // deck.json: settings + saved state.
        let json: DeckFileJson = {};
        if (jsonFile !== null) {
            try {
                json = JSON.parse(
                    await this.plugin.app.vault.cachedRead(jsonFile)
                ) as DeckFileJson;
            } catch {
                new Notice(
                    `Randomness: deck.json in "${folder.name}" is invalid — starting fresh.`
                );
            }
        }
        const settings: DeckSettings = {
            ...DEFAULT_DECK_SETTINGS,
            ...(json.settings ?? {}),
        };
        const { state, wasStale } = validateState(
            json.state,
            cards.length,
            Math.random
        );
        if (wasStale) {
            new Notice(
                `Randomness: deck "${folder.name}" changed since its state was saved — reshuffled.`
            );
        }

        const deck: FolderDeck = {
            name: folder.name,
            folderPath: folder.path,
            cards,
            settings,
            state,
            backImagePath,
            rdmPath: rdmFile?.path,
            rdmSource,
            tableName,
        };
        this.cache.set(folder.path, deck);
        // First load of a deck with no saved state: persist the fresh
        // shuffle so the order is pinned (peek must not change on
        // reload).
        if (jsonFile === null || wasStale) this.scheduleSave(deck);
        return deck;
    }

    // ── Operations ──────────────────────────────────────────────────

    /** Draw the top card. Null when the deck is empty. */
    async draw(deckName: string): Promise<DrawResult | null> {
        const deck = await this.getDeck(deckName);
        if (!deck) return null;
        const rec = drawTop(deck.state, deck.settings.flip, Math.random);
        if (!rec) return null;
        this.scheduleSave(deck);
        this.notify();
        return this.resolveDraw(deck, rec.index, rec.facing);
    }

    /** Peek at the next n cards without drawing. */
    async peek(deckName: string, n: number): Promise<DrawResult[]> {
        const deck = await this.getDeck(deckName);
        if (!deck) return [];
        const out: DrawResult[] = [];
        for (const idx of peekTop(deck.state, n)) {
            out.push(await this.resolveDraw(deck, idx, "upright"));
        }
        return out;
    }

    /** Reveal the top card, then bury it back at a random position. */
    async drawAndReplace(deckName: string): Promise<DrawResult | null> {
        const deck = await this.getDeck(deckName);
        if (!deck) return null;
        const r = drawAndReplace(deck.state, deck.settings.flip, Math.random);
        if (!r) return null;
        this.scheduleSave(deck);
        this.notify();
        return this.resolveDraw(deck, r.index, r.facing);
    }

    /** Undo the last draw. Returns the undone card, or null. */
    async undo(deckName: string): Promise<DrawResult | null> {
        const deck = await this.getDeck(deckName);
        if (!deck) return null;
        const rec = undoDraw(deck.state);
        if (!rec) return null;
        this.scheduleSave(deck);
        this.notify();
        return this.resolveDraw(deck, rec.index, rec.facing);
    }

    /** Shuffle: all cards back in, history cleared. */
    async shuffle(deckName: string): Promise<boolean> {
        const deck = await this.getDeck(deckName);
        if (!deck) return false;
        reshuffle(deck.state, Math.random);
        this.scheduleSave(deck);
        this.notify();
        return true;
    }

    /** The most recent draw of a deck, resolved. Null if none. */
    async lastDrawn(deckName: string): Promise<DrawResult | null> {
        const deck = await this.getDeck(deckName);
        if (!deck) return null;
        const rec = deck.state.drawn[deck.state.drawn.length - 1];
        if (!rec) return null;
        return this.resolveDraw(deck, rec.index, rec.facing);
    }

    /** Resolve a drawn index into card + rendered text. */
    async resolveDraw(
        deck: FolderDeck,
        index: number,
        facing: Facing
    ): Promise<DrawResult> {
        const card = deck.cards[index];
        const text = this.renderCardText(deck, card, facing);
        return { deck, card, facing, ...(text !== null ? { text } : {}) };
    }

    /**
     * Render a card's text through the engine so entries can use
     * generator syntax. `{$facing}` is preset so tarot-style decks
     * can branch on orientation. Returns null for image-only cards.
     */
    renderCardText(
        deck: FolderDeck,
        card: DeckCard,
        facing: Facing
    ): string | null {
        if (deck.rdmSource === undefined || deck.tableName === undefined) {
            return null;
        }
        if (card.textKey === undefined && card.rawText === undefined) {
            return null;
        }
        try {
            const parsed = parseGeneratorFile(deck.rdmSource);
            const evaluator = new Evaluator(parsed, [], {
                presetVars: { facing },
            });
            if (card.textKey !== undefined) {
                return evaluator.runByKey(deck.tableName, card.textKey);
            }
            return evaluator.evalRawText(card.rawText as string);
        } catch (e) {
            return (
                "[card text error: " +
                (e instanceof Error ? e.message : String(e)) +
                "]"
            );
        }
    }

    // ── Persistence: folder decks ───────────────────────────────────

    private scheduleSave(deck: FolderDeck): void {
        const existing = this.saveTimers.get(deck.folderPath);
        if (existing !== undefined) clearTimeout(existing);
        this.saveTimers.set(
            deck.folderPath,
            setTimeout(() => {
                this.saveTimers.delete(deck.folderPath);
                void this.saveDeck(deck);
            }, 400)
        );
    }

    private async saveDeck(deck: FolderDeck): Promise<void> {
        const path = `${deck.folderPath}/${DECK_JSON}`;
        const json: DeckFileJson = {
            settings: deck.settings,
            state: deck.state,
        };
        try {
            await this.plugin.app.vault.adapter.write(
                path,
                JSON.stringify(json, null, 2)
            );
        } catch (e) {
            new Notice(
                `Randomness: couldn't save deck state for "${deck.name}" — ` +
                    (e instanceof Error ? e.message : String(e))
            );
        }
    }

    /** Flush all pending saves now (plugin unload). */
    async flush(): Promise<void> {
        const pending = [...this.saveTimers.keys()];
        for (const key of pending) {
            const timer = this.saveTimers.get(key);
            if (timer !== undefined) clearTimeout(timer);
            this.saveTimers.delete(key);
            const deck = this.cache.get(key);
            if (deck) await this.saveDeck(deck);
        }
        await this.saveTableStates(true);
    }

    /** Update a deck's settings (Decks tab controls) and persist. */
    async updateSettings(
        deckName: string,
        patch: Partial<DeckSettings>
    ): Promise<void> {
        const deck = await this.getDeck(deckName);
        if (!deck) return;
        Object.assign(deck.settings, patch);
        this.scheduleSave(deck);
        this.notify();
    }

    // ── In-generator persistent table decks ─────────────────────────

    private tableStatePath(): string {
        return `${this.plugin.manifest.dir ?? ""}/deck-state.json`;
    }

    private async loadTableStates(): Promise<Record<string, DeckState>> {
        if (this.tableStates !== null) return this.tableStates;
        try {
            const raw = await this.plugin.app.vault.adapter.read(
                this.tableStatePath()
            );
            this.tableStates = JSON.parse(raw) as Record<string, DeckState>;
        } catch {
            this.tableStates = {};
        }
        return this.tableStates;
    }

    private async saveTableStates(immediate = false): Promise<void> {
        if (this.tableStates === null) return;
        if (this.tableStateSaveTimer !== null) {
            clearTimeout(this.tableStateSaveTimer);
            this.tableStateSaveTimer = null;
        }
        const write = async (): Promise<void> => {
            try {
                await this.plugin.app.vault.adapter.write(
                    this.tableStatePath(),
                    JSON.stringify(this.tableStates, null, 2)
                );
            } catch {
                // Plugin dir unwritable — nothing sensible to do.
            }
        };
        if (immediate) return write();
        this.tableStateSaveTimer = setTimeout(() => {
            this.tableStateSaveTimer = null;
            void write();
        }, 400);
    }

    /**
     * Build the synchronous evaluator hosts for one evaluation run.
     *
     * The evaluator is synchronous, so all deck data must be in
     * memory before the run starts — call this (it preloads) and pass
     * the hosts via EvaluatorOptions. Mutations are committed back to
     * disk only when `commit` is true: passive renders (codeblocks
     * scrolling into view, first inline previews) must never burn a
     * card, per the design's interaction rule.
     */
    async buildEvalHosts(
        entryPath: string,
        commit: boolean
    ): Promise<{
        deckHost: import("../engine/evaluator").TableDeckHost;
        folderDeckHost: import("../engine/evaluator").FolderDeckHost;
        /**
         * Persist and broadcast this run's draws. The caller invokes
         * it AFTER the evaluator finishes; no-op when commit=false.
         */
        commitDraws: () => void;
    }> {
        const tableStates = await this.loadTableStates();
        const folderDecks = await this.listDecks();
        const byName = new Map<string, FolderDeck>();
        for (const d of folderDecks) byName.set(cardSlug(d.name), d);

        // Non-commit runs operate on throwaway copies so previews
        // show plausible draws without consuming anything. The copy
        // is made once per run and shared across that run's draws,
        // so no-duplicates still holds WITHIN the run.
        const folderStates = new Map<string, DeckState>();
        const getFolderState = (deck: FolderDeck): DeckState => {
            let s = folderStates.get(deck.folderPath);
            if (!s) {
                s = commit ? deck.state : structuredClone(deck.state);
                folderStates.set(deck.folderPath, s);
            }
            return s;
        };
        const runTableStates = new Map<string, DeckState>();
        const getTableState = (key: string, weights: number[]): DeckState => {
            let s = runTableStates.get(key);
            if (s) return s;
            const stored = tableStates[key];
            const valid =
                stored &&
                stored.total === weights.length &&
                stored.remaining.every(
                    (i) => Number.isInteger(i) && i >= 0 && i < weights.length
                );
            if (valid) {
                s = commit ? stored : structuredClone(stored);
            } else {
                // Table decks draw weighted from a pool; the shuffled
                // ORDER produced by freshState is irrelevant but
                // harmless.
                s = freshState(weights.length, Math.random);
                if (commit) tableStates[key] = s;
            }
            runTableStates.set(key, s);
            return s;
        };

        const service = this;
        const touchedDecks = new Set<FolderDeck>();
        let touchedTables = false;

        const deckHost = {
            draw(tableName: string, weights: number[]): number | null {
                const key = `${entryPath}::${tableName.toLowerCase()}`;
                const state = getTableState(key, weights);
                if (commit) touchedTables = true;
                return drawWeighted(state, weights, Math.random);
            },
            reset(tableName: string): void {
                const key = `${entryPath}::${tableName.toLowerCase()}`;
                runTableStates.delete(key);
                if (tableStates[key]) {
                    delete tableStates[key];
                    if (commit) touchedTables = true;
                }
            },
        };

        const folderDeckHost = {
            exists(name: string): boolean {
                return byName.has(cardSlug(name));
            },
            draw(name: string): string | null {
                const deck = byName.get(cardSlug(name));
                if (!deck) return null;
                const state = getFolderState(deck);
                const rec = drawTop(
                    state,
                    deck.settings.flip,
                    Math.random
                );
                if (!rec) return null;
                if (commit) touchedDecks.add(deck);
                return service.formatCardInline(deck, rec);
            },
            reset(name: string): void {
                const deck = byName.get(cardSlug(name));
                if (!deck) return;
                const state = getFolderState(deck);
                reshuffle(state, Math.random);
                if (commit) touchedDecks.add(deck);
            },
        };

        const commitDraws = (): void => {
            if (!commit) return;
            for (const deck of touchedDecks) this.scheduleSave(deck);
            if (touchedTables) void this.saveTableStates();
            if (touchedDecks.size > 0 || touchedTables) this.notify();
        };

        return { deckHost, folderDeckHost, commitDraws };
    }

    /**
     * Text form of a drawn card for engine output: card name (with
     * facing suffix), image embed when the card has one, and the
     * rendered card text when it has any.
     */
    private formatCardInline(deck: FolderDeck, rec: DrawnRecord): string {
        const card = deck.cards[rec.index];
        let out = card.name;
        if (rec.facing === "reversed") out += " (reversed)";
        if (card.imagePath !== undefined) {
            out = `![[${card.imagePath}]]\n` + out;
        }
        const text = this.renderCardText(deck, card, rec.facing);
        if (text !== null && text.trim() !== "") {
            out += ` — ${text}`;
        }
        return out;
    }
}

/**
 * Display name for a weighted-table card: first line of its content,
 * truncated. Falls back to "Card N" for empty items.
 */
function itemDisplayName(rawContent: string, index: number): string {
    const firstLine = rawContent.split("\n")[0].trim();
    if (firstLine === "") return `Card ${index + 1}`;
    return firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine;
}
