/**
 * Demo-note smoke test.
 *
 * Reads the demo note we ship with the plugin, extracts every inline
 * rdm: expression, and evaluates each against the demo's own
 * codeblock scope. Any parse error or resolver error in the demo
 * note would fail here — keeping the demo trustworthy across changes.
 */

import * as fs from "fs";
import * as path from "path";
import { Evaluator } from "../../src/engine/evaluator";
import { buildInlineBundle } from "../../src/resolver/scope";
import { inMemorySource } from "../../src/resolver/fileResolver";

const demoPath = path.join(
    __dirname,
    "..",
    "..",
    "demo",
    "Randomness Inline Demo.md"
);

const noteSource = fs.readFileSync(demoPath, "utf8");

/**
 * Pull every rdm: expression text out of the note. We match the
 * codespan with the prefix, then capture the expression body up to
 * either the lock separator (⟹) or the closing backtick. This
 * mirrors the regex in lockingService — keep them in sync if the
 * matching strategy ever changes.
 */
function extractRdmExpressions(source: string): string[] {
    const out: string[] = [];
    const re = /`rdm:([^`\u27F9]+)(?:\u27F9[^`]*)?`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
        out.push(m[1]);
    }
    return out;
}

describe("demo note: inline expressions all evaluate", () => {
    const exprs = extractRdmExpressions(noteSource);

    test("the note actually contains some rdm: calls (sanity check)", () => {
        // If this drops to zero, the regex or the demo's syntax has
        // changed in a way that breaks the scan — fix one or the other
        // before chasing individual eval failures.
        expect(exprs.length).toBeGreaterThan(5);
    });

    // Generate one test per extracted expression. The .each loop gives
    // each one its own line in the output, so a single broken expression
    // doesn't bury the others in a stack trace.
    test.each(exprs)("expression evaluates: rdm:%s", (expr) => {
        const emptySource = inMemorySource({});
        const bundle = buildInlineBundle(expr, {
            notePath: "Randomness Inline Demo.md",
            noteSource,
            source: emptySource,
            generatorRoot: undefined,
        });
        const evaluator = new Evaluator(bundle.main, bundle.extras, {
            seed: 1, // deterministic
        });
        // Should produce output (possibly empty string for some weird
        // cases, but never throw). The non-throw is the actual
        // assertion; expect-not-throw isn't a Jest matcher, so we
        // wrap and check.
        const result = evaluator.run();
        expect(typeof result).toBe("string");
    });
});
