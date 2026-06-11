/** Portrait engine tests — ported from the npc-forge verification harness.
 *  The engine is pure: no Obsidian imports, no canvas in Node (recolour no-ops). */
import {
    composePack, composeFromRecipe, resolveRecipe, normalizeManifest,
    ageFor, recolorSkinPixels, PortraitRecipe, RGB
} from "../../src/portrait/pack";

// 1x1 transparent png
const PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const load = async () => PX;

const manifest = {
    pack: "test_pack",
    canvas: { width: 1024, height: 1024 },
    layerOrder: ["ears", "hair_back", "base", "clothing", "noses", "facial_hair", "mouths", "eyes", "brows", "hair_front", "age_marks"],
    assets: {
        base: ["base_01.png", "base_02.png"],
        ears: ["ears_01.png", "ears_02.png"],
        hair_back: ["hair_back_01.png", "hair_back_02.png", "hair_back_03.png"],
        hair_front: ["hair_front_01.png", "hair_front_02.png", "hair_front_03.png"],
        clothing: ["clothing_01.png", "clothing_02.png"],
        noses: ["noses_01.png"],
        mouths: ["mouths_01.png", "mouths_02.png"],
        eyes: ["eyes_01.png", "eyes_02.png"],
        brows: ["brows_01.png"],
        facial_hair: ["facial_hair_01.png", "facial_hair_02.png"],
        age_marks: ["age_marks_01.png"]
    },
    coherenceGroups: [["base", "ears"]],
    optional: { facial_hair: 0.6, age_marks: 0.7 },
    meta: { age: { young: 0.2, old: 0.2 } }
};

describe("portrait: normalizeManifest", () => {
    test("aliases assets->layers and layerOrder->suggestedOrder", () => {
        const m = normalizeManifest(manifest);
        expect(m.layers.base).toEqual(["base_01.png", "base_02.png"]);
        expect(m.suggestedOrder?.[0]).toBe("ears");
        expect(m.viewBox).toBe("0 0 1024 1024");
    });
});

describe("portrait: determinism", () => {
    test("same seed -> identical recipe and svg (100 seeds)", async () => {
        for (let i = 0; i < 100; i++) {
            const seed = `det${i}`;
            const a = await composePack(manifest, load, seed);
            const b = await composePack(manifest, load, seed);
            expect(b.recipe).toEqual(a.recipe);
            expect(b.svg).toBe(a.svg);
        }
    });

    test("recipe parts are valid indices", async () => {
        const m = normalizeManifest(manifest);
        for (let i = 0; i < 50; i++) {
            const { recipe } = await composePack(manifest, load, `idx${i}`);
            for (const [cat, idx] of Object.entries(recipe.parts)) {
                expect(idx).toBeGreaterThanOrEqual(-1);
                expect(idx).toBeLessThan(m.layers[cat].length);
            }
        }
    });
});

describe("portrait: recipe round-trip", () => {
    test("composeFromRecipe re-renders byte-identical svg (100 seeds)", async () => {
        for (let i = 0; i < 100; i++) {
            const a = await composePack(manifest, load, `rt${i}`);
            const r = await composeFromRecipe(a.recipe, manifest, load);
            expect(r.svg).toBe(a.svg);
        }
    });

    test("recipe missing age defaults to adult", async () => {
        const a = await composePack(manifest, load, "legacy");
        const legacy = { ...a.recipe } as Partial<PortraitRecipe>;
        delete legacy.age;
        const r = await composeFromRecipe(legacy as PortraitRecipe, manifest, load);
        expect(r.svg.length).toBeGreaterThan(0);
    });
});

describe("portrait: resolveRecipe", () => {
    test("pure: same recipe -> same ops, ordered by layerOrder", async () => {
        const { recipe } = await composePack(manifest, load, "ops");
        const ops1 = resolveRecipe(recipe, manifest);
        const ops2 = resolveRecipe(recipe, manifest);
        expect(ops2).toEqual(ops1);
        const order = manifest.layerOrder;
        const idxs = ops1.map(o => order.indexOf(o.cat));
        expect([...idxs].sort((x, y) => x - y)).toEqual(idxs);
    });
});

describe("portrait: gender/age axes", () => {
    test("facial hair never on females or young; ages distributed (1000 seeds)", async () => {
        let male = 0, beardedFemale = 0, beardedYoung = 0;
        const ages = { young: 0, adult: 0, old: 0 };
        for (let i = 0; i < 1000; i++) {
            const { recipe } = await composePack(manifest, load, `axis${i}`);
            ages[recipe.age ?? "adult"]++;
            if (recipe.gender === "male") male++;
            const bearded = (recipe.parts.facial_hair ?? -1) >= 0;
            if (recipe.gender === "female" && bearded) beardedFemale++;
            if (recipe.age === "young" && bearded) beardedYoung++;
        }
        expect(beardedFemale).toBe(0);
        expect(beardedYoung).toBe(0);
        expect(male).toBeGreaterThan(400); expect(male).toBeLessThan(600);
        expect(ages.young).toBeGreaterThan(120); expect(ages.young).toBeLessThan(280);
        expect(ages.old).toBeGreaterThan(120); expect(ages.old).toBeLessThan(280);
    });

    test("ageFor respects explicit weights", () => {
        let old = 0;
        for (let i = 0; i < 1000; i++) if (ageFor(`w${i}`, { young: 0, old: 1 }) === "old") old++;
        expect(old).toBe(1000);
    });

    test("base/ears prefix coherence holds", async () => {
        for (let i = 0; i < 200; i++) {
            const { parts } = await composePack(manifest, load, `coh${i}`);
            const b = parts.base, e = parts.ears;
            if (b && e) expect(b.replace("base", "")).toBe(e.replace("ears", ""));
        }
    });
});

describe("portrait: recolorSkinPixels", () => {
    const tone: RGB = [101, 68, 49];
    test("recolours warm skin, preserves sclera white and ink", () => {
        // [skin fair, sclera white, ink black] as rgba
        const d = new Uint8ClampedArray([
            245, 205, 165, 255,   // warm fair skin -> recoloured
            255, 255, 255, 255,   // sclera white (R-B = 0 < 16) -> untouched
            10, 10, 10, 255       // ink (below lum floor) -> untouched
        ]);
        recolorSkinPixels(d, tone);
        expect([d[0], d[1], d[2]]).not.toEqual([245, 205, 165]);
        expect([d[4], d[5], d[6]]).toEqual([255, 255, 255]);
        expect([d[8], d[9], d[10]]).toEqual([10, 10, 10]);
    });

    test("transparent pixels untouched", () => {
        const d = new Uint8ClampedArray([245, 205, 165, 0]);
        recolorSkinPixels(d, tone);
        expect([d[0], d[1], d[2]]).toEqual([245, 205, 165]);
    });
});
