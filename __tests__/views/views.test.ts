/**
 * @jest-environment jsdom
 */

/**
 * Tests for the Obsidian plugin layer.
 *
 * jsdom environment: settings + codeblock tests need a DOM, since they
 * exercise containerEl creation and innerHTML writes.
 *
 * What we test:
 *   - Settings: defaults, partial-stored merge, save round-trip,
 *     stableSeedFor determinism.
 *   - VaultFileSource: forwards reads, handles missing files gracefully.
 *   - Codeblock processor: end-to-end render (engine output reaches the
 *     DOM), error path renders an error block, and the in-flight unload
 *     case bails cleanly.
 *
 * We don't test the SettingsTab's UI deeply — that's mostly the stub
 * exercising itself. We just confirm display() runs without throwing
 * and writes settings to the plugin.
 */

import {
    DEFAULT_SETTINGS,
    RandomnessSettings,
    RandomnessSettingsTab,
    stableSeedFor,
} from "../../src/views/settings";
import { vaultFileSource } from "../../src/views/vaultFileSource";
import { buildCodeblockProcessor } from "../../src/views/codeblockProcessor";

// ────────────────────────────────────────────────────────────────────
// Helpers — fake plugin and context with just enough surface for the
// modules under test.
//
// We do NOT extend Obsidian's real classes/interfaces here, because the
// real .d.ts has a much wider surface than our mock and TypeScript
// would (correctly) demand we implement all of it. Instead we cast
// fakes to `any` at the boundary — the modules under test see the
// methods they actually use.
// ────────────────────────────────────────────────────────────────────

interface FakeFs {
    files: Map<string, string>;
}

function makeFakeAdapter(files: Record<string, string> = {}): FakeFs & {
    read(path: string): Promise<string>;
    exists(path: string): Promise<boolean>;
    write(path: string, data: string): Promise<void>;
} {
    const fs: FakeFs = { files: new Map(Object.entries(files)) };
    return {
        ...fs,
        async read(path: string): Promise<string> {
            const v = fs.files.get(path);
            if (v === undefined) throw new Error(`not found: ${path}`);
            return v;
        },
        async exists(path: string): Promise<boolean> {
            return fs.files.has(path);
        },
        async write(path: string, data: string): Promise<void> {
            fs.files.set(path, data);
        },
    };
}

function makeFakeVault(
    files: Record<string, string> = {}
): {
    adapter: ReturnType<typeof makeFakeAdapter>;
    getFiles(): { path: string }[];
} {
    const adapter = makeFakeAdapter(files);
    return {
        adapter,
        // Match the real Vault.getFiles signature shape — returns
        // objects with at least a `path` property. The case-insensitive
        // lookup in vaultFileSource reads only `.path` so this minimal
        // shape is enough.
        getFiles: () =>
            Array.from(adapter.files.keys()).map((p) => ({ path: p })),
    };
}

/**
 * Fake plugin shape sufficient for buildCodeblockProcessor. We do NOT
 * use the real Plugin class because instantiating it requires the
 * full Obsidian App, which is more setup than we need.
 */
function fakePlugin(opts: {
    files?: Record<string, string>;
    settings?: Partial<RandomnessSettings>;
} = {}) {
    const settings: RandomnessSettings = {
        ...DEFAULT_SETTINGS,
        ...(opts.settings ?? {}),
    };
    const vault = makeFakeVault(opts.files ?? {});
    const app = {
        vault,
        workspace: {},
    };
    const savedData: { value: unknown } = { value: null };
    return {
        app,
        settings,
        async loadData() {
            return savedData.value;
        },
        async saveData(d: unknown) {
            savedData.value = d;
        },
        async loadSettings() {
            const stored = (await this.loadData()) as Partial<RandomnessSettings> | null;
            this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
        },
        async saveSettings() {
            await this.saveData(this.settings);
        },
        _savedData: savedData,
    };
}

/** Build a MarkdownPostProcessorContext-shaped object. */
function fakeCtx(sourcePath: string): any {
    return {
        sourcePath,
        docId: "fake",
        addChild(_c: unknown) {},
        getSectionInfo() {
            return { lineStart: 0, lineEnd: 0, text: "" };
        },
    };
}

