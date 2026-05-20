/**
 * Tests for the browser pane's tree-building logic.
 *
 * These exercise the pure functions in `browserTree.ts`: building a
 * folder hierarchy from a flat file list, filtering the tree by a
 * search needle, and collecting all paths for auto-expansion.
 *
 * No DOM, no Obsidian — just data in, data out.
 */

import {
    buildFolderTree,
    filterTree,
    collectAllPaths,
    GenFileInfo,
} from "../../src/views/browserTree";

function mkFile(path: string, tables: string[] = ["T"]): GenFileInfo {
    const slash = path.lastIndexOf("/");
    const base = slash === -1 ? path : path.slice(slash + 1);
    const dot = base.lastIndexOf(".");
    const title = dot === -1 ? base : base.slice(0, dot);
    return {
        path,
        title,
        tables: tables.map((n, i) => ({ name: n, isMain: i === 0 })),
    };
}

// ────────── buildFolderTree ──────────

describe("buildFolderTree", () => {
    test("empty input produces an empty root", () => {
        const tree = buildFolderTree([]);
        expect(tree.path).toBe("");
        expect(tree.folders).toEqual([]);
        expect(tree.files).toEqual([]);
    });

    test("flat list of files at root puts them all at the root level", () => {
        const tree = buildFolderTree([
            mkFile("a.ipt"),
            mkFile("b.ipt"),
            mkFile("c.ipt"),
        ]);
        expect(tree.folders).toEqual([]);
        expect(tree.files.length).toBe(3);
        // Sorted alphabetically by title.
        expect(tree.files.map((f) => f.title)).toEqual(["a", "b", "c"]);
    });

    test("one-level nesting creates a single subfolder", () => {
        const tree = buildFolderTree([
            mkFile("Generators/names.ipt"),
            mkFile("Generators/loot.ipt"),
        ]);
        expect(tree.folders.length).toBe(1);
        const sub = tree.folders[0];
        expect(sub.path).toBe("Generators");
        expect(sub.name).toBe("Generators");
        // Sorted: "loot" before "names".
        expect(sub.files.map((f) => f.title)).toEqual(["loot", "names"]);
    });

    test("deep nesting creates intermediate folders correctly", () => {
        const tree = buildFolderTree([
            mkFile("Generators/Fantasy/Names/elves.ipt"),
            mkFile("Generators/Fantasy/Names/dwarves.ipt"),
        ]);
        const gen = tree.folders[0];
        expect(gen.name).toBe("Generators");
        const fantasy = gen.folders[0];
        expect(fantasy.name).toBe("Fantasy");
        const names = fantasy.folders[0];
        expect(names.name).toBe("Names");
        expect(names.files.map((f) => f.title).sort()).toEqual([
            "dwarves",
            "elves",
        ]);
    });

    test("intermediate folder is reused across files", () => {
        // Both files share Generators/ as their parent, so only one
        // Generators folder should exist.
        const tree = buildFolderTree([
            mkFile("Generators/a.ipt"),
            mkFile("Generators/Sub/b.ipt"),
        ]);
        expect(tree.folders.length).toBe(1);
        const gen = tree.folders[0];
        // One file at this level, plus one subfolder.
        expect(gen.files.length).toBe(1);
        expect(gen.files[0].title).toBe("a");
        expect(gen.folders.length).toBe(1);
        expect(gen.folders[0].name).toBe("Sub");
    });

    test("rootPath limits the tree to files under it", () => {
        const tree = buildFolderTree(
            [
                mkFile("Generators/a.ipt"),
                mkFile("Generators/Sub/b.ipt"),
                mkFile("Other/c.ipt"),
                mkFile("loose.ipt"),
            ],
            "Generators"
        );
        expect(tree.path).toBe("Generators");
        expect(tree.name).toBe("Generators");
        expect(tree.files.length).toBe(1);
        expect(tree.files[0].title).toBe("a");
        expect(tree.folders.length).toBe(1);
        expect(tree.folders[0].name).toBe("Sub");
        // Files outside the root must not appear anywhere.
        const allTitles: string[] = [];
        const walk = (n: typeof tree): void => {
            for (const f of n.files) allTitles.push(f.title);
            for (const sub of n.folders) walk(sub);
        };
        walk(tree);
        expect(allTitles).toEqual(["a", "b"]);
    });

    test("folder names sort case-insensitively", () => {
        const tree = buildFolderTree([
            mkFile("zoo/a.ipt"),
            mkFile("Apple/b.ipt"),
            mkFile("banana/c.ipt"),
        ]);
        const names = tree.folders.map((f) => f.name);
        expect(names).toEqual(["Apple", "banana", "zoo"]);
    });

    test("preserves error files", () => {
        const tree = buildFolderTree([
            { ...mkFile("broken.ipt"), error: "parse error" },
        ]);
        expect(tree.files.length).toBe(1);
        expect(tree.files[0].error).toBe("parse error");
    });

    test("rootPath with trailing slash is normalised", () => {
        const tree = buildFolderTree(
            [mkFile("Generators/x.ipt")],
            "Generators/"
        );
        expect(tree.path).toBe("Generators");
        expect(tree.files.length).toBe(1);
    });
});

