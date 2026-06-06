/**
 * Editor suggest for inline `rdm:` table autocomplete.
 *
 * Trigger pattern: cursor positioned inside an inline code span
 * that starts with `rdm:[@`, `rdm:[#`, or `rdm:[!` (the three
 * inline call shapes that consume a table name). Examples where
 * the popup appears:
 *
 *     Some prose `rdm:[@|         ← @
 *     A list of `rdm:[#5 |        ← # (lookup-pick with reps)
 *     Deck of `rdm:[!nameDeck|    ← ! (deck pick, partial query)
 *
 * On selection, the chosen table name is inserted between the
 * trigger character and the cursor, then a closing `]` is added
 * IF there isn't already one immediately after the cursor (so
 * re-editing a complete call doesn't double-close).
 *
 * Scope: tables visible from the current note — i.e. tables in
 * any `randomness` codeblock plus tables reachable via `Use:`
 * imports from those codeblocks. The same scope `buildInlineBundle`
 * computes for runtime inline calls. Out-of-scope tables in the
 * vault are NOT suggested; autocomplete that lies about what's
 * available is worse than honest emptiness.
 *
 * Why EditorSuggest and not a custom popup: keyboard navigation,
 * theming, mobile, accessibility, escape-to-dismiss — Obsidian's
 * built-in popover handles all of that. Inheriting saves a lot
 * of code and stays consistent with how the user's other
 * autocompletes feel.
 *
 * Caching: building the in-scope table list reads files from the
 * vault, which is async. We cache the result per-note-path on
 * first trigger, then invalidate when the note source changes
 * (cheap — we just drop the cache; rebuild happens lazily on
 * the next trigger). The result: typing past the trigger is
 * fast after the first popup, and edits to the note correctly
 * refresh the available tables.
 */

import {
    App,
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    TFile,
} from "obsidian";
import { buildInlineBundle } from "../resolver/scope";
import { prefetchUseGraph } from "../resolver/asyncPrefetcher";
import { vaultFileSource } from "./vaultFileSource";
import { discoverGenerators } from "./browserView";
import type RandomnessPlugin from "./main";

/** One row in the suggestion popup. */
export interface TableSuggestion {
    /** Table identifier, used verbatim on insertion. */
    name: string;
    /**
     * Human-readable origin label, shown as a muted subtitle.
     * Examples: "(this note)", "names.ipt", "Common/names.ipt".
     */
    source: string;
    /** True for the file's first/main table (gets a small ★ badge). */
    isMain: boolean;
    /**
     * Whether this table is reachable from the current note's
     * scope (true) or merely exists somewhere in the vault (false).
     * In-scope items render normally and insert just the name;
     * out-of-scope items render with a muted style and surface a
     * Notice on select telling the user how to import the file.
     */
    inScope: boolean;
    /**
     * Vault-relative path of the file that defines this table.
     * Empty string for in-note codeblock tables (which live in
     * the note's own source). Used to build the suggested
     * `Use:` line for out-of-scope picks.
     */
    filePath: string;
}

/**
 * Per-note cache entry. The `tables` array is the resolved list
 * for the note at the moment `noteSourceHash` was last seen.
 */
interface CacheEntry {
    /** Hash of the note source the cache was built against. */
    noteSourceHash: number;
    tables: TableSuggestion[];
}

/**
 * Regex matching the autocomplete trigger inside an inline code
 * span. Anchored to the end of the input — we only ever consider
 * the substring of the line to the left of the cursor.
 *
 *   group 1 — the trigger char (@, #, !)
 *   group 2 — the query string typed so far (table-name prefix
 *             plus any leading `n ` if this was `[#n table]`).
 *
 * Important constraints baked into the pattern:
 *   - Must start after a backtick (`).
 *   - Must contain `rdm:` immediately after the backtick.
 *   - The query cannot contain backtick (would close the code
 *     span) or `]` (would close the bracket).
 *
 * Multi-line code spans are not supported. Obsidian's inline
 * code spans are single-line in practice; if a user breaks one
 * across lines they're already off the happy path.
 */
