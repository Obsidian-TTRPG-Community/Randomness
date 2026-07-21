/**
 * @jest-environment jsdom
 */

/**
 * Tests for the generator browser view.
 *
 * The view itself is mostly DOM glue + click handlers, but the
 * non-view exports — discoverGenerators, rollTable, htmlToPlainText —
 * are the testable units. Each is exercised here.
 */

import {
    discoverGenerators,
    rollTable,
    buildInlineSyntax,
    buildSelfContainedSnippet,
    noteImportsFile,
} from "../../src/views/browserView";
import { DEFAULT_SETTINGS, RandomnessSettings } from "../../src/views/settings";
import { TFile } from "obsidian";

// ────────── Test plumbing ──────────

/**
 * Build a fake plugin shape that matches what browserView consumes.
 * We mock vault.getFiles to return TFiles for the paths we configure,
 * and vault.read / vault.adapter.read to look up content by path.
 */
function fakePlugin(opts: {
    files: Record<string, string>;
    settings?: Partial<RandomnessSettings>;
}) {
    const map = new Map(Object.entries(opts.files));
    const makeTFile = (path: string): TFile => {
        const f = new TFile();
        f.path = path;
        const slash = path.lastIndexOf("/");
        const base = slash === -1 ? path : path.slice(slash + 1);
        const dot = base.lastIndexOf(".");
        f.basename = dot === -1 ? base : base.slice(0, dot);
        f.extension = dot === -1 ? "" : base.slice(dot + 1);
        f.name = base;
        return f;
    };
    return {
        app: {
            vault: {
                getFiles: () =>
                    Array.from(map.keys()).map((p) => makeTFile(p)),
                async read(file: TFile): Promise<string> {
                    const v = map.get(file.path);
                    if (v === undefined) throw new Error(`not found: ${file.path}`);
                    return v;
                },
                adapter: {
                    async read(path: string): Promise<string> {
                        const v = map.get(path);
                        if (v === undefined) throw new Error(`not found: ${path}`);
                        return v;
                    },
                    async exists(path: string): Promise<boolean> {
                        return map.has(path);
                    },
                },
            },
            workspace: {},
        },
        settings: {
            ...DEFAULT_SETTINGS,
            ...(opts.settings ?? {}),
        } as RandomnessSettings,
    };
}

// ────────── discoverGenerators ──────────

describe("discoverGenerators", () => {
    test("finds .ipt files and parses their tables", async () => {
        const p = fakePlugin({
            files: {
                "Generators/names.ipt": [
                    "Title: Names",
                    "Table: FirstName",
                    "Alice",
                    "Bob",
                    "",
                    "Table: LastName",
                    "Smith",
                    "Jones",
                ].join("\n"),
            },
        });
        const results = await discoverGenerators(p as any);
        expect(results.length).toBe(1);
        expect(results[0].ok).toBe(true);
        if (results[0].ok) {
            expect(results[0].gen.path).toBe("Generators/names.ipt");
            expect(results[0].gen.title).toBe("Names");
            expect(results[0].gen.tables.length).toBe(2);
            // First table is marked as main; subsequent ones are not.
            expect(results[0].gen.tables[0]).toEqual({
                name: "FirstName",
                isMain: true,
            });
            expect(results[0].gen.tables[1]).toEqual({
                name: "LastName",
                isMain: false,
            });
        }
    });

    test("falls back to filename when no Title: directive", async () => {
        const p = fakePlugin({
            files: {
                "Generators/loot.ipt": [
                    "Table: Hoard",
                    "Gold",
                    "Silver",
                ].join("\n"),
            },
        });
        const results = await discoverGenerators(p as any);
        expect(results[0].ok).toBe(true);
        if (results[0].ok) {
            expect(results[0].gen.title).toBe("loot");
        }
    });

    test("skips non-.ipt files", async () => {
        const p = fakePlugin({
            files: {
                "note.md": "# Just a note",
                "Generators/x.ipt": "Table: T\nA",
                "image.png": "binary",
            },
        });
        const results = await discoverGenerators(p as any);
        expect(results.length).toBe(1);
        expect(results[0].ok && results[0].gen.path).toBe("Generators/x.ipt");
    });

    test("filters by generatorRoot when configured", async () => {
        const p = fakePlugin({
            files: {
                "Generators/names.ipt": "Table: T\nA",
                "Other/elsewhere.ipt": "Table: T\nB",
                "loose.ipt": "Table: T\nC",
            },
            settings: { generatorRoot: "Generators" },
        });
        const results = await discoverGenerators(p as any);
        expect(results.length).toBe(1);
        expect(results[0].ok && results[0].gen.path).toBe(
            "Generators/names.ipt"
        );
    });

    test("with no generatorRoot, finds files anywhere in the vault", async () => {
        const p = fakePlugin({
            files: {
                "a.ipt": "Table: T\nA",
                "nested/b.ipt": "Table: T\nB",
                "deep/sub/c.ipt": "Table: T\nC",
            },
        });
        const results = await discoverGenerators(p as any);
        expect(results.length).toBe(3);
        // Sorted by path for stable display order.
        const paths = results.map((r) => (r.ok ? r.gen.path : r.path));
        expect(paths).toEqual(["a.ipt", "deep/sub/c.ipt", "nested/b.ipt"]);
    });

    test("returns failure entries for unparseable files instead of dropping them", async () => {
        const p = fakePlugin({
            files: {
                "broken.ipt": [
                    "Table: T",
                    // missing close, illegal directive
                    "MaxReps: not-a-number",
                ].join("\n"),
            },
        });
        const results = await discoverGenerators(p as any);
        expect(results.length).toBe(1);
        expect(results[0].ok).toBe(false);
        if (!results[0].ok) {
            expect(results[0].path).toBe("broken.ipt");
            expect(results[0].error.length).toBeGreaterThan(0);
        }
    });
});

// ────────── rollTable ──────────

