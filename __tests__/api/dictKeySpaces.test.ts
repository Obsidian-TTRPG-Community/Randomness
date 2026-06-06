/** @jest-environment jsdom */
/**
 * Dictionary keys that contain spaces, hyphens, or other punctuation.
 *
 * 1.0.11 added the `dictKey` API option but built `[#<key> <Table>]`
 * expressions internally — that form whitespace-splits, so a key like
 * "Knight Bachelor" became `[#Knight Bachelor Table]` and the
 * tokeniser took only "Knight" as the key, then tried to resolve
 * "Bachelor Table" as the table name.
 *
 * 1.0.12 fixes this two ways:
 *   - `runByKey(tableName, key)` on the Evaluator looks up dict
 *     entries directly, no expression parsing, key passed verbatim.
 *     `api.rollUnscoped` uses this path for `dictKey`.
 *   - In IPP3 source, `[#"key with spaces" Table]` quotes the key so
 *     authors can write multi-word dict keys directly. `api.roll`
 *     (scoped) builds this quoted form internally for `dictKey`.
 *
 * Reported by claudermilk while building an NPC generator where
 * occupations like "Knight Bachelor" needed to drive dictionary
 * lookups. They had to work around by mapping to safe internal keys
 * and keeping a side table for display names — exactly the kind of
 * extra-table-for-display friction we want to eliminate.
 */
import { createApi } from "../../src/api";
import { VaultIndex } from "../../src/resolver/vaultIndex";
import { Evaluator } from "../../src/engine/evaluator";
import {
    inMemorySource,
    resolveBundle,
} from "../../src/resolver/fileResolver";

const NPCS = `Table: Occupation
Type: Dictionary
Knight Bachelor: a sworn knight in service to a lord
Master-Adept: an established mage of some renown
Squire: a knight's apprentice
key with "quotes": this entry has embedded quotes in its key
`;

function makePlugin(files: Record<string, string>) {
    const m = new Map(Object.entries(files));
    const readPath = async (p: string) => {
        const v = m.get(p);
        if (v === undefined) throw new Error("nf " + p);
        return v;
    };
    const vault = {
        read: async (f: { path: string }) => readPath(f.path),
        cachedRead: async (f: { path: string }) => readPath(f.path),
        getFiles: () => [...m.keys()].map((p) => ({ path: p })),
        getAbstractFileByPath: (p: string) =>
            m.has(p) ? ({ path: p } as { path: string }) : null,
        adapter: {
            read: readPath,
            exists: async (p: string) => m.has(p),
        },
        on: () => ({}),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin: any = {
        app: {
            vault,
            workspace: { getActiveFile: () => null },
            metadataCache: {},
        },
        settings: {
            generatorRoot: "",
            defaultFormatting: "html",
            stableCodeblockSeeds: false,
            browserExpandedPaths: [],
            pinnedTables: [],
        },
    };
    plugin.vaultIndex = new VaultIndex(
        {
            getFiles: () => vault.getFiles(),
            read: readPath,
        },
        () => plugin.settings.generatorRoot || ""
    );
    return plugin;
}

describe("api.rollUnscoped dictKey: keys with spaces / hyphens / punctuation", () => {
    test('"Knight Bachelor" resolves (the original reported case)', async () => {
        const api = createApi(
            makePlugin({ "npcs.ipt": NPCS }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        const r = await api.rollUnscoped("Occupation", {
            dictKey: "Knight Bachelor",
        });
        expect(r.result).toBe("a sworn knight in service to a lord");
        expect(r.error).toBeUndefined();
    });

    test("hyphenated key resolves", async () => {
        const api = createApi(
            makePlugin({ "npcs.ipt": NPCS }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        const r = await api.rollUnscoped("Occupation", {
            dictKey: "Master-Adept",
        });
        expect(r.result).toBe("an established mage of some renown");
    });

    test("plain (single-word) key still resolves", async () => {
        const api = createApi(
            makePlugin({ "npcs.ipt": NPCS }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        const r = await api.rollUnscoped("Occupation", {
            dictKey: "Squire",
        });
        expect(r.result).toBe("a knight's apprentice");
    });

    test("key with embedded double-quotes resolves", async () => {
        const api = createApi(
            makePlugin({ "npcs.ipt": NPCS }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        const r = await api.rollUnscoped("Occupation", {
            dictKey: 'key with "quotes"',
        });
        expect(r.result).toBe(
            "this entry has embedded quotes in its key"
        );
    });

    test("unknown key returns empty (no throw)", async () => {
        const api = createApi(
            makePlugin({ "npcs.ipt": NPCS }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        const r = await api.rollUnscoped("Occupation", {
            dictKey: "Unknown Title",
        });
        expect(r.result).toBe("");
    });

    test("recorded expression uses the IPP3 quoted form", async () => {
        const api = createApi(
            makePlugin({ "npcs.ipt": NPCS }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        const r = await api.rollUnscoped("Occupation", {
            dictKey: "Knight Bachelor",
        });
        expect(r.expression).toBe(`[#"Knight Bachelor" Occupation]`);
    });

    test("calling dictKey on a non-dictionary table throws helpfully", async () => {
        const src = `Table: Weighted
foo
bar
`;
        const api = createApi(
            makePlugin({ "w.ipt": src }) as unknown as Parameters<
                typeof createApi
            >[0]
        );
        await expect(
            api.rollUnscoped("Weighted", { dictKey: "anything" })
        ).rejects.toThrow(/not a dictionary/);
    });
});

describe('IPP3 [#"quoted key" Table] syntax in raw source', () => {
    function evalIPP3(src: string, callerTable: string): string {
        const f = { "t.ipt": src };
        const b = resolveBundle("t.ipt", f["t.ipt"], {
            source: inMemorySource(f),
            callerDir: "",
        });
        return new Evaluator(b.main, b.extras, {}).runByName(callerTable);
    }

    test('[#"Knight Bachelor" T] resolves a spaced key', () => {
        const src = `Table: T
Type: Dictionary
Knight Bachelor: A KNIGHT

Table: __c
[#"Knight Bachelor" T]
`;
        expect(evalIPP3(src, "__c")).toBe("A KNIGHT");
    });

    test("unquoted bareword keys still work (back-compat)", () => {
        const src = `Table: T
Type: Dictionary
Plain: VALUE

Table: __c
[#Plain T]
`;
        expect(evalIPP3(src, "__c")).toBe("VALUE");
    });

    test("unquoted hyphenated keys still work (back-compat)", () => {
        const src = `Table: T
Type: Dictionary
Master-Adept: HIGH

Table: __c
[#Master-Adept T]
`;
        expect(evalIPP3(src, "__c")).toBe("HIGH");
    });

    test('quoted key with escaped embedded quote: [#"a \\"b\\" c" T]', () => {
        const src = `Table: T
Type: Dictionary
a "b" c: matched

Table: __c
[#"a \\"b\\" c" T]
`;
        expect(evalIPP3(src, "__c")).toBe("matched");
    });

    test("[#{$var} T] with variable still works (no quote)", () => {
        const src = `Table: T
Type: Dictionary
chosen: WORKS

Table: __c
{!k=='chosen'}[#{$k} T]
`;
        expect(evalIPP3(src, "__c")).toBe("WORKS");
    });
});