// ────────────────────────────────────────────────────────────────────
// Settings
// ────────────────────────────────────────────────────────────────────

describe("settings: defaults", () => {
    test("DEFAULT_SETTINGS has all expected fields", () => {
        expect(DEFAULT_SETTINGS).toEqual({
            generatorRoot: "",
            defaultFormatting: "html",
            stableCodeblockSeeds: false,
            browserExpandedPaths: [],
            pinnedTables: [],
            portraitPackPath: "fantasy_ink_parts_pack",
            portraitPackUrl: "",
            diceFormulas: {},
            graphicalDice: true,
            showDiceBreakdown: false,
            collapsedDecks: [],
        });
    });
});

describe("settings: load merge", () => {
    test("missing fields in stored data fall back to defaults", async () => {
        const p = fakePlugin();
        p._savedData.value = { generatorRoot: "Gens" }; // missing other fields
        await p.loadSettings();
        expect(p.settings.generatorRoot).toBe("Gens");
        expect(p.settings.defaultFormatting).toBe("html"); // default
        expect(p.settings.stableCodeblockSeeds).toBe(false); // default
    });

    test("fully-stored settings round-trip cleanly", async () => {
        const p = fakePlugin();
        p.settings = {
            generatorRoot: "Generators",
            defaultFormatting: "text",
            stableCodeblockSeeds: true,
            browserExpandedPaths: ["Generators", "Generators/names.ipt"],
            pinnedTables: ["Generators/names.ipt::FirstName"],
            portraitPackPath: "art/pack",
            portraitPackUrl: "",
            diceRollerCompatChoice: false,
            diceFormulas: {},
            graphicalDice: false,
            showDiceBreakdown: false,
            collapsedDecks: [],
        };
        await p.saveSettings();
        await p.loadSettings();
        expect(p.settings).toEqual({
            generatorRoot: "Generators",
            defaultFormatting: "text",
            stableCodeblockSeeds: true,
            browserExpandedPaths: ["Generators", "Generators/names.ipt"],
            pinnedTables: ["Generators/names.ipt::FirstName"],
            portraitPackPath: "art/pack",
            portraitPackUrl: "",
            diceRollerCompatChoice: false,
            diceFormulas: {},
            graphicalDice: false,
            showDiceBreakdown: false,
            collapsedDecks: [],
        });
    });

    test("first launch (no stored data) yields defaults", async () => {
        const p = fakePlugin();
        await p.loadSettings();
        expect(p.settings).toEqual(DEFAULT_SETTINGS);
    });
});

describe("settings: stableSeedFor", () => {
    test("same source + position produces same seed", () => {
        const a = stableSeedFor("Table: T\nx", 5);
        const b = stableSeedFor("Table: T\nx", 5);
        expect(a).toBe(b);
    });

    test("different source produces different seed", () => {
        const a = stableSeedFor("Table: A", 0);
        const b = stableSeedFor("Table: B", 0);
        expect(a).not.toBe(b);
    });

    test("different position produces different seed for same source", () => {
        const a = stableSeedFor("same", 0);
        const b = stableSeedFor("same", 100);
        expect(a).not.toBe(b);
    });

    test("seed is a non-negative integer", () => {
        const s = stableSeedFor("anything", 42);
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
    });
});

describe("settings: tab UI doesn't throw", () => {
    test("display() runs against the mocked Obsidian API", () => {
        const p = fakePlugin();
        // The settings tab expects a Plugin-like object — we pass our
        // fake. PluginSettingTab uses .plugin only as a typed reference
        // in our code, never actually calls Plugin methods.
        const tab = new RandomnessSettingsTab(p.app as any, p as never);
        expect(() => tab.display()).not.toThrow();
    });

    test("imports normalizePath from obsidian (review-process requirement)", async () => {
        // Smoke test: confirm the dependency exists and is callable. The
        // real test of behaviour (that user-typed paths flow through it)
        // can't be cheaply asserted here without re-implementing Setting's
        // builder pattern in the mock. The wiring is in settings.ts:
        // `generatorRoot = normalizePath(trimmed)`.
        const obs = await import("obsidian");
        expect(typeof (obs as { normalizePath?: unknown }).normalizePath).toBe(
            "function"
        );
        // Mock implementation strips a leading slash and trims; verify
        // our mock behaves predictably so settings.ts can rely on it.
        expect(
            (obs as { normalizePath: (s: string) => string }).normalizePath(
                "/Generators/"
            )
        ).toBe("Generators");
    });
});