describe("rollTable", () => {
    test("rolls a specific named table, not just the main", async () => {
        const p = fakePlugin({
            files: {
                "g.ipt": [
                    "Table: Main",
                    "main-only",
                    "",
                    "Table: Other",
                    "other-only",
                ].join("\n"),
            },
        });
        const result = await rollTable(p as any, "g.ipt", "Other");
        expect(result).toBe("other-only");
    });

    test("table name lookup is case-insensitive", async () => {
        // The engine's table registry uses lowercased keys; this is
        // the expected behaviour and worth pinning so the browser's
        // lookup doesn't break if a user types weird casing.
        const p = fakePlugin({
            files: {
                "g.ipt": [
                    "Table: MyTable",
                    "result",
                ].join("\n"),
            },
        });
        const result = await rollTable(p as any, "g.ipt", "mytable");
        expect(result).toBe("result");
    });

    test("throws when the table name doesn't exist", async () => {
        const p = fakePlugin({
            files: { "g.ipt": "Table: Real\nX" },
        });
        await expect(
            rollTable(p as any, "g.ipt", "DoesNotExist")
        ).rejects.toThrow(/Unknown table/);
    });

    test("Use: resolves across case mismatch (legacy IPP3 compatibility)", async () => {
        // Real-world scenario from a user vault: an Encounters file
        // does `Use: nbos\names\orc.ipt` but the actual file is at
        // `nbos/Names/Orc.ipt`. IPP3 on Windows was case-insensitive;
        // our vault-backed file source falls back to a case-folded
        // lookup so legacy generators work without manual renaming.
        const p = fakePlugin({
            files: {
                "IPP3/Common/nbos/Encounters/Orcs.ipt": [
                    "Use: nbos\\names\\orc.ipt",
                    "Table: RandomOrc",
                    "[@MasterOrcName]",
                ].join("\n"),
                // Note: filename uses different casing than the Use:
                // ref above ("Names" vs "names", "Orc" vs "orc").
                "IPP3/Common/nbos/Names/Orc.ipt": [
                    "Table: MasterOrcName",
                    "Crodath",
                ].join("\n"),
            },
            settings: { generatorRoot: "IPP3/Common" },
        });
        const result = await rollTable(
            p as any,
            "IPP3/Common/nbos/Encounters/Orcs.ipt",
            "RandomOrc"
        );
        expect(result).toBe("Crodath");
    });

    test("Use: with backslashes still works (Windows-style path separators)", async () => {
        // Sister case to the above. The path normaliser converts
        // backslashes to forward slashes before lookup, so a
        // `Use: nbos\names\orc.ipt` reference works the same as
        // `Use: nbos/names/orc.ipt`.
        const p = fakePlugin({
            files: {
                "a.ipt": [
                    "Use: sub\\b.ipt",
                    "Table: Main",
                    "[@FromB]",
                ].join("\n"),
                "sub/b.ipt": ["Table: FromB", "value"].join("\n"),
            },
        });
        const result = await rollTable(p as any, "a.ipt", "Main");
        expect(result).toBe("value");
    });

    test("IPP3 Common-library lookup resolves via <generatorRoot>/Common/", async () => {
        // The exact scenario the user reported from the screenshot:
        //   Generator root: IPP3
        //   File: IPP3/Common/nbos/Encounters/Orcs.ipt
        //   Use: nbos\names\orc.ipt
        //   Actual target: IPP3/Common/nbos/Names/Orc.ipt
        //
        // Previously, with root=IPP3, we'd try IPP3/nbos/names/orc.ipt
        // — missing the /Common/ layer. Now we additionally try
        // IPP3/Common/nbos/names/orc.ipt (which then case-folds to
        // IPP3/Common/nbos/Names/Orc.ipt via vaultFileSource).
        const p = fakePlugin({
            files: {
                "IPP3/Common/nbos/Encounters/Orcs.ipt": [
                    "Use: nbos\\names\\orc.ipt",
                    "Table: RandomOrc",
                    "[@MasterOrcName]",
                ].join("\n"),
                "IPP3/Common/nbos/Names/Orc.ipt": [
                    "Table: MasterOrcName",
                    "Crodath",
                ].join("\n"),
            },
            settings: { generatorRoot: "IPP3" },
        });
        const result = await rollTable(
            p as any,
            "IPP3/Common/nbos/Encounters/Orcs.ipt",
            "RandomOrc"
        );
        expect(result).toBe("Crodath");
    });
});

// ────────── Result-panel Copy ──────────

/**
 * Stub the clipboard for one test, then restore it.
 *
 * We assert on `writeText` only. The copy path deliberately writes a
 * single `text/plain` flavour — a `text/html` flavour comes back from
 * Android's WebView as a file and Obsidian saves it as a
 * `tempNNNN.html` attachment instead of pasting the text. To catch a
 * regression back to the old behaviour, `write` and `ClipboardItem`
 * are exposed and recorded: if anything starts using them again,
 * `writtenItems` will be non-empty and the tests below fail.
 */
function stubGlobalClipboard(): {
    writtenItems: unknown[];
    writtenText: string[];
    restore: () => void;
} {
    const writtenItems: unknown[] = [];
    const writtenText: string[] = [];

    const originalClip = (navigator as { clipboard?: unknown }).clipboard;
    const originalCI = (globalThis as { ClipboardItem?: unknown })
        .ClipboardItem;

    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
            writeText: async (s: string) => {
                writtenText.push(s);
            },
            write: async (items: unknown[]) => {
                for (const i of items) writtenItems.push(i);
            },
        },
    });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = function (
        this: unknown,
        parts: Record<string, Blob>
    ) {
        (this as { parts: Record<string, Blob> }).parts = parts;
    };

    return {
        writtenItems,
        writtenText,
        restore: () => {
            if (originalClip === undefined) {
                delete (navigator as { clipboard?: unknown }).clipboard;
            } else {
                Object.defineProperty(navigator, "clipboard", {
                    configurable: true,
                    value: originalClip,
                });
            }
            if (originalCI === undefined) {
                delete (globalThis as { ClipboardItem?: unknown })
                    .ClipboardItem;
            } else {
                (globalThis as { ClipboardItem?: unknown }).ClipboardItem =
                    originalCI;
            }
        },
    };
}

