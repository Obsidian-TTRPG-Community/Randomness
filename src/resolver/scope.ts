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
    BLOCKS_PREFIX,
    TAG_FILE_CAP,
    extractMarkdownContentTables,
    noteBaseName,
    parseDirectTagCall,
    parseDirectWikilinkCall,
    TagRollFilter,
} from "./mdContent";
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
    /**
     * Optional bare-filename fallback, forwarded to the resolver so
     * `Use: [[Note]]` wikilinks resolve vault-wide (the plugin passes
     * an Obsidian metadataCache-backed lookup).
     */
    basenameResolver?: (
        basename: string,
        callerDir: string
    ) => string | null;
    /**
     * Optional tag-roll lookup: vault paths of notes matching a
     * TagRollFilter — tags and/or frontmatter properties (merge
     * Phase 4). Required for `#tag` roll expressions; the plugin
     * backs it with the metadata cache. When absent, tag rolls throw
     * a descriptive error.
     */
    tagFiles?: (filter: TagRollFilter) => string[];
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
    // Direct wikilink call (Dice Roller merge Phase 2):
    // `rdm:[[Note^block-id]]` (optionally `|Column` or `|xy`) rolls
    // that note's block-id table. Rewritten to a plain [@table] call
    // plus a Use: of the note (prepended below), so locks, previews,
    // and re-rolls behave like any other inline expression.
    const direct = parseDirectWikilinkCall(expr);
    if (direct !== null) expr = direct.tableCall;

    // Direct tag roll (merge Phase 4): `#tag` rolls a random block
    // from a random tagged note; `#tag|link` inserts a link to a
    // random tagged note. The pick happens INSIDE the engine — the
    // synthetic __tagroll table holds one item per tagged note — so
    // seeded rolls stay deterministic and re-rolls re-pick the note.
    let tagTable: TableDecl | null = null;
    let tagUses: string[] = [];
    const tag = direct === null ? parseDirectTagCall(expr) : null;
    if (tag !== null) {
        if (!opts.tagFiles) {
            throw new Error(
                `Tag rolls (${tag.label}) need the vault's tag index, ` +
                    `which isn't available in this context.`
            );
        }
        const files = opts.tagFiles(tag.filter).slice(0, TAG_FILE_CAP);
        if (files.length === 0) {
            throw new Error(`No notes found matching ${tag.label}.`);
        }
        if (tag.mode === "link" || tag.mode === "linkpath") {
            // `link` (default) shows the note's name; `linkpath` keeps
            // the full vault path visible. Both point at the same note.
            tagTable = makeTagTable(
                files.map((p) => {
                    const path = p.replace(/\.md$/i, "");
                    return tag.mode === "linkpath"
                        ? `[[${path}]]`
                        : `[[${path}|${noteBaseName(p)}]]`;
                })
            );
        } else {
            tagTable = makeTagTable(
                files.map(
                    (p) => `[@${BLOCKS_PREFIX}${noteBaseName(p).toLowerCase()}]`
                )
            );
            tagUses = files;
        }
        expr = "[@__tagroll]";
    }

    // Step 1: synthetic main file holding just the expression.
    const synthetic = makeInlineFile(expr);
    if (tagTable !== null) synthetic.tables.push(tagTable);

    // Step 2: walk in-note codeblocks. Each block becomes a virtual
    // file at notePath#blockN — uniquely identifiable so the resolver
    // can dedupe them, but distinct from any real file.
    const blocks = findBlocks(opts.noteSource);

    // Concat all in-note codeblocks into a single virtual file. This
    // means in-note Use: directives all resolve relative to the note's
    // directory, and table definitions across blocks share one
    // namespace — matching how the user perceives "this note's
    // generator state".
    let virtualNoteContent = blocks.map((b) => b.content).join("\n\n");
    if (direct !== null) {
        // Bring the linked note into scope ahead of the in-note blocks.
        virtualNoteContent =
            `Use:${direct.fileRef}` +
            (virtualNoteContent.length > 0
                ? "\n\n" + virtualNoteContent
                : "");
    }
    if (tagUses.length > 0) {
        // Tag block rolls import every candidate note so the engine's
        // pick has all __blocks: tables in scope.
        virtualNoteContent =
            tagUses.map((p) => `Use:${p}`).join("\n") +
            (virtualNoteContent.length > 0
                ? "\n\n" + virtualNoteContent
                : "");
    }
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

    // Markdown content tables in the containing note (Dice Roller merge
    // Phase 2): block-id'd tables and lists are in scope for inline
    // calls with no Use: line at all — same-note content Just Works,
    // mirroring how same-note codeblock tables behave. Codeblock-defined
    // tables win on name collision.
    const mdTables = extractMarkdownContentTables(
        opts.noteSource,
        noteBaseName(opts.notePath)
    );
    if (mdTables.length > 0) {
        if (virtualNoteFile === null) {
            virtualNoteFile = parseFileSource(
                virtualNotePath + ".__inline.ipt",
                ""
            );
        }
        const taken = new Set(
            virtualNoteFile.tables.map((t) => t.name.toLowerCase())
        );
        for (const t of mdTables) {
            if (taken.has(t.name.toLowerCase())) continue;
            taken.add(t.name.toLowerCase());
            virtualNoteFile.tables.push(t);
        }
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
            //
            // For a PLAIN inline call (rdm:[@Table]) the note's Use:
            // lines are ambient — they come from codeblocks that happen
            // to live in the same note, not from anything the call asked
            // for. A single broken Use: in one of those must not abort
            // this call, so resolve tolerantly. For an EXPLICIT call
            // (rdm:[[Note]] or a #tag roll) the Use: was injected by THIS
            // call and pointing at a missing note is a real error the
            // user should see, so keep failing loud.
            const tolerantMissingUse =
                direct === null && tagUses.length === 0;
            const subBundle = resolveSubBundle(
                virtualNotePath,
                virtualNoteFile,
                opts,
                tolerantMissingUse
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
    opts: InlineScopeOptions,
    tolerantMissingUse: boolean
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
        basenameResolver: opts.basenameResolver,
        onMissingUse: tolerantMissingUse ? "skip" : "throw",
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
/** Synthetic table backing a #tag roll: one item per tagged note. */
function makeTagTable(items: string[]): TableDecl {
    return {
        name: "__tagroll",
        type: "weighted",
        shuffleTargets: [],
        inTableSets: [],
        items: items.map((rawContent) => ({ weight: 1, rawContent })),
    };
}

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
