jest.mock("../../src/engine/fileParser", () => ({
    parseGeneratorFile: jest.fn(),
}));
jest.mock("../../src/views/inlineProcessor", () => ({
    evaluateInlineExpression: jest.fn(),
}));
jest.mock("../../src/resolver/scope", () => ({
    buildInlineBundle: jest.fn(),
}));
jest.mock("../../src/resolver/asyncPrefetcher", () => ({
    prefetchUseGraph: jest.fn(),
}));
jest.mock("../../src/views/vaultFileSource", () => ({
    vaultFileSource: jest.fn(),
}));
jest.mock("../../src/views/browserView", () => ({
    discoverGenerators: jest.fn(),
}));
jest.mock("../../src/views/tableAutocomplete", () => ({
    collectTablesFromBundle: jest.fn(),
}));

import { TFile } from "obsidian";
import { createApi } from "../../src/api/index";
import { parseGeneratorFile } from "../../src/engine/fileParser";
import { evaluateInlineExpression } from "../../src/views/inlineProcessor";
import { buildInlineBundle } from "../../src/resolver/scope";
import { prefetchUseGraph } from "../../src/resolver/asyncPrefetcher";
import { discoverGenerators } from "../../src/views/browserView";
import { collectTablesFromBundle } from "../../src/views/tableAutocomplete";
import { DEFAULT_SETTINGS, RandomnessSettings } from "../../src/views/settings";

const parseGeneratorFileMock = parseGeneratorFile as jest.MockedFunction<typeof parseGeneratorFile>;
const evaluateMock = evaluateInlineExpression as jest.MockedFunction<typeof evaluateInlineExpression>;
const buildInlineBundleMock = buildInlineBundle as jest.MockedFunction<typeof buildInlineBundle>;
const prefetchUseGraphMock = prefetchUseGraph as jest.MockedFunction<typeof prefetchUseGraph>;
const discoverGeneratorsMock = discoverGenerators as jest.MockedFunction<typeof discoverGenerators>;
const collectTablesFromBundleMock = collectTablesFromBundle as jest.MockedFunction<typeof collectTablesFromBundle>;

interface PluginHarness {
    plugin: {
        app: {
            vault: {
                getAbstractFileByPath: (path: string) => TFile | null;
                getFiles: () => TFile[];
                read: (file: TFile) => Promise<string>;
            };
            workspace: {
                getActiveFile: () => TFile | null;
            };
        };
        settings: RandomnessSettings;
    };
    files: Map<string, string>;
    getAbstractFileByPath: jest.Mock<TFile | null, [string]>;
    getFiles: jest.Mock<TFile[], []>;
    getActiveFile: jest.Mock<TFile | null, []>;
    read: jest.Mock<Promise<string>, [TFile]>;
}

let uuidCounter = 0;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

