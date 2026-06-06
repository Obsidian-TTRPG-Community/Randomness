/**
 * Vault index.
 *
 * Scans the vault's `.ipt` files once and keeps two maps:
 *   - basename  → paths[]   (e.g. "AdventureHooks.ipt" → [".../a.ipt", ...])
 *   - tableName → paths[]   (e.g. "FantasyShop"        → ["shops/shop.ipt"])
 *
 * Purpose: let users reference generators by bare filename or table
 * name without managing full paths. The index powers:
 *   - a bare-filename fallback in `resolveUsePath` (Use: a file by
 *     name, wherever it lives)
 *   - faster table-name lookup for `rollUnscoped` and autocomplete
 *     (cached, rather than re-scanning the vault each call)
 *
 * Scope: when a Generator Root is configured, only files under it are
 * indexed; otherwise the whole vault. (Matches discoverGenerators.)
 *
 * Freshness: the index listens to vault create/delete/rename/modify
 * events and updates incrementally. A manual rebuild() is exposed as
 * an escape hatch for the rare missed event (e.g. a file dropped in
 * by sync while Obsidian was closed).
 *
 * Collisions: when a bare name maps to more than one path, the first
 * by sorted path is returned and a one-time console warning names the
 * ambiguity. `resolveUsePath` additionally prefers a match in or under
 * the caller's folder before falling back to the index's first.
 */

import { parseFileSource } from "../resolver/fileResolver";

/** Minimal vault surface the index needs. Keeps it testable. */
export interface IndexVault {
    getFiles(): { path: string }[];
    /** Synchronous cached read; Obsidian's cachedRead is async, so the
     *  plugin adapter wraps it. For the index we read lazily on scan. */
    read(path: string): Promise<string>;
}

/** A built index: the two lookup maps plus the scan scope. */
interface IndexData {
    /** lowercased basename → sorted absolute paths */
    byBasename: Map<string, string[]>;
    /** lowercased table name → sorted absolute paths */
    byTable: Map<string, string[]>;
}

function emptyData(): IndexData {
    return { byBasename: new Map(), byTable: new Map() };
}

/** True if `path` is under (or equal to the folder of) `root`. */
function underRoot(path: string, root: string): boolean {
    if (root === "") return true;
    return path === root || path.startsWith(root + "/");
}

/** Basename of a path ("a/b/c.ipt" → "c.ipt"). */
function basenameOf(path: string): string {
    const i = path.lastIndexOf("/");
    return i < 0 ? path : path.slice(i + 1);
}

export class VaultIndex {
    private data: IndexData = emptyData();
    private built = false;
    /** Names we've already warned about, so we warn once per session. */
    private warnedCollisions = new Set<string>();

    constructor(
        private vault: IndexVault,
        /** Returns the current generator root ("" = whole vault). */
        private getRoot: () => string
    ) {}

    /**
     * Build (or rebuild) the index from scratch. Reads and parses every
     * in-scope `.ipt` file. Parse failures are skipped (a malformed file
     * shouldn't sink the whole index) but still indexed by basename, so
     * a `Use:` by filename resolves even if the file currently has a
     * syntax error the user is mid-editing.
     */
    async rebuild(): Promise<void> {
        const root = this.getRoot();
        const next = emptyData();
        const files = this.vault
            .getFiles()
            .filter(
                (f) =>
                    f.path.toLowerCase().endsWith(".ipt") &&
                    underRoot(f.path, root)
            );

        for (const f of files) {
            this.addBasename(next, f.path);
            let source: string;
            try {
                source = await this.vault.read(f.path);
            } catch {
                // Unreadable — still indexed by basename above.
                continue;
            }
            try {
                const parsed = parseFileSource(f.path, source);
                for (const t of parsed.tables) {
                    this.addTable(next, t.name, f.path);
                }
            } catch {
                // Parse error — skip table indexing for this file.
                // Basename lookup still works.
            }
        }

        // Sort each path list for deterministic first-match.
        for (const list of next.byBasename.values()) list.sort();
        for (const list of next.byTable.values()) list.sort();

        this.data = next;
        this.built = true;
    }

    private addBasename(data: IndexData, path: string): void {
        const key = basenameOf(path).toLowerCase();
        const list = data.byBasename.get(key);
        if (list) list.push(path);
        else data.byBasename.set(key, [path]);
    }

    private addTable(data: IndexData, name: string, path: string): void {
        const key = name.toLowerCase();
        const list = data.byTable.get(key);
        if (list) {
            if (!list.includes(path)) list.push(path);
        } else {
            data.byTable.set(key, [path]);
        }
    }

    /** Ensure the index is built before a lookup. */
    private async ensureBuilt(): Promise<void> {
        if (!this.built) await this.rebuild();
    }

    /**
     * Resolve a bare filename to a path. Prefers a match in or under
     * `callerDir`; otherwise returns the first by sorted path. Warns
     * once per ambiguous basename. Synchronous: assumes the index is
     * already built (resolveUsePath runs inside a sync resolve, so the
     * caller builds the index beforehand via prewarm()).
     */
    resolveBasename(basename: string, callerDir: string): string | null {
        const key = basename.toLowerCase();
        const list = this.data.byBasename.get(key);
        if (!list || list.length === 0) return null;
        if (list.length === 1) return list[0];

        // Collision. Prefer a path in or under the caller's folder.
        if (callerDir !== "") {
            const near = list.filter((p) => underRoot(p, callerDir));
            if (near.length >= 1) {
                this.warnCollision(basename, list, near[0]);
                return near[0];
            }
        }
        // No nearby match: first by sorted path, with a warning.
        this.warnCollision(basename, list, list[0]);
        return list[0];
    }

    /**
     * Resolve a table name to the path(s) that define it, first by
     * sorted path. Returns all matches so callers can disambiguate;
     * the first element is the chosen default.
     */
    resolveTable(tableName: string): string[] {
        return this.data.byTable.get(tableName.toLowerCase()) ?? [];
    }

    /** Build the index if needed; call before a sync resolve. */
    async prewarm(): Promise<void> {
        await this.ensureBuilt();
    }

    /** Mark the index stale so the next lookup rebuilds. Cheap; the
     *  actual rescan is deferred to the next prewarm/lookup. */
    invalidate(): void {
        this.built = false;
    }

    private warnCollision(
        name: string,
        all: string[],
        chosen: string
    ): void {
        const key = name.toLowerCase();
        if (this.warnedCollisions.has(key)) return;
        this.warnedCollisions.add(key);
        console.warn(
            `randomness: "${name}" is ambiguous — ${all.length} files ` +
                `match (${all.join(", ")}). Using "${chosen}". ` +
                `Reference it by full path to choose a different one.`
        );
    }
}
