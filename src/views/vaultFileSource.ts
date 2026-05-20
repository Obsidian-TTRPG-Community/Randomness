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
        const getFiles = (vault as Vault & { getFiles?: () => { path: string }[] })
            .getFiles;
        if (typeof getFiles !== "function") return m;
        for (const f of getFiles.call(vault)) {
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
