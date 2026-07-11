/**
 * File resolver — turns `Use:` directives into actual GeneratorFile objects.
 *
 * Responsibilities:
 *   - Normalise legacy paths (Windows backslashes → forward slashes).
 *   - Resolve a relative `Use:` path against the calling file's directory,
 *     falling back to a configured generator root.
 *   - Recursively walk the Use: graph, deduplicating files and detecting
 *     cycles.
 *   - Dispatch `.md` files through the markdown extractor so codeblocks
 *     show up as virtual `.ipt` source.
 *
 * Out of scope:
 *   - Reading files. The resolver is given a FileSource — a tiny interface
 *     that maps absolute paths to text. The Node implementation reads
 *     from disk; the Obsidian implementation reads from Vault. Tests use
 *     an in-memory map.
 *
 * Design:
 *   The resolver is a pure function over FileSource + parser. No Obsidian
 *   imports. Same principle as the engine — keep the layer that touches
 *   Obsidian as thin as possible, so the testable surface stays
 *   testable from Node.
 */

import { GeneratorFile } from "../engine/ast";
import { parseGeneratorFile } from "../engine/fileParser";
import { extractRandomnessCodeblocks } from "./mdExtractor";
import {
    BLOCKS_PREFIX,
    LINES_PREFIX,
    extractMarkdownContentTables,
    extractNoteBlocks,
    extractNoteLines,
    noteBaseName,
    wikilinkToPath,
} from "./mdContent";

/** Build one of the hidden whole-note tables. */
function hiddenTable(
    name: string,
    items: string[]
): import("../engine/ast").TableDecl {
    return {
        name,
        type: "weighted",
        shuffleTargets: [],
        inTableSets: [],
        items: items.map((rawContent) => ({ weight: 1, rawContent })),
    };
}

/**
 * Abstract file backend. Implementations:
 *   - In-memory map (tests).
 *   - Node fs (CLI / smoke).
 *   - Obsidian Vault (plugin).
 *
 * read() returns null when the path is missing — the resolver decides
 * whether that's an error (Use: target) or fine (best-effort lookup).
 */
export interface FileSource {
    /** Return file contents for an absolute path, or null if not found. */
    read(absPath: string): string | null;
    /** Return true if the path exists. */
    exists(absPath: string): boolean;
}

export interface ResolveOptions {
    /**
     * The directory of the file initiating the resolve. `Use:` paths are
     * tried relative to this folder first. Absolute paths inside the
     * vault, e.g. `/Generators/...`.
     */
    callerDir: string;
    /**
     * Optional generator-root fallback. If a `Use:` doesn't resolve
     * relative to callerDir, the resolver tries here next. Configured
     * via plugin settings.
     */
    generatorRoot?: string;
    /**
     * Source backend.
     */
    source: FileSource;
    /**
     * Cap on recursive `Use:` depth. The engine has its own table-call
     * guard; this is the file-import guard. Default 32. (Real corpora
     * top out around 3-5; cycles are caught explicitly.)
     */
    maxImportDepth?: number;
    /**
     * Optional bare-filename fallback. When the four positional
     * resolution steps fail and the ref looks like a bare filename
     * (no slash), this is consulted to look the file up by basename
     * via the vault index. Returns an absolute vault path or null.
     *
     * Kept as a callback (rather than wiring the index in directly)
     * so the resolver stays pure and unit-testable: tests pass a
     * trivial map; the plugin passes the real index lookup. The
     * `callerDir` is provided so the resolver can prefer a nearby
     * match when the index reports a collision.
     */
    basenameResolver?: (
        basename: string,
        callerDir: string
    ) => string | null;
}

const DEFAULT_MAX_IMPORT_DEPTH = 32;

export class ResolveError extends Error {
    constructor(message: string, public path?: string) {
        super(message);
        this.name = "ResolveError";
    }
}

export class ImportCycleError extends ResolveError {
    constructor(public chain: string[]) {
        super(
            `Use: cycle detected — ${chain.join(" → ")}. ` +
                `One of these files imports another that eventually imports it back.`
        );
        this.name = "ImportCycleError";
    }
}

/**
 * Result of a full resolve: the main parsed file plus everything its
 * Use: graph pulled in (recursively), in load order.
 */
export interface ResolvedBundle {
    main: GeneratorFile;
    /** Files reachable via Use:, deduplicated by absolute path. Excludes main. */
    extras: GeneratorFile[];
    /** Absolute paths in load order — useful for cache invalidation. */
    loadedPaths: string[];
}

// ────────────────────────────────────────────────────────────────────
// Path helpers — kept exported so callers can compose without rebuilding.
// ────────────────────────────────────────────────────────────────────

/**
 * Normalise an IPP3 path:
 *   - Convert backslashes to forward slashes (legacy Windows corpora).
 *   - Collapse runs of slashes.
 *   - Don't touch `..` / `.` segments here — leave that to resolve().
 *   - Trim whitespace.
 *
 * The IPP3 spec didn't standardise path separators; corpora ship a mix
 * of `common/srd/x.ipt` and `common\\srd\\x.ipt`. Converting at the
 * boundary means everything downstream sees one format.
 */