// ────────── filterTree ──────────

describe("filterTree", () => {
    const sample = buildFolderTree([
        mkFile("Generators/names.ipt", ["FirstName", "LastName"]),
        mkFile("Generators/loot.ipt", ["Hoard"]),
        mkFile("Generators/Sub/spells.ipt", ["MageSpell"]),
        mkFile("Other/elsewhere.ipt", ["Random"]),
    ]);

    test("empty filter returns the original tree", () => {
        expect(filterTree(sample, "")).toBe(sample);
        expect(filterTree(sample, "   ")).toBe(sample);
    });

    test("filters by file title", () => {
        const filtered = filterTree(sample, "loot");
        // Only Generators/loot.ipt survives.
        const titles: string[] = [];
        const walk = (n: typeof filtered): void => {
            for (const f of n.files) titles.push(f.title);
            for (const sub of n.folders) walk(sub);
        };
        walk(filtered);
        expect(titles).toEqual(["loot"]);
    });

    test("filters by table name", () => {
        const filtered = filterTree(sample, "MageSpell");
        const titles: string[] = [];
        const walk = (n: typeof filtered): void => {
            for (const f of n.files) titles.push(f.title);
            for (const sub of n.folders) walk(sub);
        };
        walk(filtered);
        expect(titles).toEqual(["spells"]);
    });

    test("filters by path substring", () => {
        const filtered = filterTree(sample, "Other");
        const titles: string[] = [];
        const walk = (n: typeof filtered): void => {
            for (const f of n.files) titles.push(f.title);
            for (const sub of n.folders) walk(sub);
        };
        walk(filtered);
        expect(titles).toEqual(["elsewhere"]);
    });

    test("matching a folder name includes its whole contents", () => {
        const filtered = filterTree(sample, "Sub");
        // The "Sub" folder matches by name, so all its files come along.
        const sub = filtered.folders[0].folders[0];
        expect(sub.name).toBe("Sub");
        expect(sub.files.length).toBe(1);
        expect(sub.files[0].title).toBe("spells");
    });

    test("filter is case-insensitive", () => {
        const a = filterTree(sample, "MAGESPELL");
        const b = filterTree(sample, "magespell");
        // Should produce equivalent trees.
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    test("no matches yields an empty-shaped root", () => {
        const filtered = filterTree(sample, "nonexistent-xyz");
        expect(filtered.files).toEqual([]);
        expect(filtered.folders).toEqual([]);
    });
});

// ────────── collectAllPaths ──────────

describe("collectAllPaths", () => {
    test("collects every folder and file path in a tree", () => {
        const tree = buildFolderTree([
            mkFile("Generators/a.ipt"),
            mkFile("Generators/Sub/b.ipt"),
        ]);
        const paths = collectAllPaths(tree);
        expect(paths.sort()).toEqual([
            "Generators",
            "Generators/Sub",
            "Generators/Sub/b.ipt",
            "Generators/a.ipt",
        ]);
    });

    test("excludes the root's own path", () => {
        const tree = buildFolderTree([mkFile("Generators/a.ipt")], "Generators");
        // Tree root is "Generators" itself; it should NOT appear in
        // the collected paths — chevrons are drawn for nodes below
        // the root, not the root itself.
        const paths = collectAllPaths(tree);
        expect(paths).not.toContain("Generators");
        expect(paths).toContain("Generators/a.ipt");
    });

    test("empty tree returns empty array", () => {
        expect(collectAllPaths(buildFolderTree([]))).toEqual([]);
    });
});
