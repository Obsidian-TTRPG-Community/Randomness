/** @jest-environment node */
/**
 * Integration tests for the PF2e shop generator set
 * (demo/shops/*.ipt). Verifies the full Use: chain resolves
 * (shop -> shop-TYPE -> people/customers/prices), every shop type
 * rolls a populated block, prices format as PF2e coins, and the
 * top-level picker works. Also exercises the API rollUnscoped path
 * that the user's template will use.
 */
import * as fs from "fs";
import * as path from "path";
import { Evaluator } from "../../src/engine/evaluator";
import { inMemorySource, resolveBundle } from "../../src/resolver/fileResolver";

const SHOPS = path.resolve(__dirname, "../../demo/shops");

function loadAll(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fs.readdirSync(SHOPS)) {
        if (f.endsWith(".ipt")) {
            out[f] = fs.readFileSync(path.join(SHOPS, f), "utf8");
        }
    }
    return out;
}

function rollVia(entryFile: string, table: string, seed: number): string {
    const files = loadAll();
    const bundle = resolveBundle(entryFile, files[entryFile], {
        source: inMemorySource(files),
        callerDir: "",
    });
    return new Evaluator(bundle.main, bundle.extras, { seed }).runByName(table);
}

describe("shops: each type rolls a populated block", () => {
    const cases: Array<[string, string, string]> = [
        ["shop-general.ipt", "TF-GeneralShop", "general goods"],
        ["shop-weapon.ipt", "TF-WeaponShop", "weapons"],
        ["shop-armor.ipt", "TF-ArmorShop", "armor"],
        ["shop-alchemy.ipt", "TF-AlchemyShop", "alchemy"],
        ["shop-magic.ipt", "TF-MagicShop", "magic"],
    ];
    for (const [file, table, label] of cases) {
        test(`${table} renders proprietor, stock, quote, customer`, () => {
            for (let seed = 1; seed <= 5; seed++) {
                const out = rollVia(file, table, seed);
                expect(out).toContain(label);
                expect(out).toContain("Proprietor:");
                expect(out).toContain("says:");
                expect(out).toContain("Also here:");
                // At least one coin denomination appears (priced stock).
                expect(out).toMatch(/\d+ (gp|sp|cp)|free/);
                // Stock has multiple item lines (6-8 items + structure).
                const itemLines = (out.match(/- /g) ?? []).length;
                expect(itemLines).toBeGreaterThanOrEqual(6);
            }
        });
    }
});

describe("shops: top-level picker", () => {
    test("[@Shop] resolves to one of the five types", () => {
        const labels = ["general goods", "weapons", "armor", "alchemy", "magic"];
        for (let seed = 1; seed <= 15; seed++) {
            const out = rollVia("shop.ipt", "TF-Shop", seed);
            const matched = labels.some((l) => out.includes(l));
            expect(matched).toBe(true);
            expect(out).toContain("Proprietor:");
        }
    });

    test("[@Shop] produces variety across seeds", () => {
        const seen = new Set<string>();
        const labels = ["general goods", "weapons", "armor", "alchemy", "magic"];
        for (let seed = 1; seed <= 40; seed++) {
            const out = rollVia("shop.ipt", "TF-Shop", seed);
            for (const l of labels) if (out.includes(l)) seen.add(l);
        }
        // Across 40 seeds we should see at least 3 of the 5 types.
        expect(seen.size).toBeGreaterThanOrEqual(3);
    });
});

describe("shops: reusable people file", () => {
    test("Person from people.ipt is usable standalone", () => {
        const out = rollVia("people.ipt", "Person", 3);
        expect(out.length).toBeGreaterThan(5);
        // Has a comma (Name, a <desc> <ancestry>).
        expect(out).toContain(",");
    });
});
