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

// All examples are siblings in the examples sub-folder, so they can
// see each other's tables via cross-file `Use:` (the "Way 3" note
// pulls in 02-tavern.rdm this way).
const FILES: Record<string, string> = {};
EXAMPLE_FILES.forEach((f) => {
    FILES[f.filename] = f.content;
});

// The runnable generators. The `.md` walkthrough notes are docs, not
// generators — some demonstrate auto-discovery (a bare `[@Table]` that
// resolves via the vault index at runtime; covered by
// resolver/autoDiscover.test.ts, not reproducible in this Use:-only
// harness). So the produces-output check runs over the `.rdm` files
// only.
const RDM_FILES = EXAMPLE_FILES.filter((f) => f.filename.endsWith(".rdm"));

describe("bundled example generators", () => {
    for (const f of RDM_FILES) {
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

    test("Way 3 note resolves its Use: reference and produces output", () => {
        // The "Way 3" walkthrough pulls TavernName out of 02-tavern.rdm
        // via `Use:`. resolveBundle dispatches `.md` through the
        // markdown extractor, so its codeblocks (including the `Use:`
        // one) are honoured — this is the one .md we can run in
        // isolation, and it guards the cross-file reference we teach.
        const way3 = EXAMPLE_FILES.find((f) =>
            f.filename.startsWith("Way 3")
        );
        expect(way3).toBeDefined();
        const b = resolveBundle(way3!.filename, way3!.content, {
            source: inMemorySource(FILES),
            callerDir: "",
        });
        const outputs: string[] = [];
        for (let seed = 1; seed <= 5; seed++) {
            const ev = new Evaluator(b.main, b.extras, { seed });
            outputs.push(ev.run());
        }
        expect(outputs.every((o) => o.length === 0)).toBe(false);
    });

    test("example files and content are consistent", () => {
        // Sanity: every example has a filename, content, description,
        // and the content isn't accidentally empty (could happen if
        // a build step mangled the bundle).
        for (const f of EXAMPLE_FILES) {
            expect(f.filename).toMatch(/\.(rdm|md)$/);
            expect(f.content.length).toBeGreaterThan(100);
            expect(f.description.length).toBeGreaterThan(0);
        }
    });
});
