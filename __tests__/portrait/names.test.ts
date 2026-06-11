import { nameFor, raceOf, NAME_RACES } from "../../src/portrait/names";
import { PortraitRecipe } from "../../src/portrait/pack";

const manifest = {
    layerOrder: ["base"],
    assets: {
        base: [
            "base/base_human_01.png",
            "base/base_elf_01.png",
            "base/base_goblin_01.png",
            "base/base_dragonborn_01.png", // race with no tables
            "base_plain_old_style.png",    // no race token
        ],
    },
};

function recipe(baseIdx: number, gender: "male" | "female", seed = "s1"): PortraitRecipe {
    return {
        v: 1, seed, parts: { base: baseIdx }, flip: {}, jitter: {},
        gender,
    } as unknown as PortraitRecipe;
}

describe("portrait names: raceOf", () => {
    test("extracts race token from base filename", () => {
        expect(raceOf(recipe(0, "male"), manifest)).toBe("human");
        expect(raceOf(recipe(1, "male"), manifest)).toBe("elf");
        expect(raceOf(recipe(2, "female"), manifest)).toBe("goblin");
    });

    test("null for raceless filenames or missing base", () => {
        expect(raceOf(recipe(4, "male"), manifest)).toBeNull();
        expect(raceOf(recipe(-1, "male"), manifest)).toBeNull();
    });
});

describe("portrait names: nameFor", () => {
    test("deterministic per seed", () => {
        const a = nameFor(recipe(1, "female", "abc"), manifest);
        const b = nameFor(recipe(1, "female", "abc"), manifest);
        expect(b).toBe(a);
        expect(a).toMatch(/^\S+ \S+$/); // "First Last"
    });

    test("different seeds vary (across 20 seeds)", () => {
        const names = new Set<string>();
        for (let i = 0; i < 20; i++) {
            names.add(nameFor(recipe(0, "male", `seed${i}`), manifest));
        }
        expect(names.size).toBeGreaterThan(5);
    });

    test("unknown race falls back to human tables without throwing", () => {
        const n = nameFor(recipe(3, "male", "x"), manifest);
        expect(n).toMatch(/^\S+ \S+$/);
    });

    test("gender changes the first-name table", () => {
        // Same seed, both genders, across several seeds: names differ
        // at least once (tables are disjoint).
        let differs = false;
        for (let i = 0; i < 5; i++) {
            const m = nameFor(recipe(0, "male", `g${i}`), manifest);
            const f = nameFor(recipe(0, "female", `g${i}`), manifest);
            if (m !== f) differs = true;
        }
        expect(differs).toBe(true);
    });

    test("every race with tables produces names", () => {
        for (const race of NAME_RACES) {
            const man = {
                assets: { base: [`base/base_${race}_01.png`] },
                layerOrder: ["base"],
            };
            const n = nameFor(recipe(0, "female", race), man);
            expect(n.length).toBeGreaterThan(2);
        }
    });
});
