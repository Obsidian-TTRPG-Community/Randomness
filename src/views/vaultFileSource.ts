/**
 * AsyncFileSource backed by Obsidian's Vault.adapter.
 *
 * Keeps the resolver layer free of Obsidian imports — the resolver
 * only knows about AsyncFileSource (and FileSource for the sync side).
 * This thin wrapper is the only place that touches `Vault`.
 *
 * Vault paths are vault-relative ("Generators/foo.ipt"), not absolute
 * filesystem paths. The resolver treats them as opaque strings — any
 * pair of strings that `joinPath` and `dirname` can manipulate work.
 * One subtlety: Obsidian doesn't use leading slashes, so a vault path
 * `"Generators/foo.ipt"` has dirname `"Generators"`, not `"/"`. Our
 * resolver's path helpers already handle that correctly.
 *
 * Case-insensitivity: legacy IPP3 generators were authored on Windows
 * where the filesystem is case-insensitive, so `Use: nbos\names\orc.ipt`
 * was a valid reference even when the file on disk was
 * `nbos/Names/Orc.ipt`. Obsidian's vault adapter is case-SENSITIVE on
 * macOS and Linux, so we add a case-insensitive fallback: if the
 * literal path doesn't exist, scan the vault's actual file list for a
 * case-folded match and use that. The index is built lazily on first
 * miss to avoid the upfront cost when no fallback is needed.
 */

import { Vault } from "obsidian";
import { AsyncFileSource } from "../resolver/asyncPrefetcher";

export function vaultFileSource(vault: Vault): AsyncFileSource {
    // Lazy index from lowercased path → actual path. Built on first
    // miss; survives for the lifetime of this AsyncFileSource (which
    // is one resolve operation), so multiple Use: references in the
    // same generator only pay the indexing cost once.
    let lowerCaseIndex: Map<string, string> | null = null;
    const buildIndex = (): Map<string, string> => {
        const m = new Map<string, string>();
        // Defensive: some test mocks / older Vault versions don't
        // expose getFiles. In that case the case-insensitive fallback
        // is unavailable; only the literal-path path applies.
        const v = vault as Vault & { getFiles?: () => { path: string }[] };
        if (typeof v.getFiles !== "function") return m;
        for (const f of v.getFiles()) {
            m.set(f.path.toLowerCase(), f.path);
        }
        return m;
    };
    const lookupActual = (query: string): string | null => {
        if (lowerCaseIndex === null) lowerCaseIndex = buildIndex();
        return lowerCaseIndex.get(query.toLowerCase()) ?? null;
    };

    return {
        async read(path: string): Promise<string | null> {
            try {
                // Try the literal path first — fast, no indexing.
                return await vault.adapter.read(path);
            } catch {
                // Fall back to case-insensitive lookup.
                const actual = lookupActual(path);
                if (actual === null) return null;
                try {
                    return await vault.adapter.read(actual);
                } catch {
                    return null;
                }
            }
        },
        async exists(path: string): Promise<boolean> {
            try {
                if (await vault.adapter.exists(path)) return true;
            } catch {
                // fall through to case-insensitive fallback
            }
            return lookupActual(path) !== null;
        },
    };
}

// ────────────────────────────────────────────────────────────────────
// Plugin-layer lookups (merge Phase 4)
// ────────────────────────────────────────────────────────────────────

import type RandomnessPlugin from "./main";

/**
 * Bare-filename resolver that resolves the way Obsidian resolves
 * wikilinks: the vault index first (exact basenames for .rdm/.ipt
 * libraries), then `metadataCache.getFirstLinkpathDest` — shortest
 * path anywhere in the vault, honouring the user's link settings —
 * so `Use: [[Note]]` and `rdm:[[Note^id]]` find a note wherever it
 * lives, exactly like clicking the link would.
 */
export function makeLinkAwareBasenameResolver(
    plugin: RandomnessPlugin
): (basename: string, callerDir: string) => string | null {
    return (basename, callerDir) => {
        const viaIndex = plugin.vaultIndex?.resolveBasename?.(
            basename,
            callerDir
        );
        if (viaIndex) return viaIndex;
        try {
            const cache = plugin.app.metadataCache;
            if (!cache?.getFirstLinkpathDest) return null;
            const linkpath = basename.toLowerCase().endsWith(".md")
                ? basename.slice(0, -3)
                : basename;
            // The second argument anchors relative resolution; a fake
            // sibling file in the caller's folder mirrors how a link
            // written in that folder would resolve.
            const from = callerDir ? callerDir + "/__resolver__.md" : "";
            const dest = cache.getFirstLinkpathDest(linkpath, from);
            return dest?.path ?? null;
        } catch {
            return null;
        }
    };
}