const TRIGGER_RE = /`rdm:\[([@#!])([^`\]]*)$/;

/**
 * EditorSuggest implementation. The class is exported (rather
 * than a factory) so the plugin can register it and so tests
 * can instantiate it directly.
 */
export class TableAutocomplete extends EditorSuggest<TableSuggestion> {
    private plugin: RandomnessPlugin;
    /**
     * Per-note table cache. Keyed by note path; invalidated by
     * comparing the stored source hash to the current source.
     */
    private cache: Map<string, CacheEntry> = new Map();
    /**
     * Vault-wide table list cache. One entry total, built lazily
     * on first autocomplete call that needs out-of-scope
     * suggestions. Invalidated by clearCache().
     *
     * Why a single cache (not per-note like `cache` above): the
     * discovery scans every `.ipt` in the vault, which is
     * expensive enough that we don't want to redo it per
     * keystroke. The cost of staleness is acceptable — if the
     * user adds a new generator file after the cache is built,
     * the new file's tables won't appear until they call
     * clearCache (e.g. by clicking the browser pane's Reload
     * button, which we wire up below).
     */
    private vaultCache: TableSuggestion[] | null = null;

    constructor(app: App, plugin: RandomnessPlugin) {
        super(app);
        this.plugin = plugin;
        // Reasonable upper bound on the popup size — Obsidian's
        // default is unbounded, but enormous popups feel laggy and
        // become unscannable. 50 is enough to fit most realistic
        // generator collections; users can type more letters to
        // narrow further.
        this.limit = 50;
    }

    /**
     * Public entry for tests and (potentially) other call sites:
     * drop the entire cache. Useful when the user changes the
     * generator-root setting and we want autocomplete to reflect
     * the new state without restarting Obsidian.
     */
    clearCache(): void {
        this.cache.clear();
        this.vaultCache = null;
    }

    onTrigger(
        cursor: EditorPosition,
        editor: Editor,
        _file: TFile | null
    ): EditorSuggestTriggerInfo | null {
        // Only consider the line to the left of the cursor.
        // EditorSuggest fires on every keystroke, so cheap-first
        // checks matter: bail before regex if the line is short.
        const line = editor.getLine(cursor.line);
        const before = line.substring(0, cursor.ch);
        if (!before.includes("rdm:")) return null;
        const match = TRIGGER_RE.exec(before);
        if (!match) return null;
        // Trigger char is at (cursor.ch - match[2].length - 1).
        // The query (what we filter against) is match[2].
        const queryLength = match[2].length;
        const triggerCharCol = cursor.ch - queryLength - 1;
        // `start` is the position right after the trigger char —
        // i.e. where the table name begins. `end` is the cursor.
        // The query is everything between.
        return {
            start: { line: cursor.line, ch: triggerCharCol + 1 },
            end: cursor,
            query: match[2],
        };
    }

    async getSuggestions(
        context: EditorSuggestContext
    ): Promise<TableSuggestion[]> {
        const file = context.file;
        // In-scope: tables reachable from this note's codeblocks.
        const inScope = await this.tablesForFile(file);
        // Out-of-scope: tables that exist somewhere in the vault
        // but aren't currently imported by this note. We exclude
        // anything already in-scope to avoid duplicates.
        const inScopeKeys = new Set(
            inScope.map((t) => t.name.toLowerCase())
        );
        const vault = await this.vaultTables();
        const outOfScope = vault.filter(
            (t) => !inScopeKeys.has(t.name.toLowerCase())
        );

        // Filter both lists by the user's query. Case-insensitive
        // substring match, same rule as before — but applied per
        // list so we can preserve the in-scope-first ordering.
        const needle = context.query.toLowerCase();
        const matches = (list: TableSuggestion[]): TableSuggestion[] =>
            needle === ""
                ? list
                : list.filter((t) =>
                      t.name.toLowerCase().includes(needle)
                  );
        const inScopeMatches = matches(inScope);
        const outOfScopeMatches = matches(outOfScope);

        // Concatenate: in-scope first, then out-of-scope. Truncate
        // to `limit` so the popup doesn't sprawl. The cap is on
        // the COMBINED total, with in-scope getting priority — a
        // common large-vault scenario is 200+ tables, and we
        // don't want a query like "name" to fill the popup with
        // out-of-scope matches and bury the user's actually-
        // usable in-scope ones.
        const combined = [...inScopeMatches, ...outOfScopeMatches];
        return combined.slice(0, this.limit);
    }

