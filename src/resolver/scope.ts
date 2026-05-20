/**
 * Scope resolution for inline `rdm:` evaluations.
 *
 * When the user puts `rdm:expr` inline in a note, the expression
 * needs to see:
 *   1. Tables defined in `randomness` codeblocks elsewhere in the
 *      same note.
 *   2. Tables from any file that those codeblocks Use:.
 *   3. Standalone .ipt/.md generators reachable via the generator
 *      root.
 *
 * This module composes mdExtractor + fileResolver to assemble that
 * context as a GeneratorFile (the main entry) plus a list of extras.
 * The expression itself becomes the main file's sole table — a
 * synthetic single-item weighted table named "__inline" — so the
 * engine's standard `run()` produces the result.
 *
 * Why a synthetic main table rather than evalRawText directly: the
 * engine's evalRawText() needs an Evaluator instance, which needs a
 * GeneratorFile. The cleanest interface for the UI layer is "give me
 * a bundle, hand it to the engine". The synthetic table keeps the
 * shape uniform regardless of whether the user is evaluating a
 * codeblock or an inline expression.
 */

import { GeneratorFile, TableDecl } from "../engine/ast";
import { findBlocks } from "./mdExtractor";
import {
    FileSource,
    parseFileSource,
    resolveBundle,
    ResolvedBundle,
    ResolveOptions,
} from "./fileResolver";

export interface InlineScopeOptions {
    /** Absolute path of the note containing the rdm: call. */
    notePath: string;
    /** Full text of the note (so we can extract its codeblocks). */
    noteSource: string;
    /** Backend for fetching Use:d files. */
    source: FileSource;
    /** Optional generator root for resolving bare Use: paths. */
    generatorRoot?: string;
    /** Optional max import depth, forwarded to resolveBundle. */
    maxImportDepth?: number;
}

/**
 * Build a runnable bundle for an inline `rdm:expr` call.
 *
 * The bundle's `main` is a synthetic GeneratorFile whose first (and
 * only) table is `__inline`, containing the user's expression. Extras
 * include every Use:'d file from in-note codeblocks plus all tables
 * defined in the codeblocks themselves.
 */
export function buildInlineBundle(
    expr: string,
    opts: InlineScopeOptions
): ResolvedBundle {
    // Step 1: synthetic main file holding just the expression.
    const synthetic = makeInlineFile(expr);

    // Step 2: walk in-note codeblocks. Each block becomes a virtual
    // file at notePath#blockN — uniquely identifiable so the resolver
    // can dedupe them, but distinct from any real file.
    const blocks = findBlocks(opts.noteSource);

    // Concat all in-note codeblocks into a single virtual file. This
    // means in-note Use: directives all resolve relative to the note's
    // directory, and table definitions across blocks share one
    // namespace — matching how the user perceives "this note's
    // generator state".
    const virtualNoteContent = blocks.map((b) => b.content).join("\n\n");
    const virtualNotePath = opts.notePath;
    let virtualNoteFile: GeneratorFile | null = null;
    if (virtualNoteContent.length > 0) {
        // Parse using the note's path so .md-style codeblock extraction
        // doesn't re-run; we already extracted. Use a fake .ipt path to
        // bypass mdExtractor.
        virtualNoteFile = parseFileSource(
            virtualNotePath + ".__inline.ipt",
            virtualNoteContent
        );
    }

    // Step 3: resolve any Use: directives the in-note file references.
    // We treat the note's directory as the callerDir.
    const extras: GeneratorFile[] = [];
    const loadedPaths: string[] = [];
    if (virtualNoteFile !== null) {
        extras.push(virtualNoteFile);
        loadedPaths.push(virtualNotePath);
        if (virtualNoteFile.uses.length > 0) {
            // Use resolveBundle to walk the Use: graph from the
            // synthetic in-note file's perspective.
            const subBundle = resolveSubBundle(
                virtualNotePath,
                virtualNoteFile,
                opts
            );
            for (const extra of subBundle.extras) extras.push(extra);
            for (const p of subBundle.loadedPaths) {
                // Skip the synthetic root path we passed in
                if (p !== virtualNotePath) loadedPaths.push(p);
            }
        }
    }

    return {
        main: synthetic,
        extras,
        loadedPaths,
    };
}

/**
 * Helper: walk Use: from an already-parsed file, without re-parsing the
 * caller. resolveBundle assumes you pass it the main file's *source* so
 * it can parse and then walk; for our virtual in-note file, we already
 * have the parsed GeneratorFile, so we synthesise a degenerate source
 * by serialising back the bare Use: lines.
 *
 * One subtlety: resolveBundle dispatches parsing on extension, so we
 * must pass a `.ipt`-suffixed synthetic path. If we pass the note's
 * `.md` path through, parseFileSource runs the markdown extractor on
 * our synthetic source — which has no codeblocks — and the Use: list
 * vanishes. The synthetic path's *directory* is what matters for
 * callerDir; we strip the extension and append `.__inline.ipt` so the
 * directory stays correct.
 *
 * This is a small price to pay for keeping resolveBundle's contract
 * simple. The serialised source isn't reparsed for anything other than
 * its Use: list (we discard the result and use our own parsed file).
 */
function resolveSubBundle(
    virtualPath: string,
    virtualFile: GeneratorFile,
    opts: InlineScopeOptions
): ResolvedBundle {
    // Reconstruct a minimal source string that, when parsed, yields the
    // same `uses` list. The order matters — declaration order is
    // preserved by the parser.
    const fakeSource = virtualFile.uses.map((u) => `Use:${u}`).join("\n");
    // Force .ipt dispatch — see comment above.
    const fakePath = virtualPath + ".__inline.ipt";
    const resolveOpts: ResolveOptions = {
        callerDir: dirOf(virtualPath),
        generatorRoot: opts.generatorRoot,
        source: opts.source,
        maxImportDepth: opts.maxImportDepth,
    };
    return resolveBundle(fakePath, fakeSource, resolveOpts);
}

/** Local copy of dirname to avoid a circular import. Mirrors fileResolver.dirname. */
function dirOf(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const i = norm.lastIndexOf("/");
    if (i === -1) return "";
    if (i === 0) return "/";
    return norm.slice(0, i);
}

/**
 * Build the synthetic main file holding the user's expression. The
 * expression is wrapped in a single-item weighted table named
 * `__inline`. The engine treats it as a normal table and returns the
 * evaluated content.
 */
function makeInlineFile(expr: string): GeneratorFile {
    const table: TableDecl = {
        name: "__inline",
        type: "weighted",
        shuffleTargets: [],
        inTableSets: [],
        items: [{ weight: 1, rawContent: expr }],
    };
    return {
        uses: [],
        topLevelSets: [],
        prompts: [],
        tables: [table],
        formatting: "html",
    };
}

// ────────────────────────────────────────────────────────────────────
// Visibility queries — useful for the future autocomplete / link UI.
// ────────────────────────────────────────────────────────────────────

/**
 * Return the set of table names visible from a given note (without
 * actually running anything). Useful for the inline autocomplete that
 * lists possible `[@Table]` targets.
 */
export function visibleTableNames(opts: InlineScopeOptions): string[] {
    const bundle = buildInlineBundle("", opts);
    const names = new Set<string>();
    for (const f of [bundle.main, ...bundle.extras]) {
        for (const t of f.tables) names.add(t.name);
    }
    // Drop the synthetic table — it's an implementation detail.
    names.delete("__inline");
    return [...names].sort();
}