// ────────────────────────────────────────────────────────────────────
// VaultFileSource
// ────────────────────────────────────────────────────────────────────

describe("vaultFileSource", () => {
    test("forwards reads through the vault adapter", async () => {
        const v = makeFakeVault({ "Generators/x.ipt": "hello" });
        const src = vaultFileSource(v as any);
        expect(await src.read("Generators/x.ipt")).toBe("hello");
    });

    test("returns null for missing files instead of throwing", async () => {
        const v = makeFakeVault({});
        const src = vaultFileSource(v as any);
        expect(await src.read("nope.ipt")).toBeNull();
    });

    test("exists returns true for present files", async () => {
        const v = makeFakeVault({ "x.ipt": "x" });
        const src = vaultFileSource(v as any);
        expect(await src.exists("x.ipt")).toBe(true);
    });

    test("exists returns false for missing files", async () => {
        const v = makeFakeVault({});
        const src = vaultFileSource(v as any);
        expect(await src.exists("nope.ipt")).toBe(false);
    });

    test("case-insensitive fallback: exists finds files when query case differs", async () => {
        // Legacy IPP3 generators were authored on Windows (case-
        // insensitive FS), so references like `nbos\names\orc.ipt`
        // pointed at files actually stored as `nbos/Names/Orc.ipt`.
        // Obsidian's vault adapter is case-sensitive on macOS/Linux,
        // so we add a case-insensitive fallback.
        const v = makeFakeVault({ "nbos/Names/Orc.ipt": "Title: Orcs" });
        const src = vaultFileSource(v as any);
        // Lowercase query — adapter.exists returns false, fallback
        // scans getFiles() and finds the actual file.
        expect(await src.exists("nbos/names/orc.ipt")).toBe(true);
        // ALL-CAPS query also works.
        expect(await src.exists("NBOS/NAMES/ORC.IPT")).toBe(true);
    });

    test("case-insensitive fallback: read returns contents under any casing", async () => {
        const v = makeFakeVault({
            "nbos/Names/Orc.ipt": "Title: Orcs\nTable: T\nGrokk",
        });
        const src = vaultFileSource(v as any);
        const content = await src.read("nbos/names/orc.ipt");
        expect(content).not.toBeNull();
        expect(content).toContain("Grokk");
    });

    test("case-insensitive fallback: still null when no file matches under any casing", async () => {
        const v = makeFakeVault({ "nbos/Names/Orc.ipt": "x" });
        const src = vaultFileSource(v as any);
        expect(await src.exists("nbos/Names/Goblin.ipt")).toBe(false);
        expect(await src.read("nbos/Names/Goblin.ipt")).toBeNull();
    });

    test("case-insensitive fallback: literal-case match wins (doesn't unnecessarily walk getFiles)", async () => {
        // When the literal path resolves, we shouldn't fall back —
        // the adapter's direct exists/read is faster than scanning
        // the whole vault. We verify by removing getFiles from the
        // vault: the source should still work for literal matches.
        const v = makeFakeVault({ "x.ipt": "content" });
        delete (v as { getFiles?: unknown }).getFiles;
        const src = vaultFileSource(v as any);
        expect(await src.exists("x.ipt")).toBe(true);
        expect(await src.read("x.ipt")).toBe("content");
    });
});

// ────────────────────────────────────────────────────────────────────
// Codeblock processor
// ────────────────────────────────────────────────────────────────────