    renderSuggestion(item: TableSuggestion, el: HTMLElement): void {
        el.classList.add("randomness-suggest-item");
        // Out-of-scope items get a muted class so users can see
        // at a glance that picking them requires an extra step
        // (the Notice we surface in selectSuggestion explains).
        if (!item.inScope) {
            el.classList.add("randomness-suggest-out-of-scope");
        }
        // Use native DOM (not Obsidian's createDiv) so jsdom tests
        // can exercise this without extra plumbing.
        const nameRow = activeDocument.createElement("div");
        nameRow.className = "randomness-suggest-name";
        nameRow.textContent = item.isMain ? `★ ${item.name}` : item.name;
        el.appendChild(nameRow);
        const subtitleRow = activeDocument.createElement("div");
        subtitleRow.className = "randomness-suggest-source";
        // For out-of-scope items, prefix the source with a hint
        // so the user understands why this item looks different.
        subtitleRow.textContent = item.inScope
            ? item.source
            : `(not imported) ${item.source}`;
        el.appendChild(subtitleRow);
    }

    selectSuggestion(
        item: TableSuggestion,
        _evt: MouseEvent | KeyboardEvent
    ): void {
        const ctx = this.context;
        if (!ctx) return;
        const { editor, start, end } = ctx;

        // Step 1: insert the table name into the inline call.
        // We peek at the char immediately after the cursor; if it
        // isn't already `]`, we append one. Re-editing an existing
        // call (with `]` already present) avoids double-closing.
        const charAfter = editor.getLine(end.line).charAt(end.ch);
        const insertion =
            charAfter === "]" ? item.name : item.name + "]";
        editor.replaceRange(insertion, start, end);
        // Cursor lands right after the inserted `]`.
        let newCursor = {
            line: end.line,
            ch: start.ch + insertion.length,
        };

        // Step 2: for out-of-scope picks, auto-add `Use:` so the
        // table actually rolls. We could surface a Notice and ask
        // the user to add it manually (the v0.4.3 behaviour), but
        // that turns "I want to use this table" into a multi-step
        // chore. Adding the import is the most direct response to
        // their selection — they can always undo (Ctrl-Z) if they
        // didn't want the structural change.
        //
        // Auto-add modifies the editor BELOW the inline call's
        // line OR ABOVE it; ABOVE shifts the inline call's line
        // down, so we update newCursor after the operation.
        if (!item.inScope && item.filePath) {
            const linesAdded = this.ensureUseInScope(
                editor,
                item.filePath
            );
            if (linesAdded > 0) {
                newCursor = {
                    line: newCursor.line + linesAdded,
                    ch: newCursor.ch,
                };
            }
        }

        editor.setCursor(newCursor);
        this.close();

        // Invalidate caches so the next autocomplete trigger sees
        // the newly-imported file in scope (not still as
        // out-of-scope). Without this, picking two out-of-scope
        // tables in succession would re-add the same Use: line
        // twice for the second pick — except the dedupe in
        // ensureUseInScope catches that. Still, freshness matters.
        if (ctx.file) {
            this.cache.delete(ctx.file.path);
        }
    }

