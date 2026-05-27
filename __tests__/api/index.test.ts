/**
 * @jest-environment jsdom
 */

/**
 * Tests for the public JS API (src/api/index.ts).
 *
 * The API is a thin orchestration layer, so these tests focus on
 * the CONTRACT: return shapes, scope resolution, error handling,
 * the event stream, deterministic seeding, and dedup/ordering of
 * the table-listing methods. The underlying engine/resolver paths
 * have their own deep coverage; here we verify the API wires them
 * together correctly and presents a stable surface.
 *
 * Strategy: rather than mock every internal, we build a small
 * in-memory vault (path → source) and let the real engine +
 * resolver run against it. That gives genuine end-to-end coverage
 * of roll() — a real expression evaluated against real generator
 * files — while keeping the test self-contained.
 */

import { createApi, API_VERSION } from "../../src/api";

// ── In-memory vault harness ──

/**
 * Build a fake plugin backed by an in-memory file map. The real
 * vaultFileSource / prefetchUseGraph / evaluateInlineExpression
 * run against this, so rolls genuinely evaluate.
 */
function makePlugin(
    files: Record<string, string>,
    opts: { activeNotePath?: string; generatorRoot?: string } = {}
) {
    const map = new Map(Object.entries(files));
    const readPath = async (path: string): Promise<string> => {
        const v = map.get(path);
        if (v === undefined) throw new Error(`not found: ${path}`);
        return v;
    };
    return {
        app: {
            vault: {
                read: async (file: { path: string }) => readPath(file.path),
                getFiles: () =>
                    Array.from(map.keys()).map((p) => ({ path: p })),
                getAbstractFileByPath: (p: string) =>
                    map.has(p) ? { path: p } : null,
                adapter: {
                    read: readPath,
                    exists: async (p: string) => map.has(p),
                },
            },
            workspace: {
                getActiveFile: () =>
                    opts.activeNotePath
                        ? { path: opts.activeNotePath }
                        : null,
            },
            metadataCache: {},
        },
        settings: {
            generatorRoot: opts.generatorRoot ?? "",
            defaultFormatting: "html",
            stableCodeblockSeeds: false,
            browserExpandedPaths: [],
            pinnedTables: [],
        },
    };
}

// A simple generator file used across several tests.
const NAMES_IPT = [
    "Title: Names",
    "Table: FirstName",
    "Alice",
    "Bob",
    "Cassia",
    "",
    "Table: LastName",
    "Smith",
    "Jones",
].join("\n");

// A note that imports names.ipt via a codeblock.
const NOTE_WITH_NAMES = [
    "# My note",
    "",
    "```randomness",
    "Use: names.ipt",
    "Table: greeting",
    "Hi",
    "```",
].join("\n");

describe("API: version", () => {
    test("exposes API_VERSION", () => {
        const p = makePlugin({});
        const api = createApi(p as any);
        expect(api.version).toBe(API_VERSION);
    });

    test("API_VERSION is a semver string", () => {
        expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
});

describe("API: roll", () => {
    test("returns a populated RollResult on success", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const r = await api.roll("FirstName", {
            callerNotePath: "note.md",
        });
        expect(["Alice", "Bob", "Cassia"]).toContain(r.result);
        expect(r.table).toBe("FirstName");
        expect(r.expression).toBe("[@FirstName]");
        expect(r.source).toBe("note.md");
        expect(r.error).toBeUndefined();
        expect(r.rollId).toBeTruthy();
        // Timestamp parses as a valid date.
        expect(Number.isNaN(Date.parse(r.timestamp))).toBe(false);
    });

    test("wraps the table name as [@name]", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const r = await api.roll("FirstName", {
            callerNotePath: "note.md",
        });
        expect(r.expression).toBe("[@FirstName]");
    });

    test("seed makes the roll deterministic", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const a = await api.roll("FirstName", {
            callerNotePath: "note.md",
            seed: 12345,
        });
        const b = await api.roll("FirstName", {
            callerNotePath: "note.md",
            seed: 12345,
        });
        // Same seed → same result. This is the behaviour pjjelly17's
        // version left as a no-op; here it actually works.
        expect(a.result).toBe(b.result);
    });

    test("different seeds can produce different results", async () => {
        // Probabilistic but robust: across many seed pairs on a
        // 3-item table, at least one pair should differ. (Same-seed
        // determinism is the hard guarantee; this just confirms the
        // seed actually influences output.)
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const results = new Set<string>();
        for (let seed = 0; seed < 20; seed++) {
            const r = await api.roll("FirstName", {
                callerNotePath: "note.md",
                seed,
            });
            results.add(r.result);
        }
        // With 20 seeds on a 3-item table, we expect >1 distinct
        // outcome essentially always.
        expect(results.size).toBeGreaterThan(1);
    });

    test("falls back to the active note when no callerNotePath given", async () => {
        const p = makePlugin(
            {
                "names.ipt": NAMES_IPT,
                "note.md": NOTE_WITH_NAMES,
            },
            { activeNotePath: "note.md" }
        );
        const api = createApi(p as any);
        const r = await api.roll("FirstName");
        expect(r.source).toBe("note.md");
        expect(["Alice", "Bob", "Cassia"]).toContain(r.result);
    });

    test("rejects when the table is unknown", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        await expect(
            api.roll("NoSuchTable", { callerNotePath: "note.md" })
        ).rejects.toThrow();
    });

    test("rollId is unique across calls", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const a = await api.roll("FirstName", {
            callerNotePath: "note.md",
        });
        const b = await api.roll("FirstName", {
            callerNotePath: "note.md",
        });
        expect(a.rollId).not.toBe(b.rollId);
    });
});

