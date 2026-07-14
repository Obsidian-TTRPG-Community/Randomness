/**
 * Core evaluator. Takes a parsed GeneratorFile + a registry of additional
 * tables (from Use:d files) and produces output by rolling on the main
 * table.
 *
 * The evaluator owns:
 *   - The variable scope (global, with parameter overrides for table calls)
 *   - The RNG
 *   - Table state (deck-pick shuffled state)
 *   - The set of tables visible (main + Use'd files)
 *
 * Builtin variables are seeded at construction. Prompts are seeded too —
 * their default values are used unless overridden via setPromptValue().
 */

import { GeneratorFile, Node, TableDecl, TableItem } from "./ast";
import { parseContent } from "./contentParser";
import { DiceTraceEntry } from "./dice";
import { ExprContext, evaluateExpression, Value } from "./expressions";
import { FilterContext, applyFilters } from "./filters";
import { RNG } from "./rng";

export interface EvaluatorOptions {
    seed?: number;
    /** Repetitions to run the main table. Capped by file's MaxReps. */
    reps?: number;
    /** Optional override for prompt values (label → value). */
    promptValues?: Record<string, string>;
    /** Date for the {date} built-in. Defaults to now. */
    now?: Date;
    /**
     * Extra variables seeded at construction (after built-ins, before
     * Set: lines — so generators can still override them). Used by
     * the deck service to preset {$facing} when rendering card text.
     */
    presetVars?: Record<string, string>;
    /**
     * Host for `Deck: persistent` tables. When present, deck picks on
     * a persistent table draw through the host (whose state outlives
     * this evaluator) instead of the per-run deckState. Absent →
     * persistent tables silently fall back to per-run semantics,
     * which keeps tests/API contexts working unchanged.
     */
    deckHost?: TableDeckHost;
    /**
     * Host for `[!deck:Name]` folder-deck picks. The host owns the
     * deck data (preloaded — the evaluator is synchronous) and
     * returns the drawn card's rendered text. Absent → `[!deck:…]`
     * throws a clear "not available here" error.
     */
    folderDeckHost?: FolderDeckHost;
    /**
     * Maximum nesting depth for table calls before bailing out. Each call
     * to runTable (whether from a subtable roll, pick, deck pick, inline
     * table, or `each` filter) counts as one level. Default 100, which
     * comfortably covers legitimate recursion (the AddCommas pattern in the
     * corpus tops out under 10) while catching unbounded self-reference
     * before it blows the JS stack.
     */
    maxRecursionDepth?: number;
    /**
     * Optional sink for individual dice terms rolled during this
     * evaluation. Each `{NdX…}` term reports its notation, per-die
     * faces, and total, in roll order — including dice rolled inside
     * sub-table calls. Used by the inline renderer and dice tray to
     * show what each die rolled instead of only the sum.
     */
    onDice?: (entry: DiceTraceEntry) => void;
}

/**
 * Thrown when a generator's table calls nest past `maxRecursionDepth`.
 * Held as a distinct class so the UI layer can catch and surface a
 * helpful message — "your generator looks infinitely recursive" — rather
 * than letting a RangeError bubble up.
 */
export class RecursionLimitError extends Error {
    constructor(public depth: number, public tableName: string) {
        super(
            `Table recursion limit (${depth}) exceeded at '${tableName}'. ` +
                `This usually means a table calls itself (directly or via a chain) ` +
                `without a base case. Increase EvaluatorOptions.maxRecursionDepth ` +
                `if your generator legitimately needs deeper nesting.`
        );
        this.name = "RecursionLimitError";
    }
}

const DEFAULT_MAX_RECURSION_DEPTH = 100;

/**
 * Host interface for persistent table decks (`Deck: persistent`).
 * The host owns state that outlives the evaluator — keying,
 * persistence, and history are its business (see DeckService).
 */
export interface TableDeckHost {
    /**
     * Draw one item from the persistent deck for `tableName`.
     * `weights[i]` is item i's weight. Returns the drawn item index,
     * or null when the deck is exhausted.
     */
    draw(tableName: string, weights: number[]): number | null;
    /** Reset (reshuffle) the persistent deck for `tableName`. */
    reset(tableName: string): void;
}

/** Host interface for folder decks referenced as `[!deck:Name]`. */
export interface FolderDeckHost {
    /** Whether a folder deck with this name exists. */
    exists(name: string): boolean;
    /**
     * Draw the top card, returning its rendered text (name, image
     * embed, card text). Null when the deck is empty.
     */
    draw(name: string): string | null;
    /** Reshuffle the named folder deck. */
    reset(name: string): void;
}

/** `deck:` prefix marking a folder-deck reference in `[!…]` calls
 * and `Shuffle:` targets. Case-insensitive. */
const FOLDER_DECK_PREFIX = /^deck:\s*/i;

export class Evaluator {
    private rng: RNG;
    private vars: Map<string, Value> = new Map();

    /**
     * Variable names are case-insensitive in IPP3 — `{$prompt1}` and
     * `{$Prompt1}` and `{$PROMPT1}` all refer to the same variable.
     * All lookups and writes flow through this normaliser so the
     * underlying Map keys are consistent.
     */
    private static varKey(name: string): string {
        return name.toLowerCase();
    }
    private getVar(name: string): Value | undefined {
        return this.vars.get(Evaluator.varKey(name));
    }
    private setVar(name: string, value: Value): void {
        this.vars.set(Evaluator.varKey(name), value);
    }
    private hasVar(name: string): boolean {
        return this.vars.has(Evaluator.varKey(name));
    }
    private deleteVar(name: string): void {
        this.vars.delete(Evaluator.varKey(name));
    }