function makeSettings(overrides: Partial<RandomnessSettings> = {}): RandomnessSettings {
    return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeTFile(path: string): TFile {
    const file = new TFile();
    const parts = path.split("/");
    const name = parts[parts.length - 1] ?? path;
    const dotIndex = name.lastIndexOf(".");
    file.path = path;
    file.name = name;
    file.basename = dotIndex >= 0 ? name.slice(0, dotIndex) : name;
    file.extension = dotIndex >= 0 ? name.slice(dotIndex + 1) : "";
    file.parent = null;
    return file;
}

function makePlugin(opts: {
    settings?: Partial<RandomnessSettings>;
    files?: Record<string, string>;
    activeFilePath?: string | null;
    extraPaths?: string[];
} = {}): PluginHarness {
    const files = new Map<string, string>(Object.entries(opts.files ?? {}));
    const tFiles = new Map<string, TFile>();
    const allPaths = new Set<string>([
        ...files.keys(),
        ...(opts.extraPaths ?? []),
        ...(opts.activeFilePath ? [opts.activeFilePath] : []),
    ]);
    for (const path of allPaths) {
        tFiles.set(path, makeTFile(path));
    }

    const read = jest.fn(async (file: TFile) => {
        const source = files.get(file.path);
        if (source === undefined) throw new Error(`missing file: ${file.path}`);
        return source;
    });
    const getAbstractFileByPath = jest.fn((path: string) => tFiles.get(path) ?? null);
    const getFiles = jest.fn(() => [...tFiles.values()]);
    const getActiveFile = jest.fn(() => (opts.activeFilePath ? tFiles.get(opts.activeFilePath) ?? null : null));

    return {
        plugin: {
            app: {
                vault: { getAbstractFileByPath, getFiles, read },
                workspace: { getActiveFile },
            },
            settings: makeSettings(opts.settings),
        },
        files,
        getAbstractFileByPath,
        getFiles,
        getActiveFile,
        read,
    };
}

function makeApi(harness: PluginHarness) {
    return createApi(harness.plugin as never);
}

function setUpInScopeMocks(inScopeTables: Array<{
    name: string;
    source: string;
    isMain: boolean;
    filePath: string;
}>) {
    prefetchUseGraphMock.mockResolvedValue({ source: "prefetched-source" } as Awaited<ReturnType<typeof prefetchUseGraph>>);
    buildInlineBundleMock.mockReturnValue({
        extras: "extras",
        loadedPaths: ["Tables/in-scope.ipt"],
    } as ReturnType<typeof buildInlineBundle>);
    collectTablesFromBundleMock.mockReturnValue(
        inScopeTables as ReturnType<typeof collectTablesFromBundle>,
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    parseGeneratorFileMock.mockReset();
    evaluateMock.mockReset();
    buildInlineBundleMock.mockReset();
    prefetchUseGraphMock.mockReset();
    discoverGeneratorsMock.mockReset();
    collectTablesFromBundleMock.mockReset();
    uuidCounter = 0;
    (globalThis as { crypto: Crypto }).crypto = {
        ...(globalThis.crypto ?? {}),
        randomUUID: jest.fn(() => `uuid-${++uuidCounter}`),
    } as Crypto;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
});

describe("version", () => {
    test("exposes API_VERSION constant 0.1.0", () => {
        const api = makeApi(makePlugin());
        expect(api.version).toBe("0.1.0");
    });

    test("matches semver pattern", () => {
        const api = makeApi(makePlugin());
        expect(api.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
});

describe("roll", () => {
    test("returns populated RollResult on success with all fields set", async () => {
        const harness = makePlugin({ activeFilePath: "Notes/session.md" });
        const api = makeApi(harness);
        evaluateMock.mockResolvedValue("2 goblins");

        const result = await api.roll("Encounters");

        expect(result).toEqual({
            result: "2 goblins",
            table: "Encounters",
            expression: "[@Encounters]",
            source: "Notes/session.md",
            timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
            rollId: "uuid-1",
        });
    });

    test("wraps tableName as [@tableName] expression", async () => {
        const harness = makePlugin({ activeFilePath: "Notes/session.md" });
        const api = makeApi(harness);
        evaluateMock.mockResolvedValue("gold");

        await api.roll("Loot");

        expect(evaluateMock).toHaveBeenCalledWith("[@Loot]", "Notes/session.md", harness.plugin);
    });

    test("uses callerNotePath when provided", async () => {
        const harness = makePlugin({ activeFilePath: "Notes/active.md" });
        const api = makeApi(harness);
        evaluateMock.mockResolvedValue("result");

        await api.roll("Encounters", { callerNotePath: "Notes/override.md" });

        expect(evaluateMock).toHaveBeenCalledWith("[@Encounters]", "Notes/override.md", harness.plugin);
    });

    test("falls back to active file path when callerNotePath omitted", async () => {
        const harness = makePlugin({ activeFilePath: "Notes/active.md" });
        const api = makeApi(harness);
        evaluateMock.mockResolvedValue("result");

        await api.roll("Encounters");

        expect(evaluateMock).toHaveBeenCalledWith("[@Encounters]", "Notes/active.md", harness.plugin);
    });

    test("rejects when evaluator throws", async () => {
        const api = makeApi(makePlugin({ activeFilePath: "Notes/session.md" }));
        evaluateMock.mockRejectedValue(new Error("boom"));

        await expect(api.roll("Encounters")).rejects.toThrow("boom");
    });

    test("emits a failure result to listeners when evaluator throws", async () => {
        const api = makeApi(makePlugin({ activeFilePath: "Notes/session.md" }));
        const listener = jest.fn();
        api.onRoll(listener);
        evaluateMock.mockRejectedValue(new Error("boom"));

        await expect(api.roll("Encounters")).rejects.toThrow("boom");

        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            result: "[ROLL ERROR: boom]",
            table: "Encounters",
            expression: "[@Encounters]",
            source: "Notes/session.md",
            error: "boom",
            rollId: "uuid-1",
        }));
    });

    test("produces a unique rollId across calls", async () => {
        const api = makeApi(makePlugin({ activeFilePath: "Notes/session.md" }));
        evaluateMock.mockResolvedValue("result");

        const first = await api.roll("Encounters");
        const second = await api.roll("Encounters");

        expect([first.rollId, second.rollId]).toEqual(["uuid-1", "uuid-2"]);
    });

    test("produces a parseable ISO 8601 timestamp", async () => {
        const api = makeApi(makePlugin({ activeFilePath: "Notes/session.md" }));
        evaluateMock.mockResolvedValue("result");

        const result = await api.roll("Encounters");

        expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
});

describe("rollExpression", () => {
    test("passes the raw expression through to evaluator verbatim", async () => {
        const harness = makePlugin({ activeFilePath: "Notes/session.md" });
        const api = makeApi(harness);
        evaluateMock.mockResolvedValue("direct");

        await api.rollExpression("2d6+1");

        expect(evaluateMock).toHaveBeenCalledWith("2d6+1", "Notes/session.md", harness.plugin);
    });

    test("sets both table and expression to the raw expression on success", async () => {
        const api = makeApi(makePlugin({ activeFilePath: "Notes/session.md" }));
        evaluateMock.mockResolvedValue("7");

        const result = await api.rollExpression("2d6+1");

        expect(result).toEqual(expect.objectContaining({
            table: "2d6+1",
            expression: "2d6+1",
        }));
    });

    test("rejects and emits failure when evaluator throws", async () => {
        const api = makeApi(makePlugin({ activeFilePath: "Notes/session.md" }));
        const listener = jest.fn();
        api.onRoll(listener);
        evaluateMock.mockRejectedValue(new Error("bad expression"));

        await expect(api.rollExpression("2d6+1")).rejects.toThrow("bad expression");

        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            result: "[ROLL ERROR: bad expression]",
            table: "2d6+1",
            expression: "2d6+1",
            error: "bad expression",
        }));
    });
});