export function normalisePath(p: string): string {
    return p
        .trim()
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/");
}

/**
 * Treat `path` as relative to `base` and produce an absolute-ish path.
 * "Absolute-ish" because what counts as absolute depends on the backend:
 *   - Node fs: starts with /
 *   - Obsidian: vault-rooted, no leading /
 *
 * We use a portable rule: the resolver concatenates with `/` and lets
 * `.` / `..` segments do their work. Backends decide what's absolute.
 */
export function joinPath(base: string, relative: string): string {
    const b = normalisePath(base).replace(/\/$/, "");
    const r = normalisePath(relative);
    // If `relative` looks rooted (starts with `/`), it's absolute already.
    if (r.startsWith("/")) return collapseSegments(r);
    if (b === "") return collapseSegments(r);
    return collapseSegments(b + "/" + r);
}

/**
 * Collapse `.` and `..` segments. Plain string-level; no filesystem
 * stat. `..` past the start is dropped (silently — caller will see a
 * "not found" if the result is actually missing).
 */
function collapseSegments(p: string): string {
    const leadingSlash = p.startsWith("/");
    const parts = p.split("/").filter((s) => s !== "");
    const out: string[] = [];
    for (const part of parts) {
        if (part === ".") continue;
        if (part === "..") {
            if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
            // If we're already at the root, the `..` is dropped.
            continue;
        }
        out.push(part);
    }
    return (leadingSlash ? "/" : "") + out.join("/");
}

/** Return the directory portion of an absolute-ish path (everything before the last `/`). */
export function dirname(p: string): string {
    const norm = normalisePath(p);
    const i = norm.lastIndexOf("/");
    if (i === -1) return "";
    if (i === 0) return "/";
    return norm.slice(0, i);
}

// ────────────────────────────────────────────────────────────────────
// Resolution
// ────────────────────────────────────────────────────────────────────

/**
 * Resolve a single Use: reference to an absolute path.
 *
 * Search order: callerDir → generatorRoot. Returns null if neither
 * exists. The caller distinguishes "missing required Use: target"
 * (error) from "missing optional lookup" (silent).
 */
export function resolveUsePath(
    useRef: string,
    opts: ResolveOptions
): string | null {
    // `Use: [[Note]]` / `[[Note^block-id]]` — wikilink form (Dice Roller
    // merge Phase 2). The brackets and any #heading/^block suffix are
    // stripped and `.md` appended when no extension is given; the
    // resulting path then resolves through the same steps as any ref.
    const wiki = wikilinkToPath(useRef);
    const ref = normalisePath(wiki ?? useRef);
    if (ref === "") return null;
    // 1. Relative to caller's dir (sibling files, the most direct case).
    if (opts.callerDir !== "") {
        const candidate = joinPath(opts.callerDir, ref);
        if (opts.source.exists(candidate)) return candidate;
    }
    // 2. Relative to generator root's `Common/` subfolder — IPP3's
    //    canonical library-lookup directory. The original tool
    //    searched `<install>/Common/<ref>` first; legacy generator
    //    files were authored assuming Common/ was the implicit root
    //    of the import namespace.
    if (opts.generatorRoot && opts.generatorRoot !== "") {
        const commonCandidate = joinPath(
            opts.generatorRoot,
            "Common/" + ref
        );
        if (opts.source.exists(commonCandidate)) return commonCandidate;
        // 3. Relative to generator root directly — fallback for
        //    vaults whose generator root already IS the Common/
        //    directory (no extra layer), or where the user has a
        //    different organisational scheme.
        const rootCandidate = joinPath(opts.generatorRoot, ref);
        if (opts.source.exists(rootCandidate)) return rootCandidate;
    }
    // 4. As a final positional fallback, try the ref as-is (it might
    //    already be vault-rooted).
    if (opts.source.exists(ref)) return ref;
    // 5. Bare-filename index fallback. Only when the ref has no path
    //    separator (a bare filename like "AdventureHooks.ipt") and a
    //    basenameResolver was supplied. This is purely additive: it
    //    fires only after every positional step above has failed, so
    //    explicit relative/rooted paths always win and existing
    //    generators resolve exactly as before. The resolver still
    //    verifies the returned path exists in the source.
    if (opts.basenameResolver && !ref.includes("/")) {
        const found = opts.basenameResolver(ref, opts.callerDir);
        if (found !== null && opts.source.exists(found)) return found;
    }
    return null;
}

/**
 * Parse a file's source. Dispatches on extension: `.md` files have
 * their `randomness` codeblocks extracted and concatenated before
 * parsing; `.ipt` and anything else is parsed as-is.
 */