    /** Tables visible to this evaluator, keyed by table name (case-insensitive). */
    private tables: Map<string, TableDecl> = new Map();
    /** Cached parsed Node[] per table item, keyed by item identity. */
    private contentCache = new WeakMap<TableItem, Node[]>();
    /** Lazy assignments for Define: vars — re-evaluated each use. */
    private defines: Map<string, string> = new Map();
    /** Deck-pick state: tableName → indexes still available. Reset per top-level rep. */
    private deckState: Map<string, Set<number>> = new Map();
    private formatting: "html" | "text" = "html";
    /** Current nesting depth of runTable; guarded against maxRecursionDepth. */
    private callDepth = 0;
    /**
     * Position (1-indexed) of the current item being processed in
     * its parent table's items array. Used to implement the IPP3
     * "current-index pick" idiom: `[#sometable]` with no leading
     * token picks the item at *this* position in `sometable`. So
     * if the 3rd item in TableA is being processed and contains
     * `[#TableB]`, TableB's 3rd item is what gets picked.
     *
     * Tracked as a stack so the value restores correctly across
     * nested subtable calls (`[@inner]` running inside an item
     * shouldn't permanently clobber the outer index).
     */
    private currentItemIndexStack: number[] = [];
    /** Resolved cap (option or default). */
    private maxDepth: number;

    constructor(
        private file: GeneratorFile,
        private extraFiles: GeneratorFile[] = [],
        private opts: EvaluatorOptions = {}
    ) {
        this.rng = new RNG(opts.seed);
        this.formatting = file.formatting ?? "html";
        this.maxDepth = opts.maxRecursionDepth ?? DEFAULT_MAX_RECURSION_DEPTH;

        // Register tables from main and extras
        for (const f of [file, ...extraFiles]) {
            for (const t of f.tables) {
                this.tables.set(t.name.toLowerCase(), t);
            }
        }

        // Seed built-in variables
        const now = opts.now ?? new Date();
        this.setVar("app", "Randomness");
        this.setVar("version", "0.6.0");
        this.setVar("os", "browser");
        this.setVar("cli", "");
        this.setVar("hostlanguage", "en");
        this.setVar("date", now.toLocaleDateString());
        this.setVar("time", now.toLocaleTimeString());
        this.setVar("formatting", this.formatting);
        this.setVar("rep", 1);
        this.setVar("fullpath", "");
        this.setVar("docpath", "");
        this.setVar("self", "");
        this.setVar("builddate", "");

        // Preset vars (deck service's {$facing}, etc.). Seeded after
        // built-ins so they can shadow them, before Set: lines so
        // generators keep the last word.
        if (opts.presetVars) {
            for (const [k, v] of Object.entries(opts.presetVars)) {
                this.setVar(k, v);
            }
        }

        // Seed prompts (use defaults or overrides). Each prompt seeds
        // its positional var ({$prompt1}…) and — when the label is a
        // plain identifier — a var named after the label itself
        // ({$keeperName}), so generators can reference prompts
        // position-independently. Table-level Set: lines run later and
        // can still overwrite either form.
        for (let i = 0; i < file.prompts.length; i++) {
            const p = file.prompts[i];
            const override = opts.promptValues?.[p.label];
            const value = override ?? p.defaultValue;
            this.setVar(`prompt${i + 1}`, value);
            if (/^[A-Za-z_]\w*$/.test(p.label)) this.setVar(p.label, value);
        }

        // Apply Use'd files' top-level Sets/Defines
        for (const f of extraFiles) {
            for (const a of f.topLevelSets) {
                if (a.kind === "define") {
                    this.defines.set(a.name, a.valueSource);
                } else {
                    this.setVar(a.name, this.evalRawText(a.valueSource));
                }
            }
        }
        // Then main file's
        for (const a of file.topLevelSets) {
            if (a.kind === "define") {
                this.defines.set(a.name, a.valueSource);
            } else {
                this.setVar(a.name, this.evalRawText(a.valueSource));
            }
        }
    }

