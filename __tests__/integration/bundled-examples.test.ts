/** @jest-environment node */
/**
 * Regression test for bundled example generators.
 *
 * These files ship with the plugin and get written into the user's
 * vault by the "Add examples" button. If any of them stops producing
 * output (parser change, semantic change, etc.) the user gets a
 * broken first-run experience. This test fires on every CI run so
 * regressions are caught before release.
 */
import { EXAMPLE_FILES } from "../../src/examples";
import { Evaluator } from "../../src/engine/evaluator";
import { inMemorySource, resolveBundle } from "../../src/resolver/fileResolver";

// All examples are siblings in the Generator root, so they need to
// see each other's tables via cross-file `Use:` if any reference
// across files. (Currently none do — each file is self-contained.)
const FILES: Record<string, string> = {};
EXAMPLE_FILES.forEach((f) => {
    FILES[f.filename] = f.content;
});

describe("bundled example generators", () => {
    for (const f of EXAMPLE_FILES) {
        test(`${f.filename} parses and produces output`, () => {
            const b = resolveBundle(f.filename, f.content, {
                source: inMemorySource(FILES),
                callerDir: "",
            });
            // Run with several seeds; any one producing non-empty
            // output is enough — random selection means a specific
            // seed might pick a very short item.
            const outputs: string[] = [];
            for (let seed = 1; seed <= 5; seed++) {
                const ev = new Evaluator(b.main, b.extras, { seed });
                outputs.push(ev.run());
            }
            const allEmpty = outputs.every((o) => o.length === 0);
            expect(allEmpty).toBe(false);
        });
    }

    test("example READMEs and content are consistent", () => {
        // Sanity: every example has a filename, content, description,
        // and the content isn't accidentally empty (could happen if
        // a build step mangled the bundle).
        for (const f of EXAMPLE_FILES) {
            expect(f.filename).toMatch(/\.ipt$/);
            expect(f.content.length).toBeGreaterThan(100);
            expect(f.description.length).toBeGreaterThan(0);
        }
    });
});