describe("tables", () => {
    test("returns deduped sorted table names across .ipt files", async () => {
        const api = makeApi(makePlugin({
            files: {
                "Tables/a.ipt": "source-a",
                "Tables/b.ipt": "source-b",
            },
        }));
        parseGeneratorFileMock.mockImplementation((source: string) => {
            if (source === "source-a") return { tables: [{ name: "Zed" }, { name: "Alpha" }] } as ReturnType<typeof parseGeneratorFile>;
            return { tables: [{ name: "Alpha" }, { name: "Beta" }] } as ReturnType<typeof parseGeneratorFile>;
        });

        const result = await api.tables();

        expect(result).toEqual(["Alpha", "Beta", "Zed"]);
    });

    test("filters out non-.ipt files", async () => {
        const harness = makePlugin({
            files: {
                "Tables/a.ipt": "source-a",
                "Notes/readme.md": "ignored",
            },
        });
        const api = makeApi(harness);
        parseGeneratorFileMock.mockReturnValue({
            tables: [{ name: "Alpha" }],
        } as ReturnType<typeof parseGeneratorFile>);

        await api.tables();

        expect(parseGeneratorFileMock).toHaveBeenCalledTimes(1);
    });

    test("skips files whose read throws and logs a warning", async () => {
        const harness = makePlugin({
            files: {
                "Tables/good.ipt": "good-source",
                "Tables/bad.ipt": "bad-source",
            },
        });
        const api = makeApi(harness);
        harness.read.mockImplementation(async (file: TFile) => {
            if (file.path === "Tables/bad.ipt") throw new Error("disk failure");
            return "good-source";
        });
        parseGeneratorFileMock.mockReturnValue({
            tables: [{ name: "Alpha" }],
        } as ReturnType<typeof parseGeneratorFile>);

        const result = await api.tables();

        expect({
            result,
            warning: warnSpy.mock.calls[0]?.[0],
        }).toEqual({
            result: ["Alpha"],
            warning: 'randomness: skipping unreadable/unparseable .ipt "Tables/bad.ipt"',
        });
    });
});

