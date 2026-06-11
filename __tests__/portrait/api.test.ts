import { createPortraitApi, genderForSeed } from "../../src/portrait/api";
import { composePack } from "../../src/portrait/pack";
import type RandomnessPlugin from "../../src/views/main";

const PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const load = async () => PX;

const manifest = {
    pack: "api_test_pack",
    canvas: { width: 64, height: 64 },
    layerOrder: ["base", "eyes", "facial_hair"],
    assets: {
        base: [
            "base/base_human_01.png", "base/base_human_02.png",
            "base/base_elf_01.png", "base/base_elf_02.png",
        ],
        eyes: ["eyes_01.png", "eyes_02.png"],
        facial_hair: ["facial_hair_01.png"],
    },
    optional: { facial_hair: 0.6 },
    meta: { age: { young: 0.2, old: 0.2 } },
};

function fakePlugin(available = true): RandomnessPlugin {
    return {
        portraits: {
            available: async () => available,
            manifest: async () => manifest,
            loader: () => load,
        },
    } as unknown as RandomnessPlugin;
}

describe("portrait api: genderForSeed mirrors the engine", () => {
    test("matches composePack's gender for 30 seeds", async () => {
        for (let i = 0; i < 30; i++) {
            const seed = `mirror${i}`;
            const { recipe } = await composePack(manifest, load, seed);
            expect(genderForSeed(seed)).toBe(recipe.gender);
        }
    });
});

describe("portrait api: roll", () => {
    const api = createPortraitApi(fakePlugin());

    test("unconstrained roll returns a full result", async () => {
        const p = await api.roll();
        expect(p.recipe.v).toBe(1);
        expect(p.svg.startsWith("<svg")).toBe(true);
        expect(p.name).toMatch(/^\S+ \S+$/);
        expect(["male", "female"]).toContain(p.gender);
        expect(["human", "elf"]).toContain(p.race ?? "");
    });

    test("gender constraint holds (8 rolls)", async () => {
        for (let i = 0; i < 8; i++) {
            const p = await api.roll({ gender: "female" });
            expect(p.gender).toBe("female");
            expect(p.recipe.parts.facial_hair ?? -1).toBe(-1);
        }
    });

    test("race constraint holds (5 rolls)", async () => {
        for (let i = 0; i < 5; i++) {
            expect((await api.roll({ race: "elf" })).race).toBe("elf");
        }
    });

    test("combined constraints hold", async () => {
        const p = await api.roll({
            gender: "male", race: "human", age: "old",
        });
        expect(p.gender).toBe("male");
        expect(p.race).toBe("human");
        expect(p.age).toBe("old");
    });

    test("seeded roll is deterministic and ignores constraints", async () => {
        const a = await api.roll({ seed: "tmpl", gender: "female" });
        const b = await api.roll({ seed: "tmpl" });
        expect(b.recipe).toEqual(a.recipe);
        expect(b.name).toBe(a.name);
    });

    test("impossible race throws with the cap message", async () => {
        await expect(
            api.roll({ race: "dragonborn", maxTries: 10 })
        ).rejects.toThrow(/no portrait matched/);
    });

    test("throws when no pack installed", async () => {
        const gated = createPortraitApi(fakePlugin(false));
        await expect(gated.roll()).rejects.toThrow(/no portrait pack/);
    });
});

describe("portrait api: render + snippets", () => {
    const api = createPortraitApi(fakePlugin());

    test("render(recipe) reproduces the roll byte-identically", async () => {
        const p = await api.roll({ seed: "rt" });
        const r = await api.render(p.recipe);
        expect(r.svg).toBe(p.svg);
        expect(r.name).toBe(p.name);
    });

    test("name() is deterministic", async () => {
        const p = await api.roll({ seed: "nm" });
        expect(await api.name(p.recipe)).toBe(p.name);
    });

    test("snippets embed the recipe", async () => {
        const p = await api.roll({ seed: "sn" });
        const json = JSON.stringify(p.recipe);
        expect(api.blockSnippet(p.recipe)).toBe(
            "```portrait\nrecipe: " + json + "\n```"
        );
        expect(api.inlineSnippet(p.recipe, 140)).toBe(
            "`portrait: size=140 recipe=" + json + "`"
        );
    });
});