export function parseFileSource(absPath: string, source: string): GeneratorFile {
    if (absPath.toLowerCase().endsWith(".md")) {
        const extracted = extractRandomnessCodeblocks(source);
        // If no codeblocks, an empty file produces an empty GeneratorFile.
        const file = parseGeneratorFile(extracted);
        // Markdown content tables (Dice Roller merge Phase 2): block-id'd
        // markdown tables and lists in the note become rollable tables
        // named by their id (see mdContent.ts). Codeblock-defined tables
        // win on name collision, so notes can always override.
        const taken = new Set(file.tables.map((t) => t.name.toLowerCase()));
        for (const t of extractMarkdownContentTables(
            source,
            noteBaseName(absPath)
        )) {
            if (taken.has(t.name.toLowerCase())) continue;
            taken.add(t.name.toLowerCase());
            file.tables.push(t);
        }
        // Whole-note line/block tables (merge Phase 4): power the
        // `[[Note|line]]` / `[[Note|block]]` rolls and tag rolls. The
        // `__`-prefixed names can't collide with author tables.
        const base = noteBaseName(absPath).toLowerCase();
        const noteLines = extractNoteLines(source);
        if (noteLines.length > 0) {
            file.tables.push(hiddenTable(LINES_PREFIX + base, noteLines));
        }
        const noteBlocks = extractNoteBlocks(source);
        if (noteBlocks.length > 0) {
            file.tables.push(hiddenTable(BLOCKS_PREFIX + base, noteBlocks));
        }
        return file;
    }
    return parseGeneratorFile(source);
}

/**
 * Full resolution: starting from a top-level source string + its path,
 * follow every Use: directive, recursively, until the graph is closed.
 *
 * Returns the parsed main file, all extras in load order, and the list
 * of paths consulted (for cache-invalidation purposes when the plugin
 * watches for file edits).
 */
export function resolveBundle(
    mainPath: string,
    mainSource: string,
    opts: ResolveOptions
): ResolvedBundle {
    const main = parseFileSource(mainPath, mainSource);
    const extras: GeneratorFile[] = [];
    const loaded = new Set<string>();
    const stack: string[] = []; // for cycle detection
    const maxDepth = opts.maxImportDepth ?? DEFAULT_MAX_IMPORT_DEPTH;
    const loadedPaths: string[] = [mainPath];
    loaded.add(mainPath);

    const visit = (file: GeneratorFile, fromPath: string) => {
        if (stack.length >= maxDepth) {
            throw new ResolveError(
                `Use: import depth limit (${maxDepth}) exceeded at ${fromPath}`,
                fromPath
            );
        }
        stack.push(fromPath);
        try {
            for (const rawRef of file.uses) {
                const fromDir = dirname(fromPath);
                const resolved = resolveUsePath(rawRef, {
                    ...opts,
                    callerDir: fromDir,
                });
                if (resolved === null) {
                    // Missing Use: target — surfaced as an error so the
                    // UI can flag it. (Could be made warning-only via an
                    // option later, but failing loud is the right default.)
                    // The hint is for the common case where a community
                    // generator references files (e.g. NBOS names corpora)
                    // that aren't in the user's vault — they need to
                    // download those too.
                    throw new ResolveError(
                        `Use: target not found: '${rawRef}'\n` +
                            `Referenced from: ${fromPath}\n\n` +
                            `This generator depends on another file ` +
                            `that isn't in your vault. If you got this ` +
                            `from a community pack, the referenced file ` +
                            `should have come with it — check the pack ` +
                            `for it, or download it separately and drop ` +
                            `it into your vault. Randomness finds files ` +
                            `by name anywhere in the vault, so the path ` +
                            `doesn't have to match exactly.`,
                        rawRef
                    );
                }
                // Self-import is a no-op: a note whose codeblock says
                // `Use: [[This Very Note]]` (easy to write once notes
                // themselves hold rollable tables, and injected by the
                // inline direct-call path when the wikilink points at
                // the containing note) already has its own tables
                // loaded. Skip it rather than reporting a cycle.
                if (resolved === fromPath) continue;
                // Cycle check FIRST — if `resolved` is one of our ancestors
                // (currently being visited), this is a cycle, not a dedupe.
                // Order matters: the main file is in `loaded` before any
                // visiting starts, so a Use: chain that points back at it
                // would silently dedupe if we checked `loaded` first.
                if (stack.includes(resolved)) {
                    throw new ImportCycleError([...stack, resolved]);
                }
                if (loaded.has(resolved)) continue;
                const sub = opts.source.read(resolved);
                if (sub === null) {
                    throw new ResolveError(
                        `Use: target exists() returned true but read() returned null: ${resolved}`,
                        resolved
                    );
                }
                const parsed = parseFileSource(resolved, sub);
                loaded.add(resolved);
                loadedPaths.push(resolved);
                extras.push(parsed);
                visit(parsed, resolved);
            }
        } finally {
            stack.pop();
        }
    };

    visit(main, mainPath);

    return { main, extras, loadedPaths };
}

// ────────────────────────────────────────────────────────────────────
// Convenience: in-memory FileSource for tests / smoke runs.
// ────────────────────────────────────────────────────────────────────

/**
 * Build a FileSource from a plain object map.
 * Useful for tests; not used in production.
 */
export function inMemorySource(files: Record<string, string>): FileSource {
    const map = new Map(Object.entries(files));
    return {
        read: (p) => (map.has(p) ? (map.get(p) as string) : null),
        exists: (p) => map.has(p),
    };
}