    /**
     * Run the main (first) table N times, returning the joined output.
     *
     * Reps default reasoning:
     *   - If the caller explicitly passes `opts.reps`, use it (capped
     *     by MaxReps if also set).
     *   - Else if the file declares `MaxReps: N`, use N. IPP3's
     *     `MaxReps: 5` means the author wants 5 results; respecting
     *     this is essential for generators authored against the
     *     original tool.
     *   - Else default to 1. In an Obsidian codeblock you usually
     *     want one result; running 25 (IPP3 desktop default) by
     *     default would flood the note.
     */
    run(): string {
        const main = this.file.tables[0];
        if (!main) return "";
        let reps: number;
        if (this.opts.reps !== undefined) {
            // Explicit caller request; clamp to MaxReps if file caps it.
            const cap = this.file.maxReps ?? Infinity;
            reps = Math.min(this.opts.reps, cap);
        } else if (this.file.maxReps !== undefined) {
            // File-author intent.
            reps = this.file.maxReps;
        } else {
            reps = 1;
        }
        const results: string[] = [];
        for (let i = 0; i < reps; i++) {
            this.setVar("rep", i + 1);
            this.deckState.clear();
            results.push(this.runTable(main, []));
        }
        // Reps are joined with a BLANK LINE between them — `\n\n`
        // gives each result its own visual block when displayed
        // (via the engineOutputToHtml `\n` → `<br>` translation,
        // double newline becomes `<br><br>` which renders as a
        // paragraph-style gap) and pastes cleanly into markdown
        // as a paragraph break.
        //
        // Without this, a `MaxReps: 5` altar generator would
        // render all five descriptions packed into one wall of
        // text — the rows were technically on separate lines but
        // visually indistinguishable from line wrapping within a
        // single roll. Real IPP3 separates reps with the same
        // visual block treatment.
        //
        // Single-rep output has no join, so this only affects
        // multi-rep results.
        let out = results.join("\n\n");
        // Header and Footer get the same blank-line separation so
        // they sit as distinct blocks rather than mashing into
        // the first/last rep's lines.
        if (this.file.header) out = this.file.header + "\n\n" + out;
        if (this.file.footer) out = out + "\n\n" + this.file.footer;
        return out;
    }

    /** Run a specific table by name (for engine introspection / tests). */
    runByName(name: string): string {
        const t = this.tables.get(name.toLowerCase());
        if (!t) throw new Error(`Unknown table: ${name}`);
        return this.runTable(t, []);
    }

    /**
     * Pick and render a specific entry from a dictionary table by key.
     *
     * Used by the API's `dictKey` option. Unlike the IPP3
     * `[#<key> <Table>]` expression form, the key here is taken
     * literally — it can contain spaces, hyphens, quotes, anything —
     * because we look it up directly rather than parsing it out of an
     * expression string where whitespace would split it.
     *
     * Returns "" for unknown keys (matching IPP3's `[#bogus Table]`
     * semantics). Throws for unknown tables or wrong table type.
     */
    runByKey(name: string, key: string): string {
        const t = this.tables.get(name.toLowerCase());
        if (!t) throw new Error(`Unknown table: ${name}`);
        if (t.type !== "dictionary") {
            throw new Error(
                `Table "${name}" is not a dictionary (Type: ${t.type}); ` +
                    `dictKey only applies to Type: Dictionary tables.`
            );
        }
        // Apply in-table Sets/Defines first (matches runTable's
        // contract), so any value expression referring to a Set'd
        // variable still works. We don't push positional params —
        // dictionary lookups don't take positional args.
        for (const a of t.inTableSets) {
            if (a.kind === "define") {
                this.defines.set(a.name, a.valueSource);
            } else {
                this.setVar(a.name, this.evalRawText(a.valueSource));
            }
        }
        const item = this.pickDictItem(t, key);
        if (!item) return "";
        const nodes = this.parseItem(item);
        // Push positional index so [#current-pick] inside the item
        // resolves (parallels runTable behaviour).
        this.currentItemIndexStack.push(t.items.indexOf(item) + 1);
        try {
            return this.renderNodes(nodes);
        } finally {
            this.currentItemIndexStack.pop();
        }
    }

    /** Evaluate a free-form content string (used for inline `rdm:` calls). */
    evalRawText(source: string): string {
        const nodes = parseContent(source);
        return this.renderNodes(nodes);
    }

    // ─────────── Table execution ───────────

    private runTable(table: TableDecl, params: string[]): string {
        // Recursion guard — see RecursionLimitError. We check BEFORE
        // incrementing so the error names the table that tipped us over,
        // not the one that would have run next.
        if (this.callDepth >= this.maxDepth) {
            throw new RecursionLimitError(this.maxDepth, table.name);
        }
        this.callDepth++;

        // Save and inject parameters as $1, $2, ...
        const savedParams: { name: string; value?: Value }[] = [];
        for (let i = 0; i < params.length; i++) {
            const n = String(i + 1);
            savedParams.push({ name: n, value: this.getVar(n) });
            this.setVar(n, params[i]);
        }

        try {
            // Apply Shuffle commands — reset deck state for those tables
            for (const targetName of table.shuffleTargets) {
                this.shuffleTable(targetName);
            }
            // Apply in-table Sets/Defines
            for (const a of table.inTableSets) {
                if (a.kind === "define") {
                    this.defines.set(a.name, a.valueSource);
                } else {
                    this.setVar(a.name, this.evalRawText(a.valueSource));
                }
            }
            // Pick an item
            const picked = this.pickItem(table);
            if (!picked) {
                // Use default if available
                if (table.defaultValue) {
                    return this.evalRawText(table.defaultValue);
                }
                return "";
            }
            const { item, index } = picked;
            const nodes = this.parseItem(item);
            // Push the picked item's positional index (1-based) so
            // any `[#sometable]` inside the item — the "current-
            // index pick" idiom — picks from `sometable` at the
            // same position. Stack-based so nested table calls
            // don't permanently clobber outer indices.
            this.currentItemIndexStack.push(index + 1);
            try {
                return this.renderNodes(nodes);
            } finally {
                this.currentItemIndexStack.pop();
            }
        } finally {
            // Restore params
            for (const sp of savedParams) {
                if (sp.value === undefined) this.deleteVar(sp.name);
                else this.setVar(sp.name, sp.value);
            }
            this.callDepth--;
        }
    }

