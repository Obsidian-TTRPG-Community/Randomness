/** @jest-environment jsdom */
/**
 * End-to-end proof: a generator that imports a helper by BARE
 * FILENAME (no path) resolves correctly via the vault index, even
 * when the helper lives in a different folder. This is the headline
 * "only the filename is required" capability.
 */
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
        getAbstractFileByPath: (p: string) =>
            m.has(p) ? ({ path: p } as any) : null,
        adapter: { read: readPath, exists: async (p: string) => m.has(p) },
        on: () => ({}),
    };
    const plugin: any = {
        app: { vault, workspace: { getActiveFile: () => null }, metadataCache: {} },
        settings: { generatorRoot: root, defaultFormatting: "html", stableCodeblockSeeds: false, browserExpandedPaths: [], pinnedTables: [] },
    };
    // Real index, reading through the mock vault.
    plugin.vaultIndex = new VaultIndex(
        { getFiles: () => vault.getFiles(), read: readPath },
        () => plugin.settings.generatorRoot || ""
    );
    return plugin;
}

test("bare-filename use: resolves a helper in another folder", async () => {
    const files = {
        // Main generator imports "Names.ipt" with NO path.
        "Generators/shops/shop.ipt":
            "use: Names.ipt\nTable: Sign\nThe [@Surname] Arms",
        // Helper lives in a completely different folder.
        "Generators/common/Names.ipt":
            "Table: Surname\nBlackwood\nThorne\nVale",
    };
    const api = createApi(makePlugin(files) as any);
    const r = await api.rollUnscoped("Sign");
    expect(r.result).toMatch(/^The (Blackwood|Thorne|Vale) Arms$/);
});

test("bare-filename use: still works with a generator root set", async () => {
    const files = {
        "IPP3/Generators/shops/shop.ipt":
            "use: Names.ipt\nTable: Sign\nThe [@Surname] Arms",
        "IPP3/Generators/common/Names.ipt":
            "Table: Surname\nBlackwood",
    };
    const api = createApi(makePlugin(files, "IPP3/Generators") as any);
    const r = await api.rollUnscoped("Sign");
    expect(r.result).toBe("The Blackwood Arms");
});