describe("API: rollUnscoped", () => {
    // Mirrors a real-world .ipt: a top-level Table: that calls a
    // [@Master...] table pulled in via a lowercase `use:` line.
    // This is the shape that scoped roll() cannot reach (the
    // inline-scope path only understands markdown codeblocks, not
    // bare .ipt files), so rollUnscoped exists to handle it.
    const ADVENTURE =
        "use:nbos/AdventureHooks.ipt\n" +
        "Table: AdventureHooks\n" +
        "[@MasterAdventureHooks]";
    const MASTER =
        "Table: MasterAdventureHooks\n" +
        "A dragon menaces the village.\n" +
        "Bandits have seized the bridge.";

    test("scoped roll() cannot reach a bare .ipt table (documents the gap)", async () => {
        const p = makePlugin({
            "AdventureHooks.ipt": ADVENTURE,
            "nbos/AdventureHooks.ipt": MASTER,
        });
        const api = createApi(p as any);
        await expect(api.roll("AdventureHooks")).rejects.toThrow(
            /Unknown table/i
        );
    });

    test("finds a table anywhere in the vault and follows use:", async () => {
        const p = makePlugin({
            "AdventureHooks.ipt": ADVENTURE,
            "nbos/AdventureHooks.ipt": MASTER,
        });
        const api = createApi(p as any);
        const r = await api.rollUnscoped("AdventureHooks");
        expect([
            "A dragon menaces the village.",
            "Bandits have seized the bridge.",
        ]).toContain(r.result);
        expect(r.source).toBe("AdventureHooks.ipt");
        expect(r.table).toBe("AdventureHooks");
    });

    test("rejects a genuinely missing table", async () => {
        const p = makePlugin({
            "AdventureHooks.ipt": ADVENTURE,
            "nbos/AdventureHooks.ipt": MASTER,
        });
        const api = createApi(p as any);
        await expect(
            api.rollUnscoped("NoSuchTable")
        ).rejects.toThrow(/Unknown table/i);
    });

    test("seed makes an unscoped roll deterministic", async () => {
        const p = makePlugin({
            "AdventureHooks.ipt": ADVENTURE,
            "nbos/AdventureHooks.ipt": MASTER,
        });
        const api = createApi(p as any);
        const a = await api.rollUnscoped("AdventureHooks", { seed: 42 });
        const b = await api.rollUnscoped("AdventureHooks", { seed: 42 });
        expect(a.result).toBe(b.result);
    });

    test("filePath disambiguates same-named tables across files", async () => {
        // Two files both define "Loot"; filePath pins which one.
        const p = makePlugin({
            "a/loot.ipt": "Table: Loot\nGold coins",
            "b/loot.ipt": "Table: Loot\nSilver ring",
        });
        const api = createApi(p as any);
        const fromB = await api.rollUnscoped("Loot", {
            filePath: "b/loot.ipt",
        });
        expect(fromB.result).toBe("Silver ring");
        expect(fromB.source).toBe("b/loot.ipt");
    });

    test("fires onRoll on unscoped success and failure", async () => {
        const p = makePlugin({
            "AdventureHooks.ipt": ADVENTURE,
            "nbos/AdventureHooks.ipt": MASTER,
        });
        const api = createApi(p as any);
        const events: { error?: string }[] = [];
        api.onRoll((r) => events.push(r));
        await api.rollUnscoped("AdventureHooks");
        await expect(
            api.rollUnscoped("Missing")
        ).rejects.toThrow();
        expect(events).toHaveLength(2);
        expect(events[0].error).toBeUndefined();
        expect(events[1].error).toBeTruthy();
    });
});

