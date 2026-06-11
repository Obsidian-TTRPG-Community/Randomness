import {
    parseInlinePortrait,
    INLINE_DEFAULT_SIZE,
} from "../../src/portrait/inline";

describe("portrait inline: parseInlinePortrait", () => {
    test("non-portrait spans return null", () => {
        expect(parseInlinePortrait("rdm:[@Table]", "p")).toBeNull();
        expect(parseInlinePortrait("portraitx: y", "p")).toBeNull();
        expect(parseInlinePortrait("code", "p")).toBeNull();
    });

    test("bare call uses defaults", () => {
        expect(parseInlinePortrait("portrait:", "my_pack")).toEqual({
            pack: "my_pack",
            size: INLINE_DEFAULT_SIZE,
        });
    });

    test("bare word = seed, bare number = size", () => {
        const p = parseInlinePortrait("portrait: gandalf 160", "d");
        expect(p?.seed).toBe("gandalf");
        expect(p?.size).toBe(160);
    });

    test("key=value tokens, size clamped", () => {
        const p = parseInlinePortrait(
            "portrait: seed=bob, size=9999 pack=/art/x/",
            "d"
        );
        expect(p?.seed).toBe("bob");
        expect(p?.size).toBe(1024);
        expect(p?.pack).toBe("art/x");
    });

    test("recipe= consumes the rest, including spaces", () => {
        const json = '{"v":1,"seed":"a b","parts":{"base":0}}';
        const p = parseInlinePortrait(
            `portrait: size=96 recipe=${json}`,
            "d"
        );
        expect(p?.size).toBe(96);
        expect(p?.recipe).toBe(json);
        expect(JSON.parse(p?.recipe ?? "")).toHaveProperty("seed", "a b");
    });
});