    /**
     * Ensure the current note has `Use: <filePath>` in some
     * `\`\`\`randomness\`\`\`` codeblock. Strategy:
     *
     *   - If a codeblock exists and already has the line: no-op.
     *   - If a codeblock exists without the line: insert `Use:`
     *     into that codeblock, right after any existing Use lines.
     *   - If no codeblock exists: create one at the top of the
     *     note (after frontmatter) containing just `Use: <path>`.
     *
     * Returns the number of lines added above the cursor's
     * current position, so the caller can adjust the cursor for
     * the shift. Returns 0 if the edit was a no-op or happened
     * below the cursor.
     *
     * The edit goes through the editor (not vault.modify) so
     * it's part of the same undo group as the inline-call
     * insert — one Ctrl-Z undoes both.
     */
    private ensureUseInScope(
        editor: Editor,
        filePath: string
    ): number {
        // Scan for an existing randomness codeblock.
        const block = findFirstRandomnessCodeblock(editor);
        if (block !== null) {
            // Check if the desired Use: line is already there.
            const usePath = filePath.trim();
            for (let i = block.contentStart; i < block.contentEnd; i++) {
                const line = editor.getLine(i).trim();
                // Match "Use: <path>" tolerantly — whitespace
                // variations and case-insensitive path comparison
                // (vault paths are case-insensitive on most OSes).
                const m = /^use\s*:\s*(.+)$/i.exec(line);
                if (m && m[1].trim().toLowerCase() === usePath.toLowerCase()) {
                    // Already imported. No-op.
                    return 0;
                }
            }
            // Insert after the last existing Use: line, or at the
            // top of the body if there are none.
            let insertAfter = block.contentStart - 1; // line of the opening fence
            for (let i = block.contentStart; i < block.contentEnd; i++) {
                if (/^\s*use\s*:/i.test(editor.getLine(i))) {
                    insertAfter = i;
                }
            }
            const insertLine = insertAfter + 1;
            const newLine = `Use: ${filePath}`;
            editor.replaceRange(
                `${newLine}\n`,
                { line: insertLine, ch: 0 },
                { line: insertLine, ch: 0 }
            );
            // The line was inserted BEFORE the cursor only if the
            // codeblock is above the cursor. Determine by
            // comparing the insertLine to the inline-call line.
            // The cursor at this point is on the inline-call line
            // (we adjust after this method returns).
            const cursor = editor.getCursor();
            return insertLine <= cursor.line ? 1 : 0;
        }

        // No codeblock exists. Create one at the top of the note,
        // after frontmatter if any. A bare codeblock with only
        // Use: lines is unusual but legal; it renders empty,
        // which is fine — it's serving as a scope declaration.
        const frontmatterEnd = findFrontmatterEnd(editor);
        // Insert after the frontmatter line (or at line 0 if no
        // frontmatter). Add a blank line before AND after the
        // codeblock so it doesn't smush against other content.
        const insertLine = frontmatterEnd + 1;
        const codeblock =
            "```randomness\n" +
            `Use: ${filePath}\n` +
            "```\n\n";
        editor.replaceRange(
            codeblock,
            { line: insertLine, ch: 0 },
            { line: insertLine, ch: 0 }
        );
        // 4 lines added: fence, Use line, closing fence, blank.
        const linesAdded = 4;
        const cursor = editor.getCursor();
        return insertLine <= cursor.line ? linesAdded : 0;
    }