    /** Pick one item from a table according to its Type. */
    private pickItem(
        table: TableDecl,
        forcedIndex?: number
    ): { item: TableItem; index: number } | null {
        // Helper to wrap an item with its positional index. Lookup
        // tables care about the listing index (so authors can use
        // "current-index pick" cross-references like cross-indexed
        // d20 tables); ranges have nothing to do with this.
        const wrap = (item: TableItem) => ({
            item,
            index: table.items.indexOf(item),
        });

        if (forcedIndex !== undefined) {
            // IPP3 contract for [#n Table]:
            //   - On a Lookup table, n is treated as the lookup-roll
            //     value: find the item whose range contains n. So
            //     `[#5 Weapons]` against a lookup table with items
            //     `5-6: Spear` returns Spear, not the 5th positional
            //     item. This is the natural reading of "pick using
            //     this as the roll" for lookup tables.
            //   - On a Weighted (or dictionary-misused-as-weighted)
            //     table, n is 1-indexed positional — `[#3 Names]`
            //     returns the third listed item.
            //
            // The previous implementation positional-indexed even
            // into lookup tables, which silently miscalculated
            // every `[#dice Table]` pattern: a `[#{1d6} weapons]`
            // against a lookup table with multi-row ranges would
            // skip past items and land beyond the dice's actual
            // range. Real generators (orcs/goblins armed by tier-
            // limited dice rolls) were getting wrong-tier weapons.
            if (table.type === "lookup") {
                for (const item of table.items) {
                    if (
                        item.lookupRange &&
                        forcedIndex >= item.lookupRange[0] &&
                        forcedIndex <= item.lookupRange[1]
                    ) {
                        return wrap(item);
                    }
                }
                // No matching range — let the caller fall back to
                // table.defaultValue if defined.
                return null;
            }
            // Weighted / other: 1-indexed positional.
            const idx = forcedIndex - 1;
            const item = table.items[idx];
            return item ? { item, index: idx } : null;
        }
        if (table.type === "lookup") {
            // Roll the table's Roll expression, look up the range. If no
            // explicit Roll: directive was given, infer from the highest
            // lookup-range value (e.g. items going up to 100 → roll
            // 1d100). This matches IPP3's default behaviour — authors
            // commonly omit `Roll:` for d% tables.
            let rollExpr = table.rollExpr;
            if (!rollExpr) {
                let maxHi = 0;
                for (const it of table.items) {
                    if (it.lookupRange && it.lookupRange[1] > maxHi) {
                        maxHi = it.lookupRange[1];
                    }
                }
                if (maxHi > 0) rollExpr = `1d${maxHi}`;
            }
            if (!rollExpr) return null;
            const roll = this.evalRollExpression(rollExpr);
            for (const item of table.items) {
                if (item.lookupRange && roll >= item.lookupRange[0] && roll <= item.lookupRange[1]) {
                    return wrap(item);
                }
            }
            return null;
        }
        if (table.type === "dictionary") {
            // Dictionary tables shouldn't be rolled randomly — only picked by key
            return null;
        }
        // Weighted: pick by weights
        let totalWeight = 0;
        for (const item of table.items) totalWeight += item.weight ?? 1;
        if (totalWeight <= 0) return null;
        let r = this.rng.next() * totalWeight;
        for (let i = 0; i < table.items.length; i++) {
            const item = table.items[i];
            const w = item.weight ?? 1;
            if (r < w) return { item, index: i };
            r -= w;
        }
        const lastIdx = table.items.length - 1;
        const lastItem = table.items[lastIdx];
        return lastItem ? { item: lastItem, index: lastIdx } : null;
    }

    /** Pick a single deck-pick item from a table (no duplicates within shuffle). */
    private pickDeckItem(table: TableDecl): TableItem | null {
        // Persistent table decks (`Deck: persistent`) draw through
        // the host, whose state outlives this evaluator. Without a
        // host (tests, API contexts) they fall back to the per-run
        // path below — same in-run semantics, no persistence.
        if (table.deckPersistent === true && this.opts.deckHost) {
            const weights = table.items.map((it) => it.weight ?? 1);
            const idx = this.opts.deckHost.draw(table.name, weights);
            return idx === null ? null : table.items[idx] ?? null;
        }
        const key = table.name.toLowerCase();
        let avail = this.deckState.get(key);
        if (!avail) {
            avail = new Set();
            for (let i = 0; i < table.items.length; i++) avail.add(i);
            this.deckState.set(key, avail);
        }
        if (avail.size === 0) return null;
        // Weighted deck pick: respect weights of remaining items
        const indices = Array.from(avail);
        let totalWeight = 0;
        for (const i of indices) totalWeight += table.items[i].weight ?? 1;
        let r = this.rng.next() * totalWeight;
        for (const i of indices) {
            const w = table.items[i].weight ?? 1;
            if (r < w) {
                avail.delete(i);
                return table.items[i];
            }
            r -= w;
        }
        const last = indices[indices.length - 1];
        avail.delete(last);
        return table.items[last];
    }

