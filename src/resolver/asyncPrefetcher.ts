/**
 * Async prefetcher — walks a generator's Use: graph eagerly and builds
 * an in-memory FileSource that the synchronous resolver can run against.
 *
 * Why this exists: the resolver is synchronous, by design — every test
 * and consumer expects sync semantics, and the core engine is sync too.
 * But Obsidian's Vault.adapter is async. We bridge the two by walking
 * the import graph here, async, fetching each file once, then handing
 * the populated in-memory source to the synchronous resolver.
 *
 * This intentionally duplicates a small amount of work: the prefetcher
 * does a regex-level Use: extraction to know what to fetch; the
 * resolver then does the full parse + recursive walk. The duplication
 * is bounded (a few extra string scans) and worth the simplification of
 * keeping the resolver synchronous.
 *
 * Pure TypeScript — no Obsidian imports. The async backend is injected
 * via AsyncFileSource. The plugin layer provides the Vault-backed
 * implementation; tests use an in-memory async stub.
 */

import {
    dirname,
    inMemorySource,
    joinPath,
    normalisePath,
    FileSource,
} from "./fileResolver";
import { wikilinkToPath } from "./mdContent";

export interface AsyncFileSource {
    /** Return file contents, or null if not found. */
    read(absPath: string): Promise<string | null>;
    /** Return true if the path exists. */
    exists(absPath: string): Promise<boolean>;
}

export interface PrefetchOptions {
    /** Absolute path of the entry file. */
    entryPath: string;
    /** Contents of the entry file (caller usually has this already). */
    entrySource: string;
    /** Optional generator-root fallback for Use: resolution. */
    generatorRoot?: string;
    /** Async backend. */
    source: AsyncFileSource;
    /** Cap on import depth. Default 32 — matches resolver's default. */
    maxImportDepth?: number;
    /**
     * Optional bare-filename fallback (the vault index). Consulted
     * only when positional resolution fails and the ref is a bare
     * filename. Mirrors resolveUsePath's step 5 so prefetch discovers
     * the same files the synchronous resolver will.
     */
    basenameResolver?: (
        basename: string,
        callerDir: string
    ) => string | null;
    /**
     * Additional Use: refs to walk from the entry point, as if the
     * entry source contained them. Needed for direct wikilink rolls
     * (`rdm:[[Note^id]]`, `[[Note|line]]`): their `Use:` line is
     * injected at bundle-build time — AFTER prefetch — so without
     * this the target never enters the sync snapshot and the
     * resolver reports "Use: target not found" (live bug: cross-note
     * lookups from a subfolder note).
     */
    extraUses?: string[];
}

export interface PrefetchResult {
    /**
     * Synchronous FileSource populated with every file reachable from
     * the entry point. Pass this to resolveBundle / buildInlineBundle.
     */
    source: FileSource;
    /**
     * Paths that were attempted but not found. The synchronous resolver
     * will surface these as ResolveErrors when it walks the same graph;
     * we collect them here as well so the UI can warn early.
     */
    missing: string[];
    /** Paths successfully loaded into the in-memory source, in walk order. */
    loadedPaths: string[];
}

const DEFAULT_MAX_DEPTH = 32;

/**
 * Walk Use: directives starting from entryPath, fetch each file, and
 * return a synchronous FileSource ready for the resolver.
 *
 * The walk uses the same path-resolution rules as the synchronous
 * resolver: callerDir → generatorRoot → as-is. Cycles short-circuit
 * via the loaded set (which is fine here — we just want to avoid
 * redundant fetches; the synchronous resolver does the actual cycle
 * detection on its parsed pass).
 */
export async function prefetchUseGraph(
    opts: PrefetchOptions
): Promise<PrefetchResult> {
    const files = new Map<string, string>();
    const missing: string[] = [];
    const loadedPaths: string[] = [opts.entryPath];
    files.set(opts.entryPath, opts.entrySource);

    const maxDepth = opts.maxImportDepth ?? DEFAULT_MAX_DEPTH;

    // The walk source may carry extra Use: lines (direct wikilink
    // targets) that the stored entry content must NOT contain — the
    // snapshot's entry stays byte-identical to the real file.
    const entryWalkSource =
        opts.extraUses && opts.extraUses.length > 0
            ? opts.entrySource +
              "\n" +
              opts.extraUses.map((u) => `Use:${u}`).join("\n")
            : opts.entrySource;

    /** Queue of (path, source) pairs whose Use: lines haven't been walked yet. */
    const queue: Array<{ path: string; source: string; depth: number }> = [
        { path: opts.entryPath, source: entryWalkSource, depth: 0 },
    ];

    while (queue.length > 0) {
        const { path: fromPath, source: fromSource, depth } = queue.shift()!;
        if (depth >= maxDepth) {
            // The sync resolver will report this with its own error — we
            // just stop walking here so we don't recurse forever in a
            // pathologically deep (but valid) chain.
            continue;
        }
        const uses = extractUseLines(fromSource);
        const fromDir = dirname(fromPath);
        for (const rawRef of uses) {
            const resolved = await resolveAsync(
                rawRef,
                fromDir,
                opts.generatorRoot,
                opts.source,
                opts.basenameResolver
            );
            if (resolved === null) {
                missing.push(rawRef);
                continue;
            }
            if (files.has(resolved)) continue;
            const content = await opts.source.read(resolved);
            if (content === null) {
                missing.push(resolved);
                continue;
            }
            files.set(resolved, content);
            loadedPaths.push(resolved);
            queue.push({ path: resolved, source: content, depth: depth + 1 });
        }
    }

    return {
        source: inMemorySource(Object.fromEntries(files)),
        missing,
        loadedPaths,
    };
}