    /**
     * Resolve the list of in-scope tables for a given note. Reads
     * the note's source, prefetches the Use: graph, builds the
     * inline bundle, and walks `extras` to enumerate every table.
     * Caches the result keyed by note path; invalidates when the
     * source hash changes.
     */
    private async tablesForFile(file: TFile): Promise<TableSuggestion[]> {
        const { vault } = this.plugin.app;
        let source: string;
        try {
            source = await vault.read(file);
        } catch {
            return [];
        }
        const hash = hashString(source);
        const cached = this.cache.get(file.path);
        if (cached && cached.noteSourceHash === hash) {
            return cached.tables;
        }

        let tables: TableSuggestion[] = [];
        try {
            // buildInlineBundle wants a sync FileSource; we
            // prefetch the Use: graph first to materialise one.
            const asyncSource = vaultFileSource(vault);
            const prefetch = await prefetchUseGraph({
                entryPath: file.path,
                entrySource: source,
                generatorRoot:
                    this.plugin.settings.generatorRoot || undefined,
                source: asyncSource,
            });
            const bundle = buildInlineBundle("__inline_autocomplete__", {
                notePath: file.path,
                noteSource: source,
                source: prefetch.source,
                generatorRoot:
                    this.plugin.settings.generatorRoot || undefined,
            });
            tables = collectTablesFromBundle(
                bundle.extras,
                bundle.loadedPaths
            );
        } catch {
            // Bundle building can throw — broken Use: ref, parse
            // error in a codeblock, etc. Silently degrade to an
            // empty list rather than letting the autocomplete
            // popup crash. The user sees no suggestions; the
            // engine will surface the actual error when they
            // try to roll.
            tables = [];
        }

        this.cache.set(file.path, { noteSourceHash: hash, tables });
        return tables;
    }

    /**
     * Enumerate every table in every `.ipt` file under the
     * configured generator root (or the whole vault if no root
     * is set). Tables are tagged `inScope: false` and carry their
     * source file's vault path, so selectSuggestion knows what
     * `Use:` line to surface in the helper Notice.
     *
     * Cached for the plugin's lifetime — discovery walks every
     * matching file, which is expensive enough to not repeat per
     * keystroke. The cache is dropped via `clearCache()` when
     * the user changes settings or invokes the browser pane's
     * Reload (wired up in main.ts).
     */
    private async vaultTables(): Promise<TableSuggestion[]> {
        if (this.vaultCache !== null) return this.vaultCache;
        let discovered;
        try {
            discovered = await discoverGenerators(this.plugin);
        } catch {
            // Discovery should be robust against per-file errors
            // (it captures them in `ok: false` entries), so a
            // throw here means something more fundamental went
            // wrong. Cache an empty list so we don't retry every
            // keystroke; the user can recover via clearCache.
            this.vaultCache = [];
            return this.vaultCache;
        }
        const out: TableSuggestion[] = [];
        for (const result of discovered) {
            if (!result.ok) continue;
            const { gen } = result;
            for (let i = 0; i < gen.tables.length; i++) {
                const t = gen.tables[i];
                out.push({
                    name: t.name,
                    // Show the file title for the user; the path
                    // would be redundant when titles match
                    // basenames anyway. The Notice on select uses
                    // the path.
                    source: gen.title,
                    isMain: i === 0,
                    inScope: false,
                    filePath: gen.path,
                });
            }
        }
        this.vaultCache = out;
        return out;
    }
}

/**
 * Find the first `\`\`\`randomness\`\`\`` codeblock in an editor's
 * content. Returns the line indices of the opening fence, the
 * first content line, and one-past-the-last content line, OR null
 * if there's no such block.
 *
 * Exported for tests; not part of the autocomplete's public API.
 *
 * Why scan the editor directly (not parse markdown structure):
 *   - The editor is the single source of truth at this moment.
 *   - We only need the FIRST block, so a simple line scan is fine.
 *   - The fence syntax is unambiguous: `\`\`\`randomness` opens,
 *     `\`\`\`` (alone on a line) closes. The block content is
 *     everything between.
 *   - A markdown parser would be overkill and would drag a
 *     dependency through the autocomplete module.
 */
export function findFirstRandomnessCodeblock(
    editor: Editor
): { openLine: number; contentStart: number; contentEnd: number } | null {
    const lines = editor.lineCount();
    for (let i = 0; i < lines; i++) {
        const line = editor.getLine(i).trim();
        // Accept "```randomness" with optional trailing whitespace.
        // Doesn't accept "````randomness" (four backticks) — those
        // are a different fence variant and rare enough to skip.
        if (/^```\s*randomness\s*$/.test(line)) {
            const contentStart = i + 1;
            // Find the closing fence.
            for (let j = contentStart; j < lines; j++) {
                const inner = editor.getLine(j).trim();
                if (inner === "```") {
                    return {
                        openLine: i,
                        contentStart,
                        contentEnd: j,
                    };
                }
            }
            // Unterminated codeblock — treat the rest of the file
            // as content (defensive; this is malformed markdown but
            // we shouldn't crash).
            return {
                openLine: i,
                contentStart,
                contentEnd: lines,
            };
        }
    }
    return null;
}