    /** Look up dictionary table by key, returning a TableItem or null. */
    private pickDictItem(table: TableDecl, key: string): TableItem | null {
        for (const item of table.items) {
            if (item.dictKey && item.dictKey.toLowerCase() === key.toLowerCase()) return item;
        }
        return null;
    }

    private shuffleTable(name: string) {
        // `Shuffle: deck:Name` resets a folder deck through its host.
        const deckRef = name.match(FOLDER_DECK_PREFIX);
        if (deckRef !== null) {
            this.opts.folderDeckHost?.reset(name.slice(deckRef[0].length));
            return;
        }
        // Persistent table decks reset through the host (state
        // outlives this evaluator); per-run decks just clear local
        // state — re-initialised on the next deck pick.
        const table = this.tables.get(name.toLowerCase());
        if (table?.deckPersistent === true && this.opts.deckHost) {
            this.opts.deckHost.reset(table.name);
            return;
        }
        this.deckState.delete(name.toLowerCase());
    }

    /** Get cached parsed content nodes for a table item. */
    private parseItem(item: TableItem): Node[] {
        let nodes = this.contentCache.get(item);
        if (!nodes) {
            nodes = parseContent(item.rawContent);
            this.contentCache.set(item, nodes);
        }
        return nodes;
    }

    /** Render an array of content nodes to a string. */
    private renderNodes(nodes: Node[]): string {
        let out = "";
        for (let i = 0; i < nodes.length; i++) {
            const piece = this.renderNode(nodes[i], nodes, i);
            // \a escape needs to look ahead at the rest for vowel detection
            out += piece;
        }
        // Post-process: handle \a (a/an) by looking at the next non-whitespace char.
        // Simpler: handle inline during render; we use a marker character for now.
        return out;
    }

    private renderNode(n: Node, allNodes: Node[], index: number): string {
        switch (n.type) {
            case "text": return n.value;
            case "escape": {
                switch (n.kind) {
                    case "n": return "\n";
                    case "t": return "\t";
                    case "_": return " ";
                    case "z": return "";
                    case "a": {
                        // Look ahead to find first non-whitespace
                        // word to decide a/an. IPP3 docs explicitly
                        // promise common English exceptions are
                        // handled — "an hour", "a university",
                        // "an MBA" etc. — so this isn't just a
                        // vowel check.
                        //
                        // Rule:
                        //   1. If the upcoming word is in the
                        //      consonant-sounding exceptions list
                        //      (starts vowel, sounds consonant),
                        //      use "a".
                        //   2. If the upcoming word is in the
                        //      vowel-sounding exceptions list
                        //      (starts consonant, sounds vowel),
                        //      use "an".
                        //   3. Otherwise default to the vowel
                        //      rule on the first letter.
                        //
                        // The lists below are pragmatic, not
                        // exhaustive. IPP3 includes ~20-30 common
                        // exception roots; we match the most common
                        // ones authors actually hit in TTRPG
                        // generators (honest merchant, hourly wage,
                        // university campus, MBA, NPC, etc).
                        const rest = this.peekRest(allNodes, index + 1);
                        const wordMatch = rest.match(/^\s*([A-Za-z]+)/);
                        const word = wordMatch ? wordMatch[1].toLowerCase() : "";
                        const firstCh = word[0] ?? "";

                        // Words beginning with vowels that take "a"
                        // (consonant-y or eu/u-as-/juː/ sound).
                        const consonantSounding = [
                            "uni", "use", "user", "ubi", "euro",
                            "european", "eulog", "eunuch", "uten",
                            "unif", "unit", "univ", "ufo",
                            "one", "once",
                        ];
                        // Words beginning with consonants that take "an"
                        // (silent-H or letter-name-vowel-sound).
                        const vowelSounding = [
                            "hour", "honest", "honor", "honour",
                            "heir", "herb", // US pronunciation: silent h
                        ];

                        // Single-letter sequences like "MBA", "FBI",
                        // "NPC", "RPG" — pronounced as letter names.
                        // Letter-name first-syllable vowel set: F, H, L,
                        // M, N, R, S, X (all begin with vowel sound
                        // when said as a letter). If the word is all
                        // uppercase (likely an acronym) and starts
                        // with one of these, use "an".
                        let useAn: boolean;
                        if (consonantSounding.some(s => word.startsWith(s))) {
                            useAn = false;
                        } else if (vowelSounding.some(s => word.startsWith(s))) {
                            useAn = true;
                        } else if (
                            wordMatch &&
                            wordMatch[1] === wordMatch[1].toUpperCase() &&
                            wordMatch[1].length > 1 &&
                            "FHLMNRSX".includes(wordMatch[1][0])
                        ) {
                            useAn = true;
                        } else {
                            useAn = "aeiou".includes(firstCh);
                        }
                        return useAn ? "an" : "a";
                    }
                    case "literal": return n.literal ?? "";
                }
                return "";
            }
            case "variable": {
                if (this.hasVar(n.name)) return String(this.getVar(n.name));
                const def = this.defines.get(n.name);
                if (def !== undefined) {
                    // Re-evaluate the define lazily each time it's referenced
                    return this.evalRawText(def);
                }
                return "";
            }
            case "dice": {
                const v = this.evalRollExpression(n.source);
                return String(v);
            }
            case "expression": {
                const result = evaluateExpression(n.source, this.exprContext());
                if (result.assignedVarName !== undefined && result.quiet) return "";
                return String(result.value);
            }
            case "subtable_roll": return this.runSubtableRollNode(n);
            case "subtable_pick": return this.runSubtablePickNode(n);
            case "deck_pick": return this.runDeckPickNode(n);
            case "inline_table": return this.runInlineTableNode(n);
            case "literal_bracket": {
                // Two flavours of literal_bracket reach this path:
                //
                // 1. Real literal_bracket — the user wrote `[hello]`
                //    and `text` is the *inside*, "hello". Re-parsing
                //    this is correct: it can contain interpolations
                //    like `{$var}` that still need to render.
                //
                // 2. Marker form — the parser emits these as
                //    transport-only nodes for the conditional
                //    coalescer (see `[when]`/`[do]`/`[else]`/`[end]`).
                //    Their `text` field deliberately *retains* the
                //    outer brackets (e.g. `text: "[do]"`) so the
                //    coalescer can spot them. The coalescer is
                //    supposed to consume these before they ever reach
                //    rendering — but when they're nested inside
                //    another structure (e.g. a Set:'s value), the
                //    outer parse can leak them through.
                //
                // If we re-parse a marker, `parseContent("[do]")`
                // returns the same marker node, and we recurse
                // forever. So: detect markers strictly — text
                // EXACTLY equals a known marker — and emit them as
                // literal text. Genuine wrapped expressions like
                // `text: "[when]…[end]"` (from `[[when]…[end]]`)
                // still re-parse and coalesce normally.
                const isMarker = /^\[(?:when not|when|do|else|end)\]$/i.test(n.text);
                const innerText = isMarker
                    ? n.text
                    : this.renderNodes(parseContent(n.text));
                // IPP3 convention: the literal text inside `[...]`
                // is trimmed before filters apply. Authors write
                // `[ this is bold >> Bold]` with a leading space
                // for readability between the `[` and the content;
                // that space isn't meant to land in `<b> this is
                // bold </b>`. Same trimming applies to trailing
                // whitespace before `>>`. If a generator genuinely
                // needs leading/trailing spaces in filter input,
                // they can use `\_` to express that explicitly —
                // the same convention IPP3 uses for `implode` glue
                // strings.
                const trimmed = innerText.replace(/^\s+|\s+$/g, "");
                const result = applyFilters(trimmed, n.filters, this.filterContext());
                return result;
            }
            case "conditional": {
                const cond = this.evalConditionTruthy(n.conditionSource);
                const truthy = n.negated ? !cond : cond;
                if (truthy) return this.evalRawText(n.thenSource);
                if (n.elseSource) return this.evalRawText(n.elseSource);
                return "";
            }
        }
        return "";
    }

