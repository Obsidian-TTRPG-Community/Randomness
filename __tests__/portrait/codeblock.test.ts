import { parsePortraitParams, lockedBlockBody, unlockedBlockBody } from "../../src/portrait/codeblock";
import { PortraitRecipe } from "../../src/portrait/pack";

describe("portrait codeblock: parsePortraitParams", () => {
    test("defaults from settings pack", () => {
        expect(parsePortraitParams("", "my_pack")).toEqual({
            pack: "my_pack", count: 1, size: 256,
        });
    });

    test("parses all keys, clamps bounds, ignores junk", () => {
        const src = [
            "pack: /art/pack/",
            "seed: bob",
            "count: 99",
            "size: 12",
            "not a param",
            "unknown: x",
        ].join("\n");
        const p = parsePortraitParams(src, "default");
        expect(p.pack).toBe("art/pack");
        expect(p.seed).toBe("bob");
        expect(p.count).toBe(24);  // clamped
        expect(p.size).toBe(64);   // clamped
        expect(p.recipe).toBeUndefined();
    });

    test("recipe passes through verbatim", () => {
        const r = '{"v":1,"seed":"x"}';
        expect(parsePortraitParams(`recipe: ${r}`, "d").recipe).toBe(r);
    });

    test("empty values ignored", () => {
        const p = parsePortraitParams("pack:\nseed:  ", "d");
        expect(p.pack).toBe("d");
        expect(p.seed).toBeUndefined();
    });
});

describe("portrait codeblock: lockedBlockBody", () => {
    const recipe = {
        v: 1, seed: "s", parts: { base: 0 }, flip: {}, jitter: {},
        skin: 2, gender: "male", age: "adult",
    } as unknown as PortraitRecipe;

    test("keeps pack/size, drops seed/count, appends recipe", () => {
        const body = lockedBlockBody(
            "pack: art/pack\nseed: bob\ncount: 6\nsize: 256",
            recipe
        );
        const lines = body.split("\n");
        expect(lines[0]).toBe("pack: art/pack");
        expect(lines[1]).toBe("size: 256");
        expect(lines[2].startsWith("recipe: {")).toBe(true);
        expect(JSON.parse(lines[2].slice("recipe: ".length))).toEqual(recipe);
        expect(body).not.toMatch(/^seed:/m);
        expect(body).not.toMatch(/^count:/m);
    });

    test("empty body -> just the recipe line", () => {
        const body = lockedBlockBody("", recipe);
        expect(body.split("\n")).toHaveLength(1);
        expect(body.startsWith("recipe: ")).toBe(true);
    });

    test("locked body round-trips through parsePortraitParams", () => {
        const body = lockedBlockBody("size: 512", recipe);
        const p = parsePortraitParams(body, "d");
        expect(p.size).toBe(512);
        expect(JSON.parse(p.recipe ?? "")).toEqual(recipe);
    });
});

describe("portrait codeblock: unlockedBlockBody", () => {
    test("drops recipe, keeps everything else", () => {
        const body = unlockedBlockBody(
            'pack: art/pack\nsize: 256\nrecipe: {"v":1}'
        );
        expect(body).toBe("pack: art/pack\nsize: 256");
    });

    test("lock then unlock round-trips pack/size", () => {
        const recipe = { v: 1, seed: "s", parts: {}, flip: {}, jitter: {} };
        const locked = lockedBlockBody(
            "pack: p\nseed: bob\nsize: 128",
            recipe as never
        );
        const unlocked = unlockedBlockBody(locked);
        expect(unlocked).toBe("pack: p\nsize: 128");
        // seed/count intentionally not restored — the roll is fresh.
    });

    test("recipe-only block unlocks to empty body", () => {
        expect(unlockedBlockBody('recipe: {"v":1}')).toBe("");
    });
});