describe("result-panel Copy", () => {
    test("end-to-end: Roll then click result panel Copy writes markdown as plain text", async () => {
        // Driving the BrowserView through a real roll and then
        // clicking the panel's Copy button gives us coverage that
        // the wiring from roll → setLastRoll → renderResult →
        // copyResult → htmlToMarkdown all stays connected.
        const clip = stubGlobalClipboard();
        try {
            // Make a real BrowserView with a fake plugin.
            const fakePluginFor = (files: Record<string, string>) => {
                const map = new Map(Object.entries(files));
                const makeTFile = (path: string): TFile => {
                    const f = new TFile();
                    f.path = path;
                    const slash = path.lastIndexOf("/");
                    const base =
                        slash === -1 ? path : path.slice(slash + 1);
                    const dot = base.lastIndexOf(".");
                    f.basename =
                        dot === -1 ? base : base.slice(0, dot);
                    f.extension = dot === -1 ? "" : base.slice(dot + 1);
                    f.name = base;
                    return f;
                };
                return {
                    app: {
                        vault: {
                            getFiles: () =>
                                Array.from(map.keys()).map((p) =>
                                    makeTFile(p)
                                ),
                            async read(file: TFile) {
                                const v = map.get(file.path);
                                if (v === undefined)
                                    throw new Error("not found");
                                return v;
                            },
                            adapter: {
                                async read(path: string) {
                                    const v = map.get(path);
                                    if (v === undefined)
                                        throw new Error("not found");
                                    return v;
                                },
                                async exists(path: string) {
                                    return map.has(path);
                                },
                            },
                        },
                        workspace: {},
                    },
                    settings: {
                        ...DEFAULT_SETTINGS,
                        browserExpandedPaths: ["bold.ipt"],
                    } as RandomnessSettings,
                    saveSettings: async () => {},
                };
            };
            const fakeLeaf = () => {
                const c = document.createElement("div");
                c.appendChild(document.createElement("div"));
                c.appendChild(document.createElement("div"));
                return { containerEl: c };
            };
            const p = fakePluginFor({
                // The `>> bold` filter applies the bold filter (which
                // wraps in <b> in html mode). This is the canonical
                // pipe-filter syntax — the `\b{}` form I'd guessed
                // doesn't exist. Bracket text + ` >> filter` is the
                // way to apply named filters in IPP3.
                "bold.ipt": [
                    "Formatting: html",
                    "Table: T",
                    "[Bramath Guk >> bold]",
                ].join("\n"),
            });
            const { BrowserView } = await import(
                "../../src/views/browserView"
            );
            const view = new BrowserView(fakeLeaf() as any, p as any);
            await view.onOpen();

            // Click Roll on the (only) table.
            const root = view.containerEl.children[1] as HTMLElement;
            const rollBtn = root.querySelector(
                ".randomness-browser-roll-btn"
            ) as HTMLElement;
            rollBtn.click();
            await new Promise((r) => setTimeout(r, 30));

            // Now click the result panel's Copy button.
            const resultCopyBtn = root.querySelector(
                ".randomness-browser-copy-btn"
            ) as HTMLElement;
            expect(resultCopyBtn).toBeTruthy();
            resultCopyBtn.click();
            await new Promise((r) => setTimeout(r, 30));

            // Exactly one plain-text write, and no ClipboardItem.
            // The absent HTML flavour is the point: that flavour is
            // what Android turned into a tempNNNN.html attachment.
            expect(clip.writtenItems).toEqual([]);
            expect(clip.writtenText.length).toBe(1);
            const copied = clip.writtenText[0];
            // The bold filter wrapped the name in <b>, which reaches
            // the clipboard as markdown emphasis rather than a tag.
            expect(copied).toContain("**Bramath Guk**");
            expect(copied).not.toContain("<b>");
        } finally {
            clip.restore();
        }
    });

    test("end-to-end: multi-line roll output keeps line breaks", async () => {
        // Regression test for the bug where a multi-rep table (or
        // any table with \n escapes) had its line breaks collapsed
        // into spaces during paste. On the markdown path the engine's
        // real \n characters ARE line breaks, so they simply survive
        // — no <br> round-trip to lose them in.
        const clip = stubGlobalClipboard();
        try {
            const fakePluginFor = (files: Record<string, string>) => {
                const map = new Map(Object.entries(files));
                const makeTFile = (path: string): TFile => {
                    const f = new TFile();
                    f.path = path;
                    const slash = path.lastIndexOf("/");
                    const base =
                        slash === -1 ? path : path.slice(slash + 1);
                    const dot = base.lastIndexOf(".");
                    f.basename =
                        dot === -1 ? base : base.slice(0, dot);
                    f.extension =
                        dot === -1 ? "" : base.slice(dot + 1);
                    f.name = base;
                    return f;
                };
                return {
                    app: {
                        vault: {
                            getFiles: () =>
                                Array.from(map.keys()).map((p) =>
                                    makeTFile(p)
                                ),
                            async read(file: TFile) {
                                const v = map.get(file.path);
                                if (v === undefined)
                                    throw new Error("not found");
                                return v;
                            },
                            adapter: {
                                async read(path: string) {
                                    const v = map.get(path);
                                    if (v === undefined)
                                        throw new Error("not found");
                                    return v;
                                },
                                async exists(path: string) {
                                    return map.has(path);
                                },
                            },
                        },
                        workspace: {},
                    },
                    settings: {
                        ...DEFAULT_SETTINGS,
                        browserExpandedPaths: ["altars.ipt"],
                    } as RandomnessSettings,
                    saveSettings: async () => {},
                };
            };
            const fakeLeaf = () => {
                const c = document.createElement("div");
                c.appendChild(document.createElement("div"));
                c.appendChild(document.createElement("div"));
                return { containerEl: c };
            };
            // This table has \n escapes in its content — mirroring
            // the real-world altar generator that triggered the
            // bug report.
            const p = fakePluginFor({
                "altars.ipt": [
                    "Formatting: html",
                    "Table: Altar",
                    "An altar stands\\nIt has properties\\nDone",
                ].join("\n"),
            });
            const { BrowserView } = await import(
                "../../src/views/browserView"
            );
            const view = new BrowserView(fakeLeaf() as any, p as any);
            await view.onOpen();
            const root = view.containerEl.children[1] as HTMLElement;
            const rollBtn = root.querySelector(
                ".randomness-browser-roll-btn"
            ) as HTMLElement;
            rollBtn.click();
            await new Promise((r) => setTimeout(r, 30));
            const resultCopyBtn = root.querySelector(
                ".randomness-browser-copy-btn"
            ) as HTMLElement;
            resultCopyBtn.click();
            await new Promise((r) => setTimeout(r, 30));

            expect(clip.writtenItems).toEqual([]);
            const copied = clip.writtenText[0];
            // The bug was characterised by the three lines collapsing
            // into one. Verify the opposite.
            expect(copied).toMatch(
                /An altar stands\nIt has properties\nDone/
            );
        } finally {
            clip.restore();
        }
    });
});

// ────────── BrowserView (rendering + interaction) ──────────

/**
 * End-to-end-ish tests for the BrowserView class. We instantiate it
 * with a fake plugin + fake leaf, drive it through onOpen(), and
 * inspect the rendered DOM. Click handlers are exercised by
 * dispatching real click events on the rendered elements.
 *
 * What we want to pin:
 *   - Tree starts fully collapsed (only top-level folder/file rows
 *     visible; nothing nested).
 *   - Clicking a folder row toggles its expansion and persists.
 *   - Clicking the Collapse-all button clears the saved expansion.
 *   - Filter typing produces matches with their ancestors visible.
 *   - Filter survives Collapse-all.
 */