describe("tablesWithSources", () => {
    test("returns in-scope tables first, out-of-scope tables after", async () => {
        const api = makeApi(makePlugin({
            files: { "Notes/session.md": "note-source" },
            activeFilePath: "Notes/session.md",
        }));
        setUpInScopeMocks([{ name: "Scoped", source: "Scoped Source", isMain: true, filePath: "Tables/scoped.ipt" }]);
        discoverGeneratorsMock.mockResolvedValue([
            { ok: true, gen: { title: "Out Source", path: "Tables/out.ipt", tables: [{ name: "Outside" }] } },
        ] as Awaited<ReturnType<typeof discoverGenerators>>);

        const result = await api.tablesWithSources();

        expect(result.map((entry) => entry.name)).toEqual(["Scoped", "Outside"]);
    });

    test("marks in-scope items with inScope:true and out-of-scope items with inScope:false", async () => {
        const api = makeApi(makePlugin({
            files: { "Notes/session.md": "note-source" },
            activeFilePath: "Notes/session.md",
        }));
        setUpInScopeMocks([{ name: "Scoped", source: "Scoped Source", isMain: true, filePath: "Tables/scoped.ipt" }]);
        discoverGeneratorsMock.mockResolvedValue([
            { ok: true, gen: { title: "Out Source", path: "Tables/out.ipt", tables: [{ name: "Outside" }] } },
        ] as Awaited<ReturnType<typeof discoverGenerators>>);

        const result = await api.tablesWithSources();

        expect(result).toEqual([
            { name: "Scoped", source: "Scoped Source", isMain: true, inScope: true, filePath: "Tables/scoped.ipt" },
            { name: "Outside", source: "Out Source", isMain: true, inScope: false, filePath: "Tables/out.ipt" },
        ]);
    });

    test("dedupes out-of-scope tables that share a name with an in-scope table (case-insensitive)", async () => {
        const api = makeApi(makePlugin({
            files: { "Notes/session.md": "note-source" },
            activeFilePath: "Notes/session.md",
        }));
        setUpInScopeMocks([{ name: "Encounters", source: "Scoped Source", isMain: true, filePath: "Tables/scoped.ipt" }]);
        discoverGeneratorsMock.mockResolvedValue([
            {
                ok: true,
                gen: {
                    title: "Vault Source",
                    path: "Tables/out.ipt",
                    tables: [{ name: "encounters" }, { name: "Treasure" }],
                },
            },
        ] as Awaited<ReturnType<typeof discoverGenerators>>);

        const result = await api.tablesWithSources();

        expect(result.map((entry) => entry.name)).toEqual(["Encounters", "Treasure"]);
    });

    test("dedupes duplicate names across out-of-scope .ipt files (first wins, case-insensitive)", async () => {
        const api = makeApi(makePlugin());
        discoverGeneratorsMock.mockResolvedValue([
            { ok: true, gen: { title: "First", path: "Tables/first.ipt", tables: [{ name: "Loot" }, { name: "Weather" }] } },
            { ok: true, gen: { title: "Second", path: "Tables/second.ipt", tables: [{ name: "loot" }, { name: "Travel" }] } },
        ] as Awaited<ReturnType<typeof discoverGenerators>>);

        const result = await api.tablesWithSources();

        expect(result).toEqual([
            { name: "Loot", source: "First", isMain: true, inScope: false, filePath: "Tables/first.ipt" },
            { name: "Weather", source: "First", isMain: false, inScope: false, filePath: "Tables/first.ipt" },
            { name: "Travel", source: "Second", isMain: false, inScope: false, filePath: "Tables/second.ipt" },
        ]);
    });

    test("returns only out-of-scope items when no caller note is available", async () => {
        const api = makeApi(makePlugin({ activeFilePath: null }));
        discoverGeneratorsMock.mockResolvedValue([
            { ok: true, gen: { title: "Vault Source", path: "Tables/out.ipt", tables: [{ name: "Outside" }] } },
        ] as Awaited<ReturnType<typeof discoverGenerators>>);

        const result = await api.tablesWithSources();

        expect(result).toEqual([
            { name: "Outside", source: "Vault Source", isMain: true, inScope: false, filePath: "Tables/out.ipt" },
        ]);
    });

    test("falls back to out-of-scope only when in-scope build throws", async () => {
        const api = makeApi(makePlugin({
            files: { "Notes/session.md": "note-source" },
            activeFilePath: "Notes/session.md",
        }));
        prefetchUseGraphMock.mockRejectedValue(new Error("prefetch failed"));
        discoverGeneratorsMock.mockResolvedValue([
            { ok: true, gen: { title: "Vault Source", path: "Tables/out.ipt", tables: [{ name: "Outside" }] } },
        ] as Awaited<ReturnType<typeof discoverGenerators>>);

        const result = await api.tablesWithSources();

        expect({
            result,
            warning: warnSpy.mock.calls[0]?.[0],
        }).toEqual({
            result: [{ name: "Outside", source: "Vault Source", isMain: true, inScope: false, filePath: "Tables/out.ipt" }],
            warning: "randomness: tablesWithSources in-scope build failed",
        });
    });

    test("returns only in-scope when discoverGenerators throws and logs warning", async () => {
        const api = makeApi(makePlugin({
            files: { "Notes/session.md": "note-source" },
            activeFilePath: "Notes/session.md",
        }));
        setUpInScopeMocks([{ name: "Scoped", source: "Scoped Source", isMain: true, filePath: "Tables/scoped.ipt" }]);
        discoverGeneratorsMock.mockRejectedValue(new Error("scan failed"));

        const result = await api.tablesWithSources();

        expect({
            result,
            warning: warnSpy.mock.calls[0]?.[0],
        }).toEqual({
            result: [{ name: "Scoped", source: "Scoped Source", isMain: true, inScope: true, filePath: "Tables/scoped.ipt" }],
            warning: "randomness: tablesWithSources vault scan failed",
        });
    });
});