/**
 * Return the 0-indexed line number of the closing `---` of the
 * note's frontmatter (if present), or -1 if no frontmatter.
 *
 * Frontmatter is recognised only when the very first line is
 * exactly `---` and there's a subsequent `---` line. Anything
 * else means no frontmatter, return -1.
 *
 * Exported for tests; not part of the autocomplete's public API.
 */
export function findFrontmatterEnd(editor: Editor): number {
    if (editor.lineCount() === 0) return -1;
    const firstLine = editor.getLine(0).trim();
    if (firstLine !== "---") return -1;
    for (let i = 1; i < editor.lineCount(); i++) {
        if (editor.getLine(i).trim() === "---") return i;
    }
    // Unterminated frontmatter — treat as no frontmatter so the
    // codeblock goes at the very top. Less ideal than refusing
    // the operation, but autocomplete in a malformed note
    // shouldn't fail loudly.
    return -1;
}

/**
 * Walk a bundle's `extras` and return one suggestion per table
 * in declaration order. Takes parallel arrays of files and their
 * vault paths (from `bundle.extras` and `bundle.loadedPaths`)
 * so each suggestion can carry the originating file path for
 * later use (e.g. the `Use:` line for out-of-scope picks).
 *
 * The "source" label is derived from the file's `title`
 * (the author's Title: directive), falling back to a generic
 * "(this note)" for the synthetic in-note file (whose title is
 * whatever parseFileSource set it to — typically empty).
 *
 * Deduplication: if two files declare the same table name, the
 * second is dropped from the suggestion list. That mirrors the
 * Evaluator's behaviour (first-declared wins) so autocomplete
 * suggestions accurately predict what the engine will actually
 * roll.
 */
export function collectTablesFromBundle(
    extras: { title?: string; tables: { name: string; isMain?: boolean }[] }[],
    loadedPaths: string[] = []
): TableSuggestion[] {
    const seen = new Set<string>();
    const out: TableSuggestion[] = [];
    for (let fileIdx = 0; fileIdx < extras.length; fileIdx++) {
        const file = extras[fileIdx];
        // The synthetic in-note virtual file is always the first
        // extra (see buildInlineBundle). It has no meaningful
        // title — give it a friendly source label.
        const source =
            fileIdx === 0
                ? "(this note)"
                : file.title ?? "(generator)";
        const filePath = loadedPaths[fileIdx] ?? "";
        for (let i = 0; i < file.tables.length; i++) {
            const t = file.tables[i];
            const key = t.name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                name: t.name,
                source,
                // First table in each file is the "main" table —
                // worth flagging visually so users know which one
                // gets called when a file is rolled without a
                // specific table name.
                isMain: i === 0,
                inScope: true,
                // Empty path for the in-note virtual file —
                // there's no real generator file to import.
                filePath: fileIdx === 0 ? "" : filePath,
            });
        }
    }
    return out;
}

/**
 * Cheap, deterministic 32-bit hash of a string. Used only for
 * cache-invalidation comparisons, so collision-resistance vs
 * adversarial input doesn't matter — any change to the note
 * source needs to flip at least one byte's contribution, which
 * FNV-1a guarantees.
 */
function hashString(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Public for tests: expose the trigger regex check separately. */
export function matchTrigger(beforeCursor: string): {
    triggerChar: "@" | "#" | "!";
    query: string;
} | null {
    const m = TRIGGER_RE.exec(beforeCursor);
    if (!m) return null;
    return {
        triggerChar: m[1] as "@" | "#" | "!",
        query: m[2],
    };
}
