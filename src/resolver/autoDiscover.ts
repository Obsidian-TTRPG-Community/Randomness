/**
 * Table-name auto-discovery.
 *
 * A `randomness` codeblock (or an inline `rdm:` call) can reference a
 * table that lives in *another* generator file without an explicit
 * `Use:` line — e.g. `[@TavernName]` when TavernName is defined in
 * `02-tavern.rdm` somewhere under the Generator Root. The synchronous
 * resolver only follows `Use:` directives, so on its own it can't find
 * those tables. This module bridges that gap.
 *
 * Given an already-resolved bundle (main + extras), it:
 *   1. Statically collects every table NAME referenced in the bundle
 *      (walking the parsed AST so we don't depend on fragile regexes).
 *   2. Subtracts the names that are already defined (in the codeblock
 *      itself or in any explicitly-Use:'d file) — those win, always.
 *   3. Looks the remaining names up in the vault index
 *      (tableName → file path) and loads each defining file, following
 *      that file's own `Use:` graph.
 *   4. Repeats for any tables those discovered files reference in turn
 *      (transitive discovery), up to a safety cap.
 *
 * Crucially this is *purely additive and lowest-priority*: a discovered
 * file only ever contributes tables whose names aren't already defined,
 * so auto-discovery can never shadow or override a table the user wrote
 * or Use:'d explicitly. If discovery finds nothing, the bundle is
 * unchanged and behaviour matches the old `Use:`-only resolver exactly.
 */

import { GeneratorFile, Node, TableDecl } from "../engine/ast";
import { parseContent } from "../engine/contentParser";
import { dirname, resolveBundle } from "./fileResolver";
import { prefetchUseGraph, AsyncFileSource } from "./asyncPrefetcher";

export interface DiscoverOptions {
    /** The bundle's main file (the codeblock / inline expression). */
    main: GeneratorFile;
    /** The bundle's extras (explicitly Use:'d files). */
    extras: GeneratorFile[];
    /** Vault paths already loaded into the bundle (won't be re-read). */
    alreadyLoaded?: Iterable<string>;
    /** Index lookup: table name → defining file path(s). */
    resolveTableName: (name: string) => string[];
    /** Async backend for reading discovered files. */
    source: AsyncFileSource;
    /** Generator root, forwarded to the discovered files' own resolve. */
    generatorRoot?: string;
    /** Cap on discovered files, guarding against pathological graphs. */
    maxDiscovered?: number;
}

const DEFAULT_MAX_DISCOVERED = 64;

/**
 * Discover and load the files that define referenced-but-undefined
 * tables. Returns synthetic GeneratorFiles (tables only) to append to
 * the bundle's extras. Returns [] when nothing needs discovering.
 */
export async function discoverReferencedTables(
    opts: DiscoverOptions
): Promise<GeneratorFile[]> {
    const cap = opts.maxDiscovered ?? DEFAULT_MAX_DISCOVERED;

    // Names already satisfied by the bundle — these are never discovered
    // and never overridden.
    const defined = new Set<string>();
    for (const f of [opts.main, ...opts.extras]) {
        for (const t of f.tables) defined.add(t.name.toLowerCase());
    }

    const loadedPaths = new Set<string>(opts.alreadyLoaded ?? []);
    const discovered: GeneratorFile[] = [];

    // Work queue of table names still to look for. Seeded from the
    // bundle's references; grown as discovered files reveal more.
    const queue: string[] = [];
    const queued = new Set<string>();
    const enqueue = (name: string): void => {
        const key = name.toLowerCase();
        if (defined.has(key) || queued.has(key)) return;
        queued.add(key);
        queue.push(key);
    };

    for (const f of [opts.main, ...opts.extras]) {
        for (const ref of collectFileRefs(f)) enqueue(ref);
    }

    while (queue.length > 0 && discovered.length < cap) {
        const name = queue.shift()!;
        if (defined.has(name)) continue; // satisfied since we queued it

        const paths = opts.resolveTableName(name);
        if (paths.length === 0) continue; // index doesn't know it
        const path = paths[0]; // index already prefers a stable first
        if (loadedPaths.has(path)) continue;

        const content = await opts.source.read(path);
        if (content === null) continue;
        loadedPaths.add(path);

        // Resolve the discovered file with its own Use: graph so any
        // helper files it depends on come along too. A malformed
        // discovered file shouldn't break the host codeblock — on any
        // error we just skip it and move on.
        try {
            const prefetch = await prefetchUseGraph({
                entryPath: path,
                entrySource: content,
                generatorRoot: opts.generatorRoot,
                source: opts.source,
            });
            const sub = resolveBundle(path, content, {
                callerDir: dirname(path),
                generatorRoot: opts.generatorRoot,
                source: prefetch.source,
            });
            for (const p of prefetch.loadedPaths) loadedPaths.add(p);

            // Keep only tables whose names aren't already defined. This
            // is what makes discovery lowest-priority: explicit
            // definitions in the codeblock or Use:'d files are never
            // overridden.
            const newTables: TableDecl[] = [];
            for (const file of [sub.main, ...sub.extras]) {
                for (const t of file.tables) {
                    const key = t.name.toLowerCase();
                    if (defined.has(key)) continue;
                    defined.add(key);
                    newTables.push(t);
                }
                // The discovered file may itself reference further
                // tables we haven't seen yet — chase them transitively.
                for (const ref of collectFileRefs(file)) enqueue(ref);
            }
            if (newTables.length > 0) {
                discovered.push(synthFile(newTables));
            }
        } catch {
            continue;
        }
    }

    return discovered;
}

