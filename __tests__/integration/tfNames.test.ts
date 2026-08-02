/** @jest-environment node */
import * as fs from "fs";
import * as path from "path";
import { Evaluator } from "../../src/engine/evaluator";
import { inMemorySource, resolveBundle } from "../../src/resolver/fileResolver";

const GEN = path.resolve(__dirname, "../../community-generators/fantasy-hub/generators");

function loadAll(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fs.readdirSync(GEN)) {
        if (f.endsWith(".rdm")) out[f] = fs.readFileSync(path.join(GEN, f), "utf8");
    }
    return out;
}

function rollKey(table: string, key: string, seed: number): string {
    const files = loadAll();
    const bundle = resolveBundle("names.rdm", files["names.rdm"], {
        source: inMemorySource(files),
        callerDir: "",
    });
    return new Evaluator(bundle.main, bundle.extras, { seed }).runByKey(table, key);
}

const KEYS = [
    "human_male", "human_female", "elf_male", "elf_female",
    "halfelf_male", "halfelf_female", "halforc_male", "halforc_female",
    "gnome_male", "gnome_female", "goblin_male", "goblin_female",
];

describe("names.rdm", () => {
    test.each(KEYS)("%s yields well-formed distinct names", (key) => {
        const seen = new Set<string>();
        for (let s = 1; s <= 300; s++) {
            const n = rollKey("TF-PersonName", key, s).trim();
            expect(n).toMatch(/^[A-Za-z'-]+ [A-Za-z'-]+$/);
            seen.add(n);
        }
        // 300 draws from a five-figure pool should almost all be distinct
        expect(seen.size).toBeGreaterThan(280);
    });

    test("first names and surnames roll on their own", () => {
        expect(rollKey("TF-FirstName", "gnome_female", 7).trim()).toMatch(/^[A-Za-z]+$/);
        expect(rollKey("TF-Surname", "goblin", 7).trim()).toMatch(/^[A-Za-z]+$/);
    });

    test("same seed is reproducible", () => {
        expect(rollKey("TF-PersonName", "elf_male", 42)).toBe(rollKey("TF-PersonName", "elf_male", 42));
    });
});