describe("BrowserView rendering and interaction", () => {
    // Build a fake plugin that also persists settings via a stub
    // saveSettings (the real plugin has this; the fakePlugin above
    // doesn't expose it). We extend it locally.
    function viewPlugin(opts: {
        files: Record<string, string>;
        settings?: Partial<RandomnessSettings>;
    }) {
        const p = fakePlugin(opts) as ReturnType<typeof fakePlugin> & {
            saveSettings: () => Promise<void>;
        };
        // No-op persistence — the test inspects p.settings directly
        // to verify writes happened.
        p.saveSettings = async () => {};
        return p;
    }

    /** Build a minimal WorkspaceLeaf-shaped object the ItemView can
     * mount onto. The real one comes from Obsidian; we just need
     * containerEl with two children (header + content). */
    function fakeLeaf(): any {
        const container = document.createElement("div");
        const header = document.createElement("div");
        const content = document.createElement("div");
        container.appendChild(header);
        container.appendChild(content);
        return { containerEl: container };
    }

    async function buildView(p: any) {
        const { BrowserView } = await import("../../src/views/browserView");
        const view = new BrowserView(fakeLeaf(), p as any);
        await view.onOpen();
        return view;
    }

    /** Pull all rendered folder/file headers from the DOM. */
    function getRowTexts(
        view: any
    ): { type: "folder" | "file"; text: string }[] {
        const root = view.containerEl.children[1] as HTMLElement;
        const out: { type: "folder" | "file"; text: string }[] = [];
        for (const el of Array.from(
            root.querySelectorAll(
                ".randomness-browser-folder-header, .randomness-browser-file-header"
            )
        )) {
            const cls = (el as HTMLElement).className;
            const type = cls.includes("folder-header") ? "folder" : "file";
            // Drop the chevron from the visible text; just keep the name.
            const nameEl = (el as HTMLElement).querySelector(
                ".randomness-browser-folder-name, .randomness-browser-file-title"
            );
            out.push({
                type,
                text: nameEl?.textContent ?? "",
            });
        }
        return out;
    }

    test("starts fully collapsed by default", async () => {
        const p = viewPlugin({
            files: {
                "Generators/Names/people.ipt": "Table: T\nAlice",
                "Generators/Loot/coins.ipt": "Table: T\nGold",
                "Generators/top.ipt": "Table: T\nX",
            },
            settings: { generatorRoot: "Generators" },
        });
        const view = await buildView(p);

        // With nothing expanded, only the direct children of the
        // Generators root should show.
        const rows = getRowTexts(view);
        expect(rows.map((r) => r.text)).toEqual(["Loot", "Names", "top"]);
        // The nested files (people.ipt, coins.ipt) should NOT appear.
    });

    test("clicking a folder header expands its children and persists", async () => {
        const p = viewPlugin({
            files: {
                "Generators/Names/people.ipt": "Table: T\nAlice",
                "Generators/Names/places.ipt": "Table: T\nMordor",
            },
            settings: { generatorRoot: "Generators" },
        });
        const view = await buildView(p);

        const root = view.containerEl.children[1] as HTMLElement;
        const namesHeader = Array.from(
            root.querySelectorAll(".randomness-browser-folder-header")
        ).find((el) =>
            el.textContent?.includes("Names")
        ) as HTMLElement;
        expect(namesHeader).toBeTruthy();
        namesHeader.click();
        // Click handler is async (saveSettings); settle.
        await new Promise((r) => setTimeout(r, 10));

        // Now both nested files should appear.
        const rows = getRowTexts(view);
        expect(rows.some((r) => r.text === "people")).toBe(true);
        expect(rows.some((r) => r.text === "places")).toBe(true);

        // Settings recorded the expansion.
        expect(p.settings.browserExpandedPaths).toContain("Generators/Names");
    });

    test("clicking an expanded folder again collapses it", async () => {
        const p = viewPlugin({
            files: { "Generators/Names/people.ipt": "Table: T\nA" },
            settings: {
                generatorRoot: "Generators",
                browserExpandedPaths: ["Generators/Names"],
            },
        });
        const view = await buildView(p);

        // Pre-condition: nested file IS visible.
        expect(getRowTexts(view).some((r) => r.text === "people")).toBe(true);

        const root = view.containerEl.children[1] as HTMLElement;
        const namesHeader = root.querySelector(
            ".randomness-browser-folder-header"
        ) as HTMLElement;
        namesHeader.click();
        await new Promise((r) => setTimeout(r, 10));

        // After click, the file is gone again.
        expect(getRowTexts(view).some((r) => r.text === "people")).toBe(false);
        expect(p.settings.browserExpandedPaths).not.toContain(
            "Generators/Names"
        );
    });

    test("Collapse-all button clears the persistent expansion set", async () => {
        const p = viewPlugin({
            files: {
                "Generators/Names/people.ipt": "Table: T\nA",
                "Generators/Loot/coins.ipt": "Table: T\nB",
            },
            settings: {
                generatorRoot: "Generators",
                browserExpandedPaths: [
                    "Generators/Names",
                    "Generators/Loot",
                ],
            },
        });
        const view = await buildView(p);
        // Pre-condition: both nested files visible.
        expect(getRowTexts(view).some((r) => r.text === "people")).toBe(true);

        const root = view.containerEl.children[1] as HTMLElement;
        const collapseBtn = root.querySelector(
            ".randomness-browser-collapse-all"
        ) as HTMLElement;
        expect(collapseBtn).toBeTruthy();
        collapseBtn.click();
        await new Promise((r) => setTimeout(r, 10));

        expect(p.settings.browserExpandedPaths).toEqual([]);
        // Nested files no longer visible.
        expect(getRowTexts(view).some((r) => r.text === "people")).toBe(false);
        expect(getRowTexts(view).some((r) => r.text === "coins")).toBe(false);
    });

    test("filter shows matches even when their folders are collapsed (auto-expand)", async () => {
        const p = viewPlugin({
            files: {
                "Generators/Names/people.ipt": "Table: T\nAlice",
                "Generators/Loot/coins.ipt": "Table: T\nGold",
            },
            settings: {
                generatorRoot: "Generators",
                // Nothing expanded persistently.
                browserExpandedPaths: [],
            },
        });
        const view = await buildView(p);
        // Pre-condition: nothing nested visible.
        expect(getRowTexts(view).some((r) => r.text === "people")).toBe(false);

        // Type a filter that matches a nested file.
        const root = view.containerEl.children[1] as HTMLElement;
        const filterBox = root.querySelector(
            ".randomness-browser-filter"
        ) as HTMLInputElement;
        filterBox.value = "people";
        filterBox.dispatchEvent(new Event("input"));
        await new Promise((r) => setTimeout(r, 10));

        // The match and its ancestor folder are now visible.
        const rows = getRowTexts(view);
        expect(rows.some((r) => r.text === "Names")).toBe(true);
        expect(rows.some((r) => r.text === "people")).toBe(true);
        // The non-matching branch is gone.
        expect(rows.some((r) => r.text === "Loot")).toBe(false);
    });

    test("filter survives Collapse-all", async () => {
        const p = viewPlugin({
            files: {
                "Generators/Names/people.ipt": "Table: T\nA",
            },
            settings: {
                generatorRoot: "Generators",
                browserExpandedPaths: ["Generators/Names"],
            },
        });
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;

        // Type a filter.
        const filterBox = root.querySelector(
            ".randomness-browser-filter"
        ) as HTMLInputElement;
        filterBox.value = "people";
        filterBox.dispatchEvent(new Event("input"));
        await new Promise((r) => setTimeout(r, 10));

        // Now hit Collapse-all.
        const collapseBtn = root.querySelector(
            ".randomness-browser-collapse-all"
        ) as HTMLElement;
        collapseBtn.click();
        await new Promise((r) => setTimeout(r, 10));

        // Filter input still has "people".
        expect(
            (root.querySelector(
                ".randomness-browser-filter"
            ) as HTMLInputElement).value
        ).toBe("people");
        // Match is still visible because filter forces ancestor expansion.
        expect(getRowTexts(view).some((r) => r.text === "people")).toBe(true);
    });

    test("expanded file shows its tables with Roll buttons", async () => {
        const p = viewPlugin({
            files: {
                "names.ipt": [
                    "Title: Names",
                    "Table: First",
                    "Alice",
                    "",
                    "Table: Last",
                    "Smith",
                ].join("\n"),
            },
            settings: {
                browserExpandedPaths: ["names.ipt"],
            },
        });
        const view = await buildView(p);

        const root = view.containerEl.children[1] as HTMLElement;
        const buttons = root.querySelectorAll(".randomness-browser-roll-btn");
        // Two tables → two Roll buttons.
        expect(buttons.length).toBe(2);
    });

    test("clicking a Roll button doesn't toggle the parent file's expansion", async () => {
        // The Roll button sits inside the file's expanded body. If
        // the click bubbled up to the file-header handler we'd
        // collapse the file every time we rolled — annoying.
        const p = viewPlugin({
            files: { "g.ipt": "Title: G\nTable: T\nX" },
            settings: { browserExpandedPaths: ["g.ipt"] },
        });
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;

        const rollBtn = root.querySelector(
            ".randomness-browser-roll-btn"
        ) as HTMLElement;
        expect(rollBtn).toBeTruthy();
        rollBtn.click();
        await new Promise((r) => setTimeout(r, 30));

        // File should still be expanded — the Roll click didn't bubble
        // to the header's toggle handler.
        expect(p.settings.browserExpandedPaths).toContain("g.ipt");
    });
});

