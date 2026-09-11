/** @jest-environment jsdom */
import { createApi } from "../../src/api";
import { VaultIndex } from "../../src/resolver/vaultIndex";

function makePlugin(files: Record<string, string>, root = "") {
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
        getAbstractFileByPath: (p: string) => (m.has(p) ? ({ path: p } as any) : null),
        adapter: { read: readPath, exists: async (p: string) => m.has(p) },
        on: () => ({}),
    };
    const plugin: any = {
        app: { vault, workspace: { getActiveFile: () => null }, metadataCache: {} },
        settings: { generatorRoot: root, defaultFormatting: "html", stableCodeblockSeeds: false, browserExpandedPaths: [], pinnedTables: [] },
    };
    plugin.vaultIndex = new VaultIndex(
        { getFiles: () => vault.getFiles(), read: readPath },
        () => plugin.settings.generatorRoot || ""
    );
    return plugin;
}

test("rollExpression handles a MULTI-LINE template body", async () => {
    const files = {
        "G/npc.ipt": "Table: Name\nBrenna\n\nTable: Job\nsmith\n",
    };
    const api = createApi(makePlugin(files) as any);
    const tpl = "# [@Name]\n\n- job: [@Job]\n- roll: {2d6}\n\n> a line";
    const r = await api.rollExpression(tpl);
    console.log(JSON.stringify(r.result));
    expect(r.result).toContain("# Brenna");
    expect(r.result.split("\n").length).toBeGreaterThan(3);
});