describe("API: rollExpression", () => {
    test("evaluates an arbitrary expression", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const r = await api.rollExpression("[@FirstName] [@LastName]", {
            callerNotePath: "note.md",
        });
        // Result should contain a first AND last name.
        expect(r.result).toMatch(/\w+ \w+/);
        expect(r.expression).toBe("[@FirstName] [@LastName]");
        // For rollExpression, table === the raw expression.
        expect(r.table).toBe("[@FirstName] [@LastName]");
    });

    test("rejects + reports error on a bad expression", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        await expect(
            api.rollExpression("[@Nonexistent]", {
                callerNotePath: "note.md",
            })
        ).rejects.toThrow();
    });
});

describe("API: tables", () => {
    test("lists in-scope tables, deduped and sorted", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const names = await api.tables("note.md");
        // greeting (in-note), FirstName, LastName (imported) — all
        // present, sorted.
        expect(names).toContain("greeting");
        expect(names).toContain("FirstName");
        expect(names).toContain("LastName");
        // Sorted check: the array equals its own sorted copy.
        const sorted = [...names].sort((a, b) => a.localeCompare(b));
        expect(names).toEqual(sorted);
    });

    test("includes out-of-scope vault tables", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "monsters.ipt": "Title: Monsters\nTable: Goblin\nweak",
            // Note imports names but NOT monsters.
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const names = await api.tables("note.md");
        // Goblin is out-of-scope but should still be listed.
        expect(names).toContain("Goblin");
    });
});

describe("API: tablesWithSources", () => {
    test("in-scope tables come before out-of-scope", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "monsters.ipt": "Title: Monsters\nTable: Goblin\nweak",
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const list = await api.tablesWithSources("note.md");
        const firstNameIdx = list.findIndex(
            (t) => t.name === "FirstName"
        );
        const goblinIdx = list.findIndex((t) => t.name === "Goblin");
        expect(firstNameIdx).toBeGreaterThanOrEqual(0);
        expect(goblinIdx).toBeGreaterThanOrEqual(0);
        expect(firstNameIdx).toBeLessThan(goblinIdx);
        // Scope flags correct.
        expect(list[firstNameIdx].inScope).toBe(true);
        expect(list[goblinIdx].inScope).toBe(false);
    });

    test("out-of-scope entries carry their file path", async () => {
        const p = makePlugin({
            "Folder/monsters.ipt":
                "Title: Monsters\nTable: Goblin\nweak",
            "note.md": "plain note, no codeblocks",
        });
        const api = createApi(p as any);
        const list = await api.tablesWithSources("note.md");
        const goblin = list.find((t) => t.name === "Goblin");
        expect(goblin).toBeDefined();
        expect(goblin!.filePath).toBe("Folder/monsters.ipt");
        expect(goblin!.inScope).toBe(false);
    });

    test("a table in scope is not duplicated as out-of-scope", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const list = await api.tablesWithSources("note.md");
        const firstNameEntries = list.filter(
            (t) => t.name === "FirstName"
        );
        expect(firstNameEntries).toHaveLength(1);
        expect(firstNameEntries[0].inScope).toBe(true);
    });
});

describe("API: onRoll", () => {
    test("fires the listener on a successful roll", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const seen: string[] = [];
        api.onRoll((r) => seen.push(r.result));
        await api.roll("FirstName", { callerNotePath: "note.md" });
        expect(seen).toHaveLength(1);
        expect(["Alice", "Bob", "Cassia"]).toContain(seen[0]);
    });

    test("fires the listener on a failed roll, with error set", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const events: { error?: string }[] = [];
        api.onRoll((r) => events.push(r));
        await expect(
            api.roll("Nonexistent", { callerNotePath: "note.md" })
        ).rejects.toThrow();
        // Even though the call rejected, a failure event fired.
        expect(events).toHaveLength(1);
        expect(events[0].error).toBeTruthy();
    });

    test("unsubscribe stops delivery", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        let count = 0;
        const unsub = api.onRoll(() => count++);
        await api.roll("FirstName", { callerNotePath: "note.md" });
        unsub();
        await api.roll("FirstName", { callerNotePath: "note.md" });
        expect(count).toBe(1);
    });

    test("multiple listeners all fire", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        let a = 0;
        let b = 0;
        api.onRoll(() => a++);
        api.onRoll(() => b++);
        await api.roll("FirstName", { callerNotePath: "note.md" });
        expect(a).toBe(1);
        expect(b).toBe(1);
    });

    test("a throwing listener doesn't break the roll or other listeners", async () => {
        const p = makePlugin({
            "names.ipt": NAMES_IPT,
            "note.md": NOTE_WITH_NAMES,
        });
        const api = createApi(p as any);
        const errSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        let goodFired = 0;
        api.onRoll(() => {
            throw new Error("bad listener");
        });
        api.onRoll(() => goodFired++);
        // Roll still resolves; the good listener still fires.
        const r = await api.roll("FirstName", {
            callerNotePath: "note.md",
        });
        expect(r.result).toBeTruthy();
        expect(goodFired).toBe(1);
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });
});