    /** Concatenate remaining nodes' text for \a lookahead. */
    private peekRest(nodes: Node[], from: number): string {
        let s = "";
        for (let i = from; i < nodes.length && s.length < 30; i++) {
            const n = nodes[i];
            if (n.type === "text") s += n.value;
            else if (n.type === "escape" && n.kind === "literal" && n.literal) s += n.literal;
            else if (n.type === "escape" && n.kind === "_") s += " ";
            else break;
        }
        return s;
    }

    private evalConditionTruthy(source: string): boolean {
        const trimmed = source.trim();
        if (trimmed === "") return false;
        // IPP3 conditions are textual: render the full condition source as content,
        // then look for a comparison operator at the top level and compare the
        // two halves as strings (with numeric coercion if both look numeric).
        // This matches how `{$prompt1}=Random` should behave: render `{$prompt1}`
        // to its value, render `Random` to itself, compare.
        const opMatch = findTopLevelComparisonOp(trimmed);
        if (opMatch) {
            const lhsRaw = trimmed.slice(0, opMatch.pos);
            const rhsRaw = trimmed.slice(opMatch.pos + opMatch.op.length);
            const lhs = this.evalRawText(lhsRaw).trim();
            const rhs = this.evalRawText(rhsRaw).trim();
            return compareTextual(lhs, rhs, opMatch.op);
        }
        // No comparison operator — render and treat as truthy if non-empty
        const rendered = this.evalRawText(trimmed).trim();
        return rendered.length > 0 && rendered !== "0";
    }

    /** Evaluate a roll-style expression source (e.g. "1d10", "1d6+2"). */
    private evalRollExpression(source: string): number {
        const result = evaluateExpression(source, this.exprContext());
        return Math.floor(Number(result.value));
    }

    // ─────────── Sub-table call nodes ───────────

    private runSubtableRollNode(n: import("./ast").SubtableRollNode): string {
        const reps = n.repsSource ? Math.max(1, this.evalRollExpression(n.repsSource)) : 1;
        const tableName = this.evalRawText(n.tableSource);
        const params = n.withParams.map(p => this.evalRawText(p));
        const table = this.tables.get(tableName.toLowerCase());
        // Originally returned "" silently — but a user pasting an
        // inline `rdm:[@T]` call into a note without the matching
        // Use: line saw blank text with no clue why. Throwing surfaces
        // the bug to the inline processor's error renderer and the
        // codeblock processor's error block. The error message names
        // the table so the user knows what to import.
        if (!table) throw new Error(`Unknown table: ${tableName}`);
        const results: string[] = [];
        for (let i = 0; i < reps; i++) {
            results.push(this.runTable(table, params));
        }
        const filtered = applyFilters(
            results.length > 1 ? results : results[0] ?? "",
            n.filters,
            this.filterContext()
        );
        if (n.assignVar) {
            this.setVar(n.assignVar, filtered);
            if (n.assignQuiet) return "";
        }
        return filtered;
    }

