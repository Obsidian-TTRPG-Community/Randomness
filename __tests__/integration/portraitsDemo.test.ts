/**
 * Smoke test for the v0.4.0 portrait demo. Verifies the bundled
 * `demo/portraits.ipt` parses, rolls deterministically against
 * known seeds, and emits the `![[…]]` wiki-syntax that the post-
 * processor will rewrite into `<img>` elements.
 *
 * If this test breaks, the demo bundled in the install zip will
 * also be broken — which is a worse failure mode than a unit test
 * regression because users won't see "shipped feature doesn't
 * work" until after install.
 */

import * as fs from "fs";
import * as path from "path";
import { parseGeneratorFile } from "../../src/engine/fileParser";
import { Evaluator } from "../../src/engine/evaluator";
import { inMemorySource, resolveBundle } from "../../src/resolver/fileResolver";

const DEMO_PATH = path.resolve(__dirname, "../../demo/portraits.ipt");

describe("demo: portraits.ipt", () => {
    const src = fs.readFileSync(DEMO_PATH, "utf8");

    test("parses with the expected tables", () => {
        const file = parseGeneratorFile(src);
        expect(file.title).toBe("Random Portrait");
        const tableNames = file.tables.map((t) => t.name);
        expect(tableNames).toContain("portrait");
        expect(tableNames).toContain("encounter");
        expect(tableNames).toContain("flavour");
    });

    test("portrait rolls produce a valid `![[…]]` embed", () => {
        const source = inMemorySource({ "portraits.ipt": src });
        // Try a handful of seeds — every roll must produce an
        // image embed referencing one of the bundled SVGs.
        const validImages = [
            "goblin-warrior.svg",
            "dwarf-cleric.svg",
            "elf-ranger.svg",
            "human-bard.svg",
            "halfling-rogue.svg",
            "tiefling-wizard.svg",
        ];
        for (let seed = 1; seed <= 20; seed++) {
            const bundle = resolveBundle("portraits.ipt", src, {
                source,
                callerDir: "",
            });
            const ev = new Evaluator(bundle.main, bundle.extras, { seed });
            const result = ev.runByName("portrait");
            // Must look like a wiki embed.
            expect(result).toMatch(/^!\[\[images\/.+\.svg\]\]$/);
            // Must reference a real bundled image.
            const matched = validImages.some((img) =>
                result.includes(img)
            );
            expect(matched).toBe(true);
        }
    });

    test("encounter rolls combine portrait + flavour", () => {
        const source = inMemorySource({ "portraits.ipt": src });
        const bundle = resolveBundle("portraits.ipt", src, {
            source,
            callerDir: "",
        });
        const ev = new Evaluator(bundle.main, bundle.extras, { seed: 7 });
        const result = ev.runByName("encounter");
        // Image embed somewhere in the output.
        expect(result).toMatch(/!\[\[images\/.+\.svg\]\]/);
        // Flavour text on a separate line (the `\n` in the
        // template). Some flavour line must be present.
        expect(result.split("\n").length).toBeGreaterThan(1);
    });

    test("all six bundled SVG files exist on disk", () => {
        // Defensive: if someone edits the demo and forgets to
        // ship a portrait, the install zip will be broken. This
        // test catches that.
        const imagesDir = path.resolve(__dirname, "../../demo/images");
        const expected = [
            "goblin-warrior.svg",
            "dwarf-cleric.svg",
            "elf-ranger.svg",
            "human-bard.svg",
            "halfling-rogue.svg",
            "tiefling-wizard.svg",
        ];
        for (const name of expected) {
            const p = path.join(imagesDir, name);
            expect(fs.existsSync(p)).toBe(true);
        }
    });

    test("inline scope: when a note has a randomness codeblock with Use:, an inline call resolves against it", async () => {
        // This mirrors the bug reported by the user — inline `rdm:`
        // calls don't accept their own Use: directive; they
        // inherit scope from the note's randomness codeblocks.
        // The demo note uses this pattern, so we verify it works
        // end-to-end with the real buildInlineBundle.
        const { buildInlineBundle } = await import(
            "../../src/resolver/scope"
        );
        const noteSource = [
            "# Demo",
            "",
            "```randomness",
            "Use: portraits.ipt",
            "[@portrait]",
            "```",
            "",
            "Inline: `rdm:[@portrait]`",
        ].join("\n");
        const source = inMemorySource({
            "portraits.ipt": src,
        });
        const bundle = buildInlineBundle("[@portrait]", {
            notePath: "demo.md",
            noteSource,
            source,
        });
        // The bundle should include portraits.ipt as an extra.
        const tableNames = bundle.extras
            .flatMap((f) => f.tables.map((t) => t.name));
        expect(tableNames).toContain("portrait");

        // And rolling the synthetic main resolves to a portrait
        // embed — proving the inline call's `[@portrait]` finds
        // the table.
        const ev = new Evaluator(bundle.main, bundle.extras, {
            seed: 1,
        });
        const result = ev.runByName("__inline");
        expect(result).toMatch(/!\[\[images\/.+\.svg\]\]/);
    });

    test("inline scope: WITHOUT a codeblock importing portraits.ipt, inline call fails", async () => {
        // Pin the bug shape: an inline-only note (no codeblock
        // with Use:) cannot resolve `[@portrait]`. The demo
        // previously assumed inline calls could carry their own
        // Use: directive — they can't.
        const { buildInlineBundle } = await import(
            "../../src/resolver/scope"
        );
        const noteSource =
            "# Demo with no codeblock\n\nInline: `rdm:[@portrait]`";
        const source = inMemorySource({
            "portraits.ipt": src,
        });
        const bundle = buildInlineBundle("[@portrait]", {
            notePath: "demo.md",
            noteSource,
            source,
        });
        // No tables imported because there's no codeblock saying
        // Use: portraits.ipt.
        const tableNames = bundle.extras
            .flatMap((f) => f.tables.map((t) => t.name));
        expect(tableNames).not.toContain("portrait");
        // Rolling the synthetic main throws because the table
        // doesn't exist in scope.
        const ev = new Evaluator(bundle.main, bundle.extras, {
            seed: 1,
        });
        expect(() => ev.runByName("__inline")).toThrow(
            /portrait/i
        );
    });
});