/**
 * Extract `Use:` line targets from a file's raw source. This is a
 * deliberately shallow scan — we don't want to invoke the full file
 * parser, which would force us to decide how to handle .md vs .ipt
 * before we even know whether the file exists.
 *
 * For .md files, the prefetcher runs this on raw markdown — which
 * means Use: lines inside ```randomness codeblocks WILL be picked up,
 * which is exactly what we want. False positives (a Use: in a fenced
 * non-randomness codeblock, say) cause an extra fetch attempt that
 * fails harmlessly; the synchronous resolver, which DOES dispatch on
 * extension, gets the authoritative list.
 *
 * Edge: avoids matching `Use:` that appears inside an item line. The
 * grammar puts `Use:` at column 1 (optionally preceded by whitespace).
 */
function extractUseLines(source: string): string[] {
    const out: string[] = [];
    for (const rawLine of source.split(/\r?\n/)) {
        const line = rawLine.trim();
        // Match "Use:<rest>" — case-insensitive on the keyword.
        const m = line.match(/^use:\s*(.+)$/i);
        if (m) {
            const ref = m[1].trim();
            if (ref.length > 0) out.push(ref);
        }
    }
    return out;
}

/**
 * Async mirror of resolveUsePath. Tries:
 *   1. callerDir + ref  (relative to the calling file)
 *   2. generatorRoot/Common + ref  (IPP3's "Common library" lookup —
 *      the original tool always searched a `Common/` subfolder of its
 *      install dir for Use: references; mirroring that here means
 *      vaults that preserve the IPP3 layout work without extra config)
 *   3. generatorRoot + ref  (fallback for vaults whose generator root
 *      sits directly on top of the library, no Common/ layer)
 *   4. ref as-is  (already absolute / vault-rooted)
 *
 * Returns the first existing path, or null. The order matches the
 * sync version in fileResolver.ts; the two must stay in sync.
 *
 * Why this isn't shared with the sync resolver: the sync version takes
 * a sync FileSource. Splitting the path-search logic into a third
 * generic-over-sync/async function would over-engineer; the
 * duplication is small and mirrored deliberately.
 */
async function resolveAsync(
    rawRef: string,
    callerDir: string,
    generatorRoot: string | undefined,
    source: AsyncFileSource,
    basenameResolver?: (basename: string, callerDir: string) => string | null
): Promise<string | null> {
    // Wikilink refs — mirror resolveUsePath (the two must stay in sync).
    const wiki = wikilinkToPath(rawRef);
    const ref = normalisePath(wiki ?? rawRef);
    if (ref === "") return null;
    if (callerDir !== "") {
        const candidate = joinPath(callerDir, ref);
        if (await source.exists(candidate)) return candidate;
    }
    if (generatorRoot && generatorRoot !== "") {
        // IPP3 Common-library lookup: try <root>/Common/<ref> before
        // <root>/<ref>. Legacy generators were authored against a
        // working dir whose siblings were Common/, Generators/, etc.;
        // their Use: references implicitly assume "starting from
        // Common/". Matching that here means a vault that mirrors
        // the canonical IPP3 layout works without extra setup.
        const commonCandidate = joinPath(generatorRoot, "Common/" + ref);
        if (await source.exists(commonCandidate)) return commonCandidate;
        const rootCandidate = joinPath(generatorRoot, ref);
        if (await source.exists(rootCandidate)) return rootCandidate;
    }
    if (await source.exists(ref)) return ref;
    // Step 5: bare-filename index fallback. Mirrors resolveUsePath's
    // step 5 so prefetch discovers the same files the synchronous
    // resolver will. Only for bare filenames, only after positional
    // resolution fails, and only if the result actually exists.
    if (basenameResolver && !ref.includes("/")) {
        const found = basenameResolver(ref, callerDir);
        if (found !== null && (await source.exists(found))) return found;
    }
    return null;
}

// ────────────────────────────────────────────────────────────────────
// Test helper — in-memory AsyncFileSource for unit tests.
// ────────────────────────────────────────────────────────────────────

/** Build an AsyncFileSource backed by a plain object. Tests only. */
export function inMemoryAsyncSource(
    files: Record<string, string>
): AsyncFileSource {
    const map = new Map(Object.entries(files));
    return {
        read: async (p) => (map.has(p) ? (map.get(p) as string) : null),
        exists: async (p) => map.has(p),
    };
}
