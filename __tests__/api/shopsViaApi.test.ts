/** @jest-environment jsdom */
/**
 * Verifies the user's actual Templater workflow: rollUnscoped("TF-Shop")
 * against the demo/shops/*.ipt files, with no note scope. This is the
 * call their fantasy-hub template will make.
 */
import * as fs from "fs";
import * as path from "path";
import { createApi } from "../../src/api";

const SHOPS = path.resolve(__dirname, "../../demo/shops");

function makePlugin() {
    const map = new Map<string, string>();
    for (const f of fs.readdirSync(SHOPS)) {
        if (f.endsWith(".ipt")) {
            map.set(f, fs.readFileSync(path.join(SHOPS, f), "utf8"));
        }
    }
    const readPath = async (p: string): Promise<string> => {
        const v = map.get(p);
        if (v === undefined) throw new Error(`not found: ${p}`);
        return v;
    };
    return {
        app: {
            vault: {
                read: async (file: { path: string }) => readPath(file.path),
                getFiles: () => Array.from(map.keys()).map((p) => ({ path: p })),
                adapter: { read: readPath, exists: async (p: string) => map.has(p) },
            },
            workspace: { getActiveFile: () => null },
            metadataCache: {},
        },
        settings: { generatorRoot: "", defaultFormatting: "html", stableCodeblockSeeds: false, browserExpandedPaths: [], pinnedTables: [] },
    };
}

test("rollUnscoped('Shop') produces a full shop with no note scope", async () => {
    const api = createApi(makePlugin() as any);
    const r = await api.rollUnscoped("TF-Shop");
    expect(r.result).toContain("Proprietor:");
    expect(r.result).toMatch(/general goods|weapons|armor|alchemy|magic/);
    expect(r.source).toBe("shop.ipt");
});

test("rollUnscoped can target a specific shop type", async () => {
    const api = createApi(makePlugin() as any);
    const r = await api.rollUnscoped("TF-WeaponShop");
    expect(r.result).toContain("(weapons");
    expect(r.result).toContain("Proprietor:");
});

test("rollUnscoped('Person') works standalone (reusable file)", async () => {
    const api = createApi(makePlugin() as any);
    const r = await api.rollUnscoped("Person");
    expect(r.result).toContain(",");
    expect(r.result.length).toBeGreaterThan(5);
});

describe("town + name wiring (Town Forge integration)", () => {
    const TOWN = "Lythwen";
    const NAME = "The Whistling Herbalist";
    const pv = { town: TOWN, shopType: "shop", shopName: NAME };

    test("a passed shopName and town appear in a direct shop roll", async () => {
        const api = createApi(makePlugin() as any);
        const r = await api.rollUnscoped("TF-GeneralShop", { promptValues: pv });
        expect(r.result).toContain(TOWN);
        expect(r.result).toContain(NAME);
    });

    test("all five shop types weave in the town", async () => {
        const api = createApi(makePlugin() as any);
        for (const t of [
            "TF-GeneralShop",
            "TF-WeaponShop",
            "TF-ArmorShop",
            "TF-AlchemyShop",
            "TF-MagicShop",
        ]) {
            const r = await api.rollUnscoped(t, {
                promptValues: { town: TOWN, shopType: "shop", shopName: "" },
            });
            expect(r.result).toContain(TOWN);
        }
    });

    test("an empty shopName rolls a name but still uses the town", async () => {
        const api = createApi(makePlugin() as any);
        const r = await api.rollUnscoped("TF-GeneralShop", {
            promptValues: { town: TOWN, shopType: "shop", shopName: "" },
        });
        expect(r.result).toContain(TOWN);
        // A rolled name means the title isn't empty before the type label.
        expect(r.result).toMatch(/^\*\*.+\*\* \*\(general goods in /);
    });

    test("the picker propagates town + name to the chosen type", async () => {
        const api = createApi(makePlugin() as any);
        for (let i = 0; i < 8; i++) {
            const r = await api.rollUnscoped("TF-Shop", {
                promptValues: pv,
            });
            expect(r.result).toContain(TOWN);
            expect(r.result).toContain(NAME);
        }
    });
});