// ────────── buildInlineSyntax ──────────

describe("buildInlineSyntax", () => {
    test("wraps a table name in the rdm: code-span form", () => {
        expect(buildInlineSyntax("MasterOrcName")).toBe(
            "`rdm:[@MasterOrcName]`"
        );
    });

    test("tolerates table names with spaces", () => {
        // Real IPP3 generators sometimes name tables with spaces,
        // e.g. "Random Treasure CR 1". The [@...] parser accepts
        // them, so the inline form does too.
        expect(buildInlineSyntax("First Name")).toBe(
            "`rdm:[@First Name]`"
        );
    });
});

// ────────── buildSelfContainedSnippet ──────────

describe("buildSelfContainedSnippet", () => {
    test("emits a randomness codeblock with Use: + blank line + inline call", () => {
        const snippet = buildSelfContainedSnippet(
            "Generators/names.ipt",
            "FirstName"
        );
        // Three parts joined: codeblock, blank line, inline call.
        // The blank line matters in markdown — without it, the
        // inline call would fuse with the closing fence into a
        // single paragraph that wouldn't render as a code block.
        expect(snippet).toBe(
            "```randomness\nUse: Generators/names.ipt\n```\n\n`rdm:[@FirstName]`"
        );
    });

    test("preserves backslashes in legacy IPP3 paths verbatim", () => {
        // Some users have Use: lines with Windows-style paths in
        // legacy generators they imported. Our resolver normalises
        // both forms, so the snippet doesn't need to rewrite.
        const snippet = buildSelfContainedSnippet(
            "nbos\\Names\\Orc.ipt",
            "MasterOrcName"
        );
        expect(snippet).toContain("Use: nbos\\Names\\Orc.ipt");
    });
});

// ────────── noteImportsFile ──────────

describe("noteImportsFile", () => {
    test("returns true when a randomness codeblock has matching Use:", () => {
        const note = [
            "# Note",
            "```randomness",
            "Use: Generators/names.ipt",
            "Table: T",
            "x",
            "```",
            "",
            "Some prose.",
        ].join("\n");
        expect(noteImportsFile(note, "Generators/names.ipt")).toBe(true);
    });

    test("returns false when no codeblock imports the file", () => {
        const note = "# A note with no codeblocks";
        expect(noteImportsFile(note, "Generators/names.ipt")).toBe(false);
    });

    test("returns false when codeblock imports a different file", () => {
        const note = [
            "```randomness",
            "Use: Generators/loot.ipt",
            "```",
        ].join("\n");
        expect(noteImportsFile(note, "Generators/names.ipt")).toBe(false);
    });

    test("matches case-insensitively", () => {
        const note = [
            "```randomness",
            "Use: Generators/Names.ipt",
            "```",
        ].join("\n");
        expect(noteImportsFile(note, "generators/names.ipt")).toBe(true);
        expect(noteImportsFile(note, "GENERATORS/NAMES.IPT")).toBe(true);
    });

    test("normalises backslashes to forward slashes for comparison", () => {
        // Legacy IPP3 path style in the Use: line; our file path
        // is forward-slash form. Should still match.
        const note = [
            "```randomness",
            "Use: nbos\\Names\\Orc.ipt",
            "```",
        ].join("\n");
        expect(noteImportsFile(note, "nbos/Names/Orc.ipt")).toBe(true);
    });

    test("matches basename when Use: is a relative reference to a deep file", () => {
        // User has the file at IPP3/Common/nbos/Names/Orc.ipt but
        // their Use: line just says `Use: Orc.ipt` (relative to
        // the caller's dir, which the resolver handles). The
        // detection scan tolerates this approximation — false
        // positives just mean a redundant Use:, which is benign.
        const note = [
            "```randomness",
            "Use: Orc.ipt",
            "```",
        ].join("\n");
        expect(
            noteImportsFile(note, "IPP3/Common/nbos/Names/Orc.ipt")
        ).toBe(true);
    });

    test("ignores Use: lines outside of randomness codeblocks", () => {
        // A `Use:` line in plain prose or in a non-randomness
        // codeblock shouldn't count — only the inline scope is
        // built from `randomness` fences.
        const note = [
            "Use: names.ipt",
            "",
            "```python",
            "Use: names.ipt",
            "```",
        ].join("\n");
        expect(noteImportsFile(note, "names.ipt")).toBe(false);
    });

    test("returns false for empty inputs", () => {
        expect(noteImportsFile("", "anything.ipt")).toBe(false);
        expect(noteImportsFile("```randomness\nUse: x\n```", "")).toBe(false);
    });

    test("handles multiple codeblocks, returns true if any matches", () => {
        const note = [
            "```randomness",
            "Use: other.ipt",
            "```",
            "",
            "Some text.",
            "",
            "```randomness",
            "Use: target.ipt",
            "```",
        ].join("\n");
        expect(noteImportsFile(note, "target.ipt")).toBe(true);
    });
});