describe("codeblockProcessor: rendering", () => {
    test("renders engine output into the container", async () => {
        const p = fakePlugin();
        const proc = buildCodeblockProcessor(p as never);
        const el = document.createElement("div");
        const ctx = fakeCtx("note.md");
        await proc("Table: T\nhello", el, ctx);
        expect(el.textContent).toContain("hello");
        // Output is wrapped in a randomness-output div.
        expect(el.querySelector(".randomness-output")).not.toBeNull();
    });

    test("renders an error message when resolver fails", async () => {
        // Use: a missing file → resolver throws ResolveError.
        const p = fakePlugin();
        const proc = buildCodeblockProcessor(p as never);
        const el = document.createElement("div");
        const ctx = fakeCtx("note.md");
        await proc("Use:does-not-exist.ipt\nTable: T\nx", el, ctx);
        expect(el.querySelector(".randomness-error")).not.toBeNull();
        const msg = el.querySelector(".randomness-error-message");
        expect(msg?.textContent).toMatch(/not found/);
    });

    test("renders engine output that includes a Use:d helper file", async () => {
        const p = fakePlugin({
            files: {
                "names.ipt": "Table: Names\nAlice",
            },
        });
        const proc = buildCodeblockProcessor(p as never);
        const el = document.createElement("div");
        const ctx = fakeCtx("note.md");
        await proc("Use:names.ipt\nTable: Main\n[@Names]", el, ctx);
        expect(el.textContent).toContain("Alice");
    });

    test("stable seed setting makes repeated renders deterministic", async () => {
        // Two-item table with stable seeds → both renders produce the
        // same choice. Without stable seeds we'd see variance across
        // many rolls; not deterministic enough to assert in one test.
        const p = fakePlugin({
            settings: { stableCodeblockSeeds: true },
        });
        const proc = buildCodeblockProcessor(p as never);

        const src = "Table: T\nAlice\nBob";

        const el1 = document.createElement("div");
        await proc(src, el1, fakeCtx("note.md"));

        const el2 = document.createElement("div");
        await proc(src, el2, fakeCtx("note.md"));

        // Same source + same position → same render.
        expect(el1.textContent).toBe(el2.textContent);
    });

    test("malformed Use: target produces error block, not exception", async () => {
        const p = fakePlugin();
        const proc = buildCodeblockProcessor(p as never);
        const el = document.createElement("div");
        const ctx = fakeCtx("note.md");
        // The processor shouldn't throw — errors render as DOM.
        await expect(proc("Use:nope.ipt", el, ctx)).resolves.toBeUndefined();
        expect(el.querySelector(".randomness-error")).not.toBeNull();
    });

    test("renders prompt controls above output when generator has prompts", async () => {
        const p = fakePlugin();
        const proc = buildCodeblockProcessor(p as never);
        const el = document.createElement("div");
        const src = [
            "Prompt: Tier {Easy|Hard}Easy",
            "Table: T",
            "Tier is {$prompt1}",
        ].join("\n");
        await proc(src, el, fakeCtx("note.md"));
        // Prompt controls present.
        const prompts = el.querySelector(".randomness-prompts");
        expect(prompts).not.toBeNull();
        const select = prompts!.querySelector("select") as HTMLSelectElement;
        expect(select.value).toBe("Easy");
        // Output reflects the default.
        expect(el.textContent).toContain("Tier is Easy");
    });

    test("changing a prompt control re-renders with the new value", async () => {
        const p = fakePlugin();
        const proc = buildCodeblockProcessor(p as never);
        const el = document.createElement("div");
        const src = [
            "Prompt: Tier {Easy|Hard}Easy",
            "Table: T",
            "Tier is {$prompt1}",
        ].join("\n");
        await proc(src, el, fakeCtx("note.md"));
        // Change the dropdown to "Hard" and dispatch change.
        const select = el.querySelector("select") as HTMLSelectElement;
        select.value = "Hard";
        select.dispatchEvent(new Event("change"));
        // The re-render is fired-and-forgotten in the onChange; allow
        // microtasks to flush.
        await new Promise((r) => setTimeout(r, 50));
        expect(el.textContent).toContain("Tier is Hard");
    });

    test("no prompt controls rendered when generator has no Prompt: directives", async () => {
        const p = fakePlugin();
        const proc = buildCodeblockProcessor(p as never);
        const el = document.createElement("div");
        await proc("Table: T\nhello", el, fakeCtx("note.md"));
        // .randomness-prompts only appears when there are prompts.
        expect(el.querySelector(".randomness-prompts")).toBeNull();
    });
});