/** Wrap a list of tables in a minimal GeneratorFile for the evaluator. */
function synthFile(tables: GeneratorFile["tables"]): GeneratorFile {
    return {
        uses: [],
        topLevelSets: [],
        prompts: [],
        tables,
        formatting: "html",
    };
}

/**
 * Collect every statically-named table referenced anywhere in a file:
 * item content, in-table and top-level Set/Define values, lookup roll
 * expressions, and Default: values. Dynamic references (e.g.
 * `[@{$tableName}]`) are skipped — they can't be resolved ahead of
 * evaluation, so they still need an explicit `Use:`.
 */
function collectFileRefs(file: GeneratorFile): string[] {
    const out = new Set<string>();
    for (const a of file.topLevelSets) {
        if (a.valueSource) collectRefsFromText(a.valueSource, out);
    }
    for (const t of file.tables) {
        for (const ref of tableRefs(t)) out.add(ref);
    }
    return [...out];
}

/**
 * Per-table reference cache. Auto-discovery runs on every inline span,
 * and each run re-parses the content of every table in scope to harvest
 * `[@…]` references — for a big note that means parsing hundreds of
 * table cells hundreds of times per render. The refs of a given
 * TableDecl are fixed (the parse is pure and the decl is immutable in
 * this pipeline, and note-table decls are themselves memoised by
 * content), so cache them keyed by table identity. A WeakMap lets the
 * entries be collected as soon as the decl is — no manual eviction.
 */
const TABLE_REFS_CACHE = new WeakMap<TableDecl, string[]>();

function tableRefs(t: TableDecl): string[] {
    const cached = TABLE_REFS_CACHE.get(t);
    if (cached !== undefined) return cached;
    const out = new Set<string>();
    if (t.rollExpr) collectRefsFromText(t.rollExpr, out);
    if (t.defaultValue) collectRefsFromText(t.defaultValue, out);
    for (const a of t.inTableSets) {
        if (a.valueSource) collectRefsFromText(a.valueSource, out);
    }
    for (const item of t.items) {
        if (item.rawContent) collectRefsFromText(item.rawContent, out);
    }
    const refs = [...out];
    TABLE_REFS_CACHE.set(t, refs);
    return refs;
}

/** Parse a raw content string and harvest table references from it. */
function collectRefsFromText(text: string, out: Set<string>): void {
    let nodes: Node[];
    try {
        nodes = parseContent(text);
    } catch {
        return; // unparseable fragment — nothing to harvest
    }
    for (const n of nodes) collectRefsFromNode(n, out);
}

/** Walk a single content node, recursing into nested raw sources. */
function collectRefsFromNode(n: Node, out: Set<string>): void {
    switch (n.type) {
        case "subtable_roll":
        case "subtable_pick":
        case "deck_pick": {
            const name = staticTableName(n.tableSource);
            if (name) out.add(name);
            for (const p of n.withParams ?? []) collectRefsFromText(p, out);
            if (n.repsSource) collectRefsFromText(n.repsSource, out);
            if (n.type === "subtable_pick" && n.indexSource) {
                collectRefsFromText(n.indexSource, out);
            }
            break;
        }
        case "inline_table":
            for (const o of n.options) collectRefsFromText(o, out);
            break;
        case "conditional":
            collectRefsFromText(n.conditionSource, out);
            collectRefsFromText(n.thenSource, out);
            if (n.elseSource) collectRefsFromText(n.elseSource, out);
            break;
        default:
            // text / escape / expression / dice / variable /
            // literal_bracket carry no table calls.
            break;
    }
}

/**
 * Return the table name if `tableSource` is a static reference, else
 * null. Anything containing interpolation/bracket characters
 * (`{ } $ [ ]`) is dynamic and can't be resolved here.
 */
function staticTableName(tableSource: string): string | null {
    const t = tableSource.trim();
    if (t === "" || /[{}$[\]]/.test(t)) return null;
    return t.toLowerCase();
}