    private runSubtablePickNode(n: import("./ast").SubtablePickNode): string {
        const tableName = this.evalRawText(n.tableSource);
        const table = this.tables.get(tableName.toLowerCase());
        // See runSubtableRollNode: throwing rather than silently
        // returning "" so missing-table mistakes surface as errors.
        if (!table) throw new Error(`Unknown table: ${tableName}`);
        const params = n.withParams.map(p => this.evalRawText(p));
        let result: string;
        if (table.type === "dictionary") {
            // Pick by key. literalKey (from [#"quoted" Table]) bypasses
            // expression evaluation so spaces/punctuation come through
            // verbatim. Unquoted keys still go through evalRawText so
            // [#{$var} Table] / [#someBareWord Table] keep working.
            const key =
                n.literalKey !== undefined
                    ? n.literalKey
                    : n.indexSource
                    ? this.evalRawText(n.indexSource)
                    : "";
            const picked = this.pickDictItem(table, key);
            if (picked) {
                result = this.renderNodes(this.parseItem(picked));
            } else if (table.defaultValue) {
                result = this.evalRawText(table.defaultValue);
            } else {
                result = "";
            }
        } else {
            // IPP3 "current-index pick" idiom: when no leading
            // token is given (`[#sometable]`), use the positional
            // index of the *current* item being processed in its
            // parent table. Lets authors cross-index parallel
            // tables — e.g. a NameTable and a DescriptionTable
            // where the 3rd name pairs with the 3rd description.
            //
            // The stack is populated by runTable each time an item
            // is picked; nested table calls naturally inherit the
            // outer item's position. If the stack is empty (top-
            // level call before any item is picked), default to 1
            // — matching the previous fallback behaviour.
            const idx = n.indexSource
                ? this.evalRollExpression(n.indexSource)
                : this.currentItemIndexStack[
                      this.currentItemIndexStack.length - 1
                  ] ?? 1;
            // Wrap entire run for params
            const savedParams: { name: string; value?: Value }[] = [];
            for (let i = 0; i < params.length; i++) {
                const k = String(i + 1);
                savedParams.push({ name: k, value: this.getVar(k) });
                this.setVar(k, params[i]);
            }
            try {
                const picked = this.pickItem(table, idx);
                if (picked) {
                    // Track the picked sub-table item's position too,
                    // so any further `[#nested]` inside its content
                    // uses the right index. runTable would do this
                    // automatically; here we're bypassing runTable
                    // because we're picking directly. Push/pop
                    // mirrors runTable's bracket.
                    this.currentItemIndexStack.push(picked.index + 1);
                    try {
                        result = this.renderNodes(this.parseItem(picked.item));
                    } finally {
                        this.currentItemIndexStack.pop();
                    }
                } else if (table.defaultValue) {
                    result = this.evalRawText(table.defaultValue);
                } else {
                    result = "";
                }
            } finally {
                for (const sp of savedParams) {
                    if (sp.value === undefined) this.deleteVar(sp.name);
                    else this.setVar(sp.name, sp.value);
                }
            }
        }
        const filtered = applyFilters(result, n.filters, this.filterContext());
        if (n.assignVar) {
            this.setVar(n.assignVar, filtered);
            if (n.assignQuiet) return "";
        }
        return filtered;
    }

    private runDeckPickNode(n: import("./ast").DeckPickNode): string {
        const reps = n.repsSource ? Math.max(1, this.evalRollExpression(n.repsSource)) : 1;
        const tableName = this.evalRawText(n.tableSource);
        const params = n.withParams.map(p => this.evalRawText(p));

        // `[!deck:Name]` — a folder deck, drawn through the host.
        // Folder decks are deliberately OUTSIDE the table namespace
        // (the deck: prefix exists to prevent name collisions and to
        // signal persistent, interaction-gated semantics).
        const deckRef = tableName.match(FOLDER_DECK_PREFIX);
        if (deckRef !== null) {
            const deckName = tableName.slice(deckRef[0].length);
            const host = this.opts.folderDeckHost;
            if (!host) {
                throw new Error(
                    `Folder decks aren't available in this context ` +
                        `(tried to draw from deck:${deckName}).`
                );
            }
            if (!host.exists(deckName)) {
                throw new Error(
                    `Unknown deck: ${deckName} — expected a folder ` +
                        `under the Decks folder.`
                );
            }
            const drawn: string[] = [];
            for (let i = 0; i < reps; i++) {
                const card = host.draw(deckName);
                if (card === null) break; // deck exhausted
                drawn.push(card);
            }
            const filteredDeck = applyFilters(
                drawn.length > 1 ? drawn : drawn[0] ?? "",
                n.filters,
                this.filterContext()
            );
            if (n.assignVar) {
                this.setVar(n.assignVar, filteredDeck);
                if (n.assignQuiet) return "";
            }
            return filteredDeck;
        }

        const table = this.tables.get(tableName.toLowerCase());
        // See runSubtableRollNode: surface missing tables instead of
        // returning empty silently.
        if (!table) throw new Error(`Unknown table: ${tableName}`);
        const results: string[] = [];
        for (let i = 0; i < reps; i++) {
            const item = this.pickDeckItem(table);
            if (!item) break;
            // Orientation: a Flip: table sets {$facing} per draw, so
            // the item's own content can branch on it.
            if (table.flipChance !== undefined) {
                const reversed =
                    this.rng.next() * 100 < table.flipChance;
                this.setVar("facing", reversed ? "reversed" : "upright");
            }
            // Render with params
            const savedParams: { name: string; value?: Value }[] = [];
            for (let j = 0; j < params.length; j++) {
                const k = String(j + 1);
                savedParams.push({ name: k, value: this.getVar(k) });
                this.setVar(k, params[j]);
            }
            try {
                results.push(this.renderNodes(this.parseItem(item)));
            } finally {
                for (const sp of savedParams) {
                    if (sp.value === undefined) this.deleteVar(sp.name);
                    else this.setVar(sp.name, sp.value);
                }
            }
        }
        const filtered = applyFilters(
            results.length > 1 ? results : results[0] ?? "",
            n.filters,
            this.filterContext()
        );
        if (n.assignVar) {
            this.setVar(n.assignVar, filtered);
            if (n.assignQuiet) return "";
        }
        return filtered;
    }