// ────────── Copy-inline button (rendered + click flow) ──────────

describe("BrowserView Copy-inline button", () => {
    /**
     * Install a stub navigator.clipboard so the test can observe what
     * the view tried to write. jsdom's default `navigator` has no
     * clipboard property; we attach one for the duration of the test
     * and put it back afterwards.
     *
     * Returns an object whose `.last` is the last string written.
     */
    function stubClipboard(): { last: string | null; restore: () => void } {
        const original = (navigator as { clipboard?: unknown }).clipboard;
        const state = { last: null as string | null };
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                writeText: async (s: string) => {
                    state.last = s;
                },
            },
        });
        return {
            get last() {
                return state.last;
            },
            restore: () => {
                if (original === undefined) {
                    delete (navigator as { clipboard?: unknown }).clipboard;
                } else {
                    Object.defineProperty(navigator, "clipboard", {
                        configurable: true,
                        value: original,
                    });
                }
            },
        };
    }

    // The browserView module's view-integration helpers (viewPlugin,
    // buildView) live in the previous describe block above. We
    // duplicate the minimum we need here rather than refactoring
    // them up — that's a polish task for later if more describe
    // blocks need them.
    function viewPlugin(opts: {
        files: Record<string, string>;
        settings?: Partial<RandomnessSettings>;
    }) {
        const p = fakePlugin(opts) as ReturnType<typeof fakePlugin> & {
            saveSettings: () => Promise<void>;
        };
        p.saveSettings = async () => {};
        return p;
    }
    function fakeLeaf(): any {
        const container = document.createElement("div");
        container.appendChild(document.createElement("div"));
        container.appendChild(document.createElement("div"));
        return { containerEl: container };
    }
    async function buildView(p: any) {
        const { BrowserView } = await import(
            "../../src/views/browserView"
        );
        const view = new BrowserView(fakeLeaf(), p as any);
        await view.onOpen();
        return view;
    }

    test("renders a Copy button next to each table's Roll button", async () => {
        const p = viewPlugin({
            files: {
                "names.ipt": [
                    "Title: Names",
                    "Table: First",
                    "Alice",
                    "",
                    "Table: Last",
                    "Smith",
                ].join("\n"),
            },
            settings: { browserExpandedPaths: ["names.ipt"] },
        });
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;
        const copyButtons = root.querySelectorAll(
            ".randomness-browser-copy-inline-btn"
        );
        // Two tables → two Copy buttons (one per row).
        expect(copyButtons.length).toBe(2);
    });

    test("clicking Copy with no active note copies a self-contained codeblock + inline call", async () => {
        // No active note → no way to know whether the user's note
        // already imports the generator. Safe fallback: ship a
        // self-contained snippet that imports + rolls.
        const clip = stubClipboard();
        try {
            const p = viewPlugin({
                files: {
                    "names.ipt": [
                        "Title: Names",
                        "Table: FirstName",
                        "Alice",
                    ].join("\n"),
                },
                settings: { browserExpandedPaths: ["names.ipt"] },
            });
            const view = await buildView(p);
            const root = view.containerEl.children[1] as HTMLElement;
            const copyBtn = root.querySelector(
                ".randomness-browser-copy-inline-btn"
            ) as HTMLElement;
            expect(copyBtn).toBeTruthy();
            copyBtn.click();
            await new Promise((r) => setTimeout(r, 20));
            // Codeblock form: ```randomness ... ``` then blank line
            // then the inline call.
            expect(clip.last).toBe(
                "```randomness\nUse: names.ipt\n```\n\n`rdm:[@FirstName]`"
            );
        } finally {
            clip.restore();
        }
    });

    test("clicking Copy with active note that already imports the file copies just the inline form", async () => {
        // The active note has a `randomness` codeblock that Use:s
        // names.ipt — so the inline call alone will work in that
        // note's scope. Copy should be terse.
        const clip = stubClipboard();
        try {
            const noteSource = [
                "# A note",
                "",
                "```randomness",
                "Use: names.ipt",
                "Table: Greeting",
                "Hello, [@FirstName]!",
                "```",
                "",
                "Some prose.",
            ].join("\n");
            const namesContent = [
                "Title: Names",
                "Table: FirstName",
                "Alice",
            ].join("\n");
            const p = viewPlugin({
                files: {
                    "names.ipt": namesContent,
                    "current-note.md": noteSource,
                },
                settings: { browserExpandedPaths: ["names.ipt"] },
            });
            // Wire up an active file pointing at the note. Do NOT
            // replace vault.read wholesale — that would also break
            // discoverGenerators, which reads .ipt files. We only
            // need read to route by path.
            const activeFile = new TFile();
            activeFile.path = "current-note.md";
            activeFile.extension = "md";
            (p.app.workspace as any).getActiveFile = () => activeFile;
            const view = await buildView(p);
            const root = view.containerEl.children[1] as HTMLElement;
            const copyBtn = root.querySelector(
                ".randomness-browser-copy-inline-btn"
            ) as HTMLElement;
            copyBtn.click();
            await new Promise((r) => setTimeout(r, 20));
            expect(clip.last).toBe("`rdm:[@FirstName]`");
        } finally {
            clip.restore();
        }
    });

    test("clicking Copy with active note that does NOT import the file copies the codeblock form", async () => {
        // Active note exists but has no Use: for names.ipt. Should
        // get the self-contained snippet so paste-and-go works.
        const clip = stubClipboard();
        try {
            const noteSource = "# A note with no Use: codeblock";
            const p = viewPlugin({
                files: {
                    "names.ipt": [
                        "Title: Names",
                        "Table: FirstName",
                        "Alice",
                    ].join("\n"),
                    "fresh-note.md": noteSource,
                },
                settings: { browserExpandedPaths: ["names.ipt"] },
            });
            const activeFile = new TFile();
            activeFile.path = "fresh-note.md";
            activeFile.extension = "md";
            (p.app.workspace as any).getActiveFile = () => activeFile;
            const view = await buildView(p);
            const root = view.containerEl.children[1] as HTMLElement;
            const copyBtn = root.querySelector(
                ".randomness-browser-copy-inline-btn"
            ) as HTMLElement;
            copyBtn.click();
            await new Promise((r) => setTimeout(r, 20));
            expect(clip.last).toBe(
                "```randomness\nUse: names.ipt\n```\n\n`rdm:[@FirstName]`"
            );
        } finally {
            clip.restore();
        }
    });

    test("clicking Copy doesn't toggle the parent file's expansion", async () => {
        // Same bubble-stop concern as the Roll button: we don't want
        // the user's click on Copy to also collapse the file row.
        const clip = stubClipboard();
        try {
            const p = viewPlugin({
                files: { "g.ipt": "Title: G\nTable: T\nX" },
                settings: { browserExpandedPaths: ["g.ipt"] },
            });
            const view = await buildView(p);
            const root = view.containerEl.children[1] as HTMLElement;
            const copyBtn = root.querySelector(
                ".randomness-browser-copy-inline-btn"
            ) as HTMLElement;
            copyBtn.click();
            await new Promise((r) => setTimeout(r, 20));
            expect(p.settings.browserExpandedPaths).toContain("g.ipt");
        } finally {
            clip.restore();
        }
    });

    // ────────── Favourites / pinned tables ──────────

    test("no Favourites section when no tables are pinned", async () => {
        const p = viewPlugin({
            files: { "g.ipt": "Title: G\nTable: T\nX" },
            settings: { browserExpandedPaths: ["g.ipt"] },
        });
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;
        // The favourites wrap is identified by its CSS class.
        expect(
            root.querySelector(".randomness-browser-favourites")
        ).toBeNull();
    });

    test("Favourites section appears when at least one table is pinned", async () => {
        const p = viewPlugin({
            files: { "g.ipt": "Title: G\nTable: T\nX" },
            settings: {
                browserExpandedPaths: ["g.ipt", "__favourites"],
                pinnedTables: ["g.ipt::T"],
            },
        });
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;
        const favs = root.querySelector(
            ".randomness-browser-favourites"
        ) as HTMLElement;
        expect(favs).not.toBeNull();
        // Header text includes the section name.
        const header = favs.querySelector(
            ".randomness-browser-folder-name"
        ) as HTMLElement;
        expect(header.textContent).toContain("Favourites");
        // Count badge reflects the number of pinned tables.
        const count = favs.querySelector(
            ".randomness-browser-folder-count"
        ) as HTMLElement;
        expect(count.textContent).toBe("1");
    });

    test("clicking a Pin button adds the table to pinnedTables", async () => {
        const p = viewPlugin({
            files: { "g.ipt": "Title: G\nTable: T\nX" },
            settings: { browserExpandedPaths: ["g.ipt"] },
        });
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;
        const pinBtn = root.querySelector(
            ".randomness-browser-pin-btn"
        ) as HTMLElement;
        expect(pinBtn).not.toBeNull();
        pinBtn.click();
        await new Promise((r) => setTimeout(r, 20));
        expect(p.settings.pinnedTables).toEqual(["g.ipt::T"]);
    });

    test("clicking an already-pinned table's Pin button unpins it", async () => {
        const p = viewPlugin({
            files: { "g.ipt": "Title: G\nTable: T\nX" },
            settings: {
                browserExpandedPaths: ["g.ipt"],
                pinnedTables: ["g.ipt::T"],
            },
        });
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;
        // First pin button is the one inside the favourites section
        // (rendered before the regular tree). Either one will toggle
        // the same persisted state — use the regular tree's button
        // for clarity.
        const fileButtons = Array.from(
            root.querySelectorAll(".randomness-browser-pin-btn")
        );
        // Click the LAST pin button: should be inside the file's
        // regular row. The first is in the favourites section.
        const inFileBtn = fileButtons[
            fileButtons.length - 1
        ] as HTMLElement;
        inFileBtn.click();
        await new Promise((r) => setTimeout(r, 20));
        expect(p.settings.pinnedTables).toEqual([]);
    });

    test("clicking Pin button does NOT toggle file expansion", async () => {
        // Same defence as the Copy-inline button: the pin click
        // mustn't bubble up to the file header's collapse handler.
        const p = viewPlugin({
            files: { "g.ipt": "Title: G\nTable: T\nX" },
            settings: { browserExpandedPaths: ["g.ipt"] },
        });
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;
        const pinBtn = root.querySelector(
            ".randomness-browser-pin-btn"
        ) as HTMLElement;
        pinBtn.click();
        await new Promise((r) => setTimeout(r, 20));
        // The file must still be expanded — i.e. its path is still
        // in the persisted expansion set.
        expect(p.settings.browserExpandedPaths).toContain("g.ipt");
    });

    test("pinned table can be rolled from the Favourites section", async () => {
        const p = viewPlugin({
            files: { "g.ipt": "Title: G\nTable: T\nthe-result" },
            settings: {
                browserExpandedPaths: ["__favourites"],
                pinnedTables: ["g.ipt::T"],
            },
        });
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;
        // The Roll button inside the favourites section
        const favs = root.querySelector(
            ".randomness-browser-favourites"
        ) as HTMLElement;
        const rollBtn = favs.querySelector(
            ".randomness-browser-roll-btn"
        ) as HTMLElement;
        expect(rollBtn).not.toBeNull();
        rollBtn.click();
        await new Promise((r) => setTimeout(r, 30));
        // The result panel should show the result.
        const body = root.querySelector(
            ".randomness-browser-result-body"
        ) as HTMLElement;
        expect(body.textContent).toContain("the-result");
    });

    test("Favourites section is sourced in pin-insertion order", async () => {
        // The user pinned 'B' first, then 'A'. Even though 'A'
        // sorts alphabetically first, the favourites list should
        // show B then A — insertion order, oldest first.
        const p = viewPlugin({
            files: {
                "a.ipt": "Title: A\nTable: TA\nX",
                "b.ipt": "Title: B\nTable: TB\nX",
            },
            settings: {
                browserExpandedPaths: ["__favourites"],
                pinnedTables: ["b.ipt::TB", "a.ipt::TA"],
            },
        });
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;
        const favs = root.querySelector(
            ".randomness-browser-favourites"
        ) as HTMLElement;
        const names = Array.from(
            favs.querySelectorAll(".randomness-browser-table-name")
        ).map((el) => el.textContent ?? "");
        // Main tables get a ★ prefix in display; the order is what
        // we're verifying — insertion order, B before A.
        expect(names).toEqual(["★ TB", "★ TA"]);
    });

    test("Favourites shows the source file as a subtitle for context", async () => {
        // When pinned tables come from multiple files, the source
        // file name appears underneath the table name so users can
        // tell similarly-named tables apart.
        const p = viewPlugin({
            files: {
                "a.ipt": "Title: AlphaFile\nTable: Name\nX",
                "b.ipt": "Title: BetaFile\nTable: Name\nY",
            },
            settings: {
                browserExpandedPaths: ["__favourites"],
                pinnedTables: ["a.ipt::Name", "b.ipt::Name"],
            },
        });
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;
        const favs = root.querySelector(
            ".randomness-browser-favourites"
        ) as HTMLElement;
        const sources = Array.from(
            favs.querySelectorAll(".randomness-browser-table-source")
        ).map((el) => el.textContent ?? "");
        expect(sources).toEqual(["AlphaFile", "BetaFile"]);
    });

    test("pin id persists across renders (round-trip through settings)", async () => {
        // Simulate "pin → reload" by building a fresh view from
        // the same persisted settings. The favourites section
        // should still show the pin.
        const p = viewPlugin({
            files: { "g.ipt": "Title: G\nTable: T\nX" },
            settings: { browserExpandedPaths: ["g.ipt"] },
        });
        const view1 = await buildView(p);
        const root1 = view1.containerEl.children[1] as HTMLElement;
        (root1.querySelector(
            ".randomness-browser-pin-btn"
        ) as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 20));
        expect(p.settings.pinnedTables).toEqual(["g.ipt::T"]);
        // Build a second view with the (now-modified) settings.
        const view2 = await buildView(p);
        const root2 = view2.containerEl.children[1] as HTMLElement;
        const favs = root2.querySelector(
            ".randomness-browser-favourites"
        );
        expect(favs).not.toBeNull();
    });

    test("missing-file pins don't crash the render", async () => {
        // If the user pinned a table whose file was later deleted
        // or moved, the favourites section should silently skip
        // it rather than throwing.
        const p = viewPlugin({
            files: { "g.ipt": "Title: G\nTable: T\nX" },
            settings: {
                browserExpandedPaths: ["__favourites"],
                pinnedTables: [
                    "nonexistent.ipt::Missing",
                    "g.ipt::T",
                ],
            },
        });
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;
        const favs = root.querySelector(
            ".randomness-browser-favourites"
        ) as HTMLElement;
        // Only the resolvable pin shows.
        const names = Array.from(
            favs.querySelectorAll(".randomness-browser-table-name")
        ).map((el) => el.textContent);
        // T is the main table of its file, hence the ★ prefix.
        expect(names).toEqual(["★ T"]);
        // Settings still has both — we don't auto-purge.
        expect(p.settings.pinnedTables).toContain(
            "nonexistent.ipt::Missing"
        );
    });

    // ────────── Wiki-link interpolation (images + links) ──────────

    test("result panel renders `![[image.png]]` as an <img>", async () => {
        // Generator outputs a wiki-image-embed. After rolling, the
        // result panel should contain an actual <img>, not literal
        // `![[image.png]]` text.
        const tfile = new TFile();
        (tfile as unknown as { path: string }).path = "Attach/dragon.png";
        const p = viewPlugin({
            files: {
                "g.ipt": "Title: G\nTable: T\n![[dragon.png]]",
            },
            settings: { browserExpandedPaths: ["g.ipt"] },
        });
        // Inject a metadataCache that resolves dragon.png.
        (p.app as any).metadataCache = {
            getFirstLinkpathDest: (linkpath: string) =>
                linkpath === "dragon.png" ? tfile : null,
        };
        // Inject getResourcePath on the vault.
        (p.app.vault as any).getResourcePath = (f: { path: string }) =>
            "app://vault/" + f.path;
        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;

        // Roll the (only) table.
        const rollBtn = root.querySelector(
            ".randomness-browser-roll-btn"
        ) as HTMLElement;
        rollBtn.click();
        await new Promise((r) => setTimeout(r, 30));

        const resultBody = root.querySelector(
            ".randomness-browser-result-body"
        ) as HTMLElement;
        const img = resultBody.querySelector("img");
        expect(img).not.toBeNull();
        expect(img!.src).toContain("Attach/dragon.png");
        // Literal text should NOT appear — it should have been
        // replaced with the element.
        expect(resultBody.textContent).not.toContain("![[dragon.png]]");
    });

    test("result panel renders `[[Note]]` as a clickable <a>", async () => {
        const tfile = new TFile();
        (tfile as unknown as { path: string }).path = "Lore/dragon.md";
        const p = viewPlugin({
            files: {
                "g.ipt": "Title: G\nTable: T\n[[Dragon Lore]]",
            },
            settings: { browserExpandedPaths: ["g.ipt"] },
        });
        (p.app as any).metadataCache = {
            getFirstLinkpathDest: (linkpath: string) =>
                linkpath === "Dragon Lore" ? tfile : null,
        };
        (p.app.vault as any).getResourcePath = () => "";
        const openSpy = jest.fn();
        (p.app.workspace as any).openLinkText = openSpy;

        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;
        const rollBtn = root.querySelector(
            ".randomness-browser-roll-btn"
        ) as HTMLElement;
        rollBtn.click();
        await new Promise((r) => setTimeout(r, 30));

        const resultBody = root.querySelector(
            ".randomness-browser-result-body"
        ) as HTMLElement;
        const a = resultBody.querySelector("a") as HTMLAnchorElement;
        expect(a).not.toBeNull();
        expect(a.textContent).toBe("Dragon Lore");
        // Click → openLinkText fires with the source generator's
        // path as sourcePath (so relative links resolve correctly).
        a.click();
        expect(openSpy).toHaveBeenCalledWith(
            "Dragon Lore",
            "g.ipt",
            false /* not new pane */
        );
    });

    test("result panel preserves wiki-syntax around other content", async () => {
        // Mixed content: image + surrounding prose. Both image and
        // text should be present after rendering.
        const tfile = new TFile();
        (tfile as unknown as { path: string }).path = "x.png";
        const p = viewPlugin({
            files: {
                "g.ipt": "Title: G\nTable: T\nBehold: ![[x.png]] majestic.",
            },
            settings: { browserExpandedPaths: ["g.ipt"] },
        });
        (p.app as any).metadataCache = {
            getFirstLinkpathDest: (linkpath: string) =>
                linkpath === "x.png" ? tfile : null,
        };
        (p.app.vault as any).getResourcePath = (f: { path: string }) =>
            "app://vault/" + f.path;

        const view = await buildView(p);
        const root = view.containerEl.children[1] as HTMLElement;
        const rollBtn = root.querySelector(
            ".randomness-browser-roll-btn"
        ) as HTMLElement;
        rollBtn.click();
        await new Promise((r) => setTimeout(r, 30));

        const resultBody = root.querySelector(
            ".randomness-browser-result-body"
        ) as HTMLElement;
        expect(resultBody.querySelector("img")).not.toBeNull();
        expect(resultBody.textContent).toContain("Behold:");
        expect(resultBody.textContent).toContain("majestic.");
    });
});
