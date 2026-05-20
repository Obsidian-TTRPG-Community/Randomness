/**
 * Pinned-tables (favourites) helper.
 *
 * A "pinned table" is a (file path, table name) pair the user has
 * favourited via the star button in the browser pane. Pins appear
 * in a "Favourites" section at the top of the tree, above the
 * regular folder hierarchy.
 *
 * Encoding: a single string of the form `${path}::${tableName}`.
 * The `::` separator is conspicuous and effectively impossible to
 * collide with — vault paths on Windows forbid `:`, and on macOS/
 * Linux a double-colon in a path is so unusual it's not worth
 * special-casing. Table names with `::` in them are also a
 * vanishingly rare edge case; if it ever happens, the system fails
 * closed (the encoded id won't match anything in the tree, so the
 * pin appears in favourites but doesn't successfully roll — easy
 * to diagnose).
 *
 * Stored in settings as a plain array of these encoded strings, in
 * insertion order. Order matters: users pin things to find them
 * later, and re-sorting on every pin (newest-first, alphabetical,
 * etc.) creates a moving-target UX. Stable insertion order keeps
 * "the one I pinned yesterday is where I left it".
 */

import type { GenFileInfo } from "./browserTree";

/** Sentinel path for the favourites section in expansion state. */
export const FAVOURITES_PATH = "__favourites";

/** Sentinel name used for display in the tree. */
export const FAVOURITES_NAME = "Favourites";

const SEPARATOR = "::";

/**
 * Encode a (file path, table name) pair into a single string id
 * suitable for storage in the settings array. Decoding is the
 * inverse — see `parsePinId`. Inputs are not validated for `::`
 * inside table names; in practice tables don't contain `::`, and
 * if one ever did the pin would fail to resolve back to a real
 * table, which is loud-fail (the pin shows but its Roll button
 * does nothing useful).
 */
export function makePinId(filePath: string, tableName: string): string {
    return filePath + SEPARATOR + tableName;
}

/**
 * Decode a pin id back into its file path and table name. Returns
 * null if the id is malformed (no separator). Callers should
 * tolerate null — a corrupted settings entry shouldn't crash the
 * tree render.
 */
export function parsePinId(id: string):
    | { filePath: string; tableName: string }
    | null {
    const idx = id.indexOf(SEPARATOR);
    if (idx === -1) return null;
    return {
        filePath: id.slice(0, idx),
        tableName: id.slice(idx + SEPARATOR.length),
    };
}

/**
 * Check whether a given (file path, table name) is currently
 * pinned. O(n) over the pin list — fine for typical use (dozens
 * of pins at most). If pin lists grow into the hundreds, the
 * caller can lift this into a Set once per render.
 */
export function isPinned(
    pinnedIds: string[],
    filePath: string,
    tableName: string
): boolean {
    const id = makePinId(filePath, tableName);
    return pinnedIds.includes(id);
}

/**
 * Toggle the pinned state of (filePath, tableName) in the given
 * id list. Returns a NEW array; the input isn't mutated. Caller
 * is responsible for assigning the result back to settings and
 * persisting via saveSettings.
 *
 * Adds at the end (preserving insertion order); removes by
 * filter. Re-pinning a previously-unpinned-and-removed item
 * gives it a "newer" slot at the end of the list — the user
 * effectively reset their position.
 */
export function togglePin(
    pinnedIds: string[],
    filePath: string,
    tableName: string
): string[] {
    const id = makePinId(filePath, tableName);
    const idx = pinnedIds.indexOf(id);
    if (idx === -1) return [...pinnedIds, id];
    return pinnedIds.filter((p) => p !== id);
}

/**
 * Resolve the persisted pin id list into a list of concrete
 * (file, table) pairs against the currently-known files. Pins
 * that reference a file or table that no longer exists are
 * silently dropped from the result — but NOT from the persisted
 * list, since the missing file might come back (renamed, moved,
 * temporarily not loaded). Treating absent pins as transient
 * rather than purging them preserves the user's intent across
 * vault reorganisations.
 *
 * Order of the returned list matches the persisted pin order,
 * not the file/table sort order.
 */
export function resolvePins(
    pinnedIds: string[],
    files: GenFileInfo[]
): { file: GenFileInfo; tableName: string }[] {
    const fileIndex = new Map<string, GenFileInfo>();
    for (const f of files) fileIndex.set(f.path, f);
    const out: { file: GenFileInfo; tableName: string }[] = [];
    for (const id of pinnedIds) {
        const parsed = parsePinId(id);
        if (!parsed) continue;
        const file = fileIndex.get(parsed.filePath);
        if (!file) continue;
        // Verify the table still exists in the file. A file that
        // was renamed-around or had its main table removed
        // shouldn't surface a Roll button for a non-existent
        // target.
        const found = file.tables.find((t) => t.name === parsed.tableName);
        if (!found) continue;
        out.push({ file, tableName: parsed.tableName });
    }
    return out;
}