    private runInlineTableNode(n: import("./ast").InlineTableNode): string {
        if (n.options.length === 0) return "";
        const idx = this.rng.pickIndex(n.options.length);
        const chosen = n.options[idx];
        const rendered = this.evalRawText(chosen);
        return applyFilters(rendered, n.filters, this.filterContext());
    }

    // ─────────── Context for sub-evaluators ───────────

    private exprContext(): ExprContext {
        // When a variable's stored value looks like a number, return
        // it AS a number so arithmetic on variables works correctly.
        // Otherwise `Set: A=5` (which stores the string "5"), followed
        // by `{$A}+{$B}` would do string concatenation: "5"+"3"="53"
        // instead of the user's clear intent of 5+3=8. The check is
        // strict — empty strings, whitespace-only, and partial-number
        // strings stay as strings.
        const coerceIfNumeric = (v: Value): Value => {
            if (typeof v !== "string") return v;
            const t = v.trim();
            if (t === "") return v;
            // /^-?\d+(\.\d+)?$/ catches integers and decimals only.
            // Hex, exponential, leading+, etc. stay as strings — IPP3
            // doesn't expect those forms in variable storage.
            if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
            return v;
        };
        return {
            getVar: (name) => {
                if (this.hasVar(name)) return coerceIfNumeric(this.getVar(name)!);
                const def = this.defines.get(name);
                if (def !== undefined) {
                    // Lazy evaluation: parse the source as content, render, return.
                    return coerceIfNumeric(this.evalRawText(def));
                }
                return "";
            },
            setVar: (name, value) => { this.setVar(name, value); },
            evalEmbeddedCall: (raw) => {
                // Wrap in [ ] so the content parser sees a complete bracket
                const nodes = parseContent("[" + raw + "]");
                return this.renderNodes(nodes);
            },
            rng: this.rng,
            onDice: this.opts.onDice
        };
    }

    private filterContext(): FilterContext {
        const exprCtx = this.exprContext();
        return {
            ...exprCtx,
            formatting: this.formatting,
            evalTable: (name, params) => {
                const t = this.tables.get(name.toLowerCase());
                if (!t) return "";
                return this.runTable(t, params);
            }
        };
    }
}

/**
 * Find a top-level comparison operator in a rendered-condition string.
 * Returns the operator and its position, or null. Operators are checked in
 * descending length order so that <= isn't matched as <.
 *
 * Top-level means: not inside nested braces or brackets — though by the
 * time we're called the source is mostly raw text, we still want to
 * respect brace/bracket nesting just in case.
 */
function findTopLevelComparisonOp(s: string): { op: string; pos: number } | null {
    const ops = ["<=", ">=", "<>", "=", "<", ">"];
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "\\" && i + 1 < s.length) { i++; continue; }
        if (ch === "[") bracketDepth++;
        else if (ch === "]") bracketDepth--;
        else if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        if (bracketDepth !== 0 || braceDepth !== 0) continue;
        for (const op of ops) {
            if (s.startsWith(op, i)) return { op, pos: i };
        }
    }
    return null;
}

/**
 * Compare two rendered strings using IPP3 comparison semantics:
 *   - If both look numeric, compare numerically.
 *   - Otherwise compare as strings (case-sensitive).
 */
function compareTextual(a: string, b: string, op: string): boolean {
    const aN = a.trim() !== "" && !Number.isNaN(Number(a)) ? Number(a) : null;
    const bN = b.trim() !== "" && !Number.isNaN(Number(b)) ? Number(b) : null;
    if (aN !== null && bN !== null) {
        switch (op) {
            case "=": return aN === bN;
            case "<>": return aN !== bN;
            case "<": return aN < bN;
            case ">": return aN > bN;
            case "<=": return aN <= bN;
            case ">=": return aN >= bN;
        }
    }
    switch (op) {
        case "=": return a === b;
        case "<>": return a !== b;
        case "<": return a < b;
        case ">": return a > b;
        case "<=": return a <= b;
        case ">=": return a >= b;
    }
    return false;
}
