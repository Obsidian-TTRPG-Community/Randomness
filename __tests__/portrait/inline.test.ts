import {
    parseInlinePortrait,
    lockedInlineText,
    unlockedInlineText,
    INLINE_DEFAULT_SIZE,
} from "../../src/portrait/inline";
import {
    portraitBlockSnippet,
    portraitInlineSnippet,
} from "../../src/portrait/ui";

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

describe("portrait inline: lock/unlock text rewrites", () => {
    const json = '{"v":1,"seed":"x","parts":{"base":1}}';

    test("lock keeps non-default pack/size, drops seed", () => {
        const t = lockedInlineText(
            "portrait: bob size=96 pack=art/x", "default_pack", json
        );
        expect(t).toBe(`portrait: pack=art/x size=96 recipe=${json}`);
        expect(t).not.toContain("bob");
    });

    test("lock of a bare span is minimal", () => {
        expect(lockedInlineText("portrait:", "d", json)).toBe(
            `portrait: recipe=${json}`
        );
    });

    test("default-valued pack/size are not carried", () => {
        const t = lockedInlineText(
            `portrait: size=${INLINE_DEFAULT_SIZE} pack=d`, "d", json
        );
        expect(t).toBe(`portrait: recipe=${json}`);
    });

    test("unlock drops recipe and seed, keeps pack/size", () => {
        const locked = `portrait: size=96 recipe=${json}`;
        expect(unlockedInlineText(locked, "d")).toBe("portrait: size=96");
    });

    test("lock/unlock round-trip", () => {
        const locked = lockedInlineText("portrait: 200", "d", json);
        const unlocked = unlockedInlineText(locked, "d");
        expect(unlocked).toBe("portrait: size=200");
        const p = parseInlinePortrait(unlocked, "d");
        expect(p?.size).toBe(200);
        expect(p?.recipe).toBeUndefined();
    });
});

describe("portrait snippets", () => {
    const json = '{"v":1}';
    test("block snippet is a valid portrait codeblock", () => {
        expect(portraitBlockSnippet(json)).toBe(
            "```portrait\nrecipe: " + json + "\n```"
        );
    });
    test("inline snippet round-trips through the parser", () => {
        const t = portraitInlineSnippet(json);
        expect(t.startsWith("`portrait:")).toBe(true);
        const p = parseInlinePortrait(t.slice(1, -1), "d");
        expect(p?.recipe).toBe(json);
    });
});