describe("onRoll", () => {
    test("fires registered listener on successful roll", async () => {
        const api = makeApi(makePlugin({ activeFilePath: "Notes/session.md" }));
        const listener = jest.fn();
        api.onRoll(listener);
        evaluateMock.mockResolvedValue("2 goblins");

        await api.roll("Encounters");

        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            table: "Encounters",
            result: "2 goblins",
        }));
    });

    test("fires registered listener on failed roll", async () => {
        const api = makeApi(makePlugin({ activeFilePath: "Notes/session.md" }));
        const listener = jest.fn();
        api.onRoll(listener);
        evaluateMock.mockRejectedValue(new Error("boom"));

        await expect(api.roll("Encounters")).rejects.toThrow("boom");

        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            result: "[ROLL ERROR: boom]",
            error: "boom",
        }));
    });

    test("returned unsubscribe stops further deliveries to that listener", async () => {
        const api = makeApi(makePlugin({ activeFilePath: "Notes/session.md" }));
        const listener = jest.fn();
        const unsubscribe = api.onRoll(listener);
        evaluateMock.mockResolvedValue("2 goblins");

        await api.roll("Encounters");
        unsubscribe();
        await api.roll("Encounters");

        expect(listener).toHaveBeenCalledTimes(1);
    });

    test("delivers events to multiple listeners", async () => {
        const api = makeApi(makePlugin({ activeFilePath: "Notes/session.md" }));
        const first = jest.fn();
        const second = jest.fn();
        api.onRoll(first);
        api.onRoll(second);
        evaluateMock.mockResolvedValue("2 goblins");

        await api.roll("Encounters");

        expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 1]);
    });

    test("unsubscribing one listener does not affect others", async () => {
        const api = makeApi(makePlugin({ activeFilePath: "Notes/session.md" }));
        const first = jest.fn();
        const second = jest.fn();
        const unsubscribe = api.onRoll(first);
        api.onRoll(second);
        unsubscribe();
        evaluateMock.mockResolvedValue("2 goblins");

        await api.roll("Encounters");

        expect([first.mock.calls.length, second.mock.calls.length]).toEqual([0, 1]);
    });

    test("swallows and logs a listener that throws", async () => {
        const api = makeApi(makePlugin({ activeFilePath: "Notes/session.md" }));
        const failingListener = jest.fn(() => {
            throw new Error("listener failed");
        });
        const healthyListener = jest.fn();
        api.onRoll(failingListener);
        api.onRoll(healthyListener);
        evaluateMock.mockResolvedValue("2 goblins");

        await api.roll("Encounters");

        expect({
            delivered: healthyListener.mock.calls.length,
            logged: errorSpy.mock.calls[0]?.[0],
        }).toEqual({
            delivered: 1,
            logged: "randomness: roll listener threw",
        });
    });
});