import {
    TagRollFilter,
    matchesTagRollFilter,
    sampleTagFiles,
} from "../resolver/mdContent";
import { RNG } from "../engine/rng";

/**
 * Vault-wide tag-roll lookup backed by the metadata cache: returns
 * the paths of markdown notes matching a TagRollFilter — tags (inline
 * or frontmatter; nested tags `#tag/sub` match their parent) AND/OR
 * frontmatter properties. Sorted for deterministic seeded rolls. No
 * Dataview required.
 */
export function makeTagFilesLookup(
    plugin: RandomnessPlugin
): (filter: TagRollFilter) => string[] {
    return (filter) => {
        const out: string[] = [];
        try {
            const cache = plugin.app.metadataCache;
            for (const f of plugin.app.vault.getMarkdownFiles()) {
                const fc = cache.getFileCache(f);
                if (!fc) continue;
                const tags = new Set<string>();
                for (const t of fc.tags ?? []) {
                    tags.add(t.tag.replace(/^#/, "").toLowerCase());
                }
                const fm = fc.frontmatter?.tags as unknown;
                const fmList = Array.isArray(fm)
                    ? fm
                    : typeof fm === "string"
                      ? fm.split(",")
                      : [];
                for (const t of fmList) {
                    tags.add(String(t).trim().replace(/^#/, "").toLowerCase());
                }
                const fmAll = fc.frontmatter;
                if (matchesTagRollFilter(tags, fmAll, filter, f.path)) {
                    out.push(f.path);
                }
            }
        } catch {
            // Defensive: metadata cache API drift degrades to "no
            // matching notes" (a clear error upstream), not a crash.
        }
        return out.sort();
    };
}

/**
 * The tag-roll candidate lookup for ONE roll.
 *
 * Two things the raw `makeTagFilesLookup` can't do on its own:
 *
 *  - **Sampling.** `makeTagFilesLookup` returns every match, sorted.
 *    A block roll can only afford to read `cap` notes off disk, and
 *    taking the first `cap` of a sorted list would mean a 1500-note
 *    `#creature` tag never rolled anything past the B's. Pass `cap`
 *    and the candidates become a uniform random sample instead.
 *  - **Memoising.** A block roll asks for its candidates twice — once
 *    to prefetch their text, once when the bundle is built — and a
 *    random sample must be drawn only once, or the bundle would
 *    reference notes that were never read.
 *
 * `seed` makes the sample deterministic, so a seeded roll picks the
 * same note every time exactly as it did before the sampling existed.
 * Omit `cap` (link/linkpath/prop rolls) and every match is returned.
 */
export function makeTagRollLookup(
    plugin: RandomnessPlugin,
    opts?: { cap?: number; seed?: number }
): (filter: TagRollFilter) => string[] {
    const all = makeTagFilesLookup(plugin);
    const rng = new RNG(opts?.seed);
    const cache = new Map<string, string[]>();
    return (filter) => {
        const key = JSON.stringify(filter);
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        const matches = all(filter);
        const out =
            opts?.cap === undefined
                ? matches
                : sampleTagFiles(matches, opts.cap, rng);
        cache.set(key, out);
        return out;
    };
}

/**
 * Frontmatter of one note by vault path, for `prop:` tag rolls.
 * Reads the same metadata cache the filter lookup uses, so a note
 * that matched a `cr=*` filter is guaranteed to have a `cr` here.
 * Returns undefined for a path with no cache entry or no frontmatter.
 */
export function makeTagFrontmatterLookup(
    plugin: RandomnessPlugin
): (path: string) => Record<string, unknown> | undefined {
    return (path) => {
        try {
            return plugin.app.metadataCache.getCache(path)?.frontmatter;
        } catch {
            // Defensive, matching makeTagFilesLookup: cache API drift
            // degrades to "no properties", not a crash.
            return undefined;
        }
    };
}
