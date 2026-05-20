/**
 * Tests for the pinnedTables helper. Pure functions, easy to test
 * in isolation — no DOM, no Obsidian. The integration with the
 * BrowserView (toggling pins, rendering the Favourites section)
 * is covered in browserView.test.ts.
 */

import {
    makePinId,
    parsePinId,
    isPinned,
    togglePin,
    resolvePins,
    FAVOURITES_PATH,
    FAVOURITES_NAME,
} from "../../src/views/pinnedTables";
import type { GenFileInfo } from "../../src/views/browserTree";

describe("pinnedTables: encoding", () => {
    test("makePinId joins file path and table name with ::", () => {
        expect(makePinId("foo/bar.ipt", "TableName")).toBe(
            "foo/bar.ipt::TableName"
        );
    });

    test("parsePinId recovers the parts", () => {
        const parsed = parsePinId("foo/bar.ipt::TableName");
        expect(parsed).toEqual({
            filePath: "foo/bar.ipt",
            tableName: "TableName",
        });
    });

    test("parsePinId returns null for malformed ids (no separator)", () => {
        // Defensive: settings could be hand-edited or carry-over from
        // an older plugin version. Don't crash, just skip the entry.
        expect(parsePinId("garbage-no-separator")).toBeNull();
    });

    test("round-trip: parsePinId(makePinId(...)) recovers inputs", () => {
        const fp = "Generators/Names/Dwarves.ipt";
        const tn = "FirstName";
        const id = makePinId(fp, tn);
        const parsed = parsePinId(id);
        expect(parsed).toEqual({ filePath: fp, tableName: tn });
    });

    test("table names with spaces survive round-trip", () => {
        // Real-world table names include spaces — verify they
        // round-trip through the separator-based encoding.
        const id = makePinId("file.ipt", "RANDOM ALTAR GENERATOR");
        const parsed = parsePinId(id);
        expect(parsed?.tableName).toBe("RANDOM ALTAR GENERATOR");
    });

    test("file paths with subfolders survive round-trip", () => {
        const id = makePinId("a/b/c/d.ipt", "T");
        const parsed = parsePinId(id);
        expect(parsed?.filePath).toBe("a/b/c/d.ipt");
        expect(parsed?.tableName).toBe("T");
    });

    test("sentinel constants are stable", () => {
        // These appear in settings and CSS class names; pin them so
        // a refactor doesn't silently change persistent state.
        expect(FAVOURITES_PATH).toBe("__favourites");
        expect(FAVOURITES_NAME).toBe("Favourites");
    });
});

describe("pinnedTables: isPinned", () => {
    test("returns true for pinned (file, table)", () => {
        const pins = ["a.ipt::T1", "b.ipt::T2"];
        expect(isPinned(pins, "a.ipt", "T1")).toBe(true);
        expect(isPinned(pins, "b.ipt", "T2")).toBe(true);
    });

    test("returns false for unpinned (file, table)", () => {
        const pins = ["a.ipt::T1"];
        expect(isPinned(pins, "a.ipt", "T2")).toBe(false);
        expect(isPinned(pins, "b.ipt", "T1")).toBe(false);
    });

    test("returns false on empty pin list", () => {
        expect(isPinned([], "a.ipt", "T")).toBe(false);
    });
});

describe("pinnedTables: togglePin", () => {
    test("adds at the end when not previously pinned", () => {
        // Insertion order matters — see the module comment. Newer
        // pins go at the end; the user's pinning history stays
        // stable from top to bottom.
        const out = togglePin(["a::T"], "b.ipt", "T2");
        expect(out).toEqual(["a::T", "b.ipt::T2"]);
    });

    test("removes when previously pinned", () => {
        const out = togglePin(["a::T", "b::T"], "a", "T");
        expect(out).toEqual(["b::T"]);
    });

    test("returns a new array, doesn't mutate the input", () => {
        // Caller relies on this — they reassign and persist.
        const input = ["a::T"];
        const out = togglePin(input, "b", "T2");
        expect(input).toEqual(["a::T"]); // unchanged
        expect(out).not.toBe(input);
    });

    test("re-pinning after unpin moves the pin to the end", () => {
        // Pin → unpin → pin again: the entry's slot resets to the
        // newest position. Predictable and matches "most recent
        // intent comes last".
        let pins = ["a::T", "b::T2"];
        pins = togglePin(pins, "a", "T"); // unpin a::T
        pins = togglePin(pins, "a", "T"); // re-pin a::T
        expect(pins).toEqual(["b::T2", "a::T"]);
    });

    test("toggling on an empty list adds the pin", () => {
        expect(togglePin([], "a", "T")).toEqual(["a::T"]);
    });
});

describe("pinnedTables: resolvePins", () => {
    // Build a couple of fake GenFileInfo records to test resolution.
    const fileA: GenFileInfo = {
        path: "a.ipt",
        title: "A",
        tables: [
            { name: "Main", isMain: true },
            { name: "Sub", isMain: false },
        ],
    };
    const fileB: GenFileInfo = {
        path: "sub/b.ipt",
        title: "B",
        tables: [{ name: "Other", isMain: true }],
    };

    test("resolves pins to the file + table name", () => {
        const ids = [makePinId("a.ipt", "Main"), makePinId("sub/b.ipt", "Other")];
        const out = resolvePins(ids, [fileA, fileB]);
        expect(out).toHaveLength(2);
        expect(out[0]).toEqual({ file: fileA, tableName: "Main" });
        expect(out[1]).toEqual({ file: fileB, tableName: "Other" });
    });

    test("preserves the order of the pin id list", () => {
        // Insertion order is the contract — resolvePins must not
        // re-sort.
        const ids = [makePinId("sub/b.ipt", "Other"), makePinId("a.ipt", "Main")];
        const out = resolvePins(ids, [fileA, fileB]);
        expect(out.map((p) => p.tableName)).toEqual(["Other", "Main"]);
    });

    test("silently drops pins whose file is missing (file renamed/moved)", () => {
        // The persisted pin list isn't touched — the user's intent
        // is preserved. Only the rendered result skips the absent
        // file.
        const ids = [
            makePinId("a.ipt", "Main"),
            makePinId("nonexistent.ipt", "Anything"),
        ];
        const out = resolvePins(ids, [fileA]);
        expect(out).toHaveLength(1);
        expect(out[0].file).toBe(fileA);
    });

    test("silently drops pins whose table no longer exists in the file", () => {
        // File still there, but the table was renamed or removed.
        // Same rationale as missing-file: keep the persisted intent,
        // skip in the rendered result.
        const ids = [
            makePinId("a.ipt", "Main"),
            makePinId("a.ipt", "RemovedTable"),
        ];
        const out = resolvePins(ids, [fileA]);
        expect(out).toHaveLength(1);
        expect(out[0].tableName).toBe("Main");
    });

    test("malformed pin ids are silently skipped", () => {
        const ids = ["garbage-no-separator", makePinId("a.ipt", "Main")];
        const out = resolvePins(ids, [fileA]);
        expect(out).toHaveLength(1);
        expect(out[0].tableName).toBe("Main");
    });

    test("empty pin list yields empty result", () => {
        expect(resolvePins([], [fileA, fileB])).toEqual([]);
    });
});
