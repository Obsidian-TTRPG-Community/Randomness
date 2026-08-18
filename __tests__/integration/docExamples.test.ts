/**
 * The documentation, executed.
 *
 * Every user-reported "bug" in this project for weeks running turned
 * out to be a WRONG DOC: prose promising behaviour the engine never
 * had. `[@N table]` was documented as joining results with blank
 * lines (it joins with nothing), `implode ", "` was shown with quotes
 * that end up in the output, a tag filter was said to work under the
 * `dice:` prefix when it had never reached that branch, and the
 * filter list advertised `a` and `mid`, neither of which exists.
 *
 * None of those were visible to `tsc` or to any test, because nothing
 * executed the documentation. This file does. It is deliberately
 * mechanical — it cannot check that prose is *true*, only that the
 * examples run and that the names the docs use are names the engine
 * answers to. That is enough to have caught two of the four.
 *
 * Deliberately NOT asserted: exact rolled output. Most examples are
 * random, and pinning them would make the docs unmaintainable. The
 * corpus tests above pin the behaviours the prose describes; this
 * file pins that the prose refers to things that exist.
 */

import * as fs from "fs";
import * as path from "path";
import { parseGeneratorFile } from "../../src/engine/fileParser";
import { Evaluator } from "../../src/engine/evaluator";

const DOCS = path.join(__dirname, "..", "..", "docs");
const REFERENCE = path.join(DOCS, "reference.md");
const GUIDE_DIR = path.join(DOCS, "guide");

const guideFiles = fs
    .readdirSync(GUIDE_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(GUIDE_DIR, f));

const docFiles = [REFERENCE, ...guideFiles];

const readDoc = (p: string) => fs.readFileSync(p, "utf8");
const shortName = (p: string) => path.relative(DOCS, p);

// ────────────────────────────────────────────────────────────────────
// Fenced-block extraction
// ────────────────────────────────────────────────────────────────────

interface Block {
    file: string;
    line: number;
    lang: string;
    body: string;
}

/**
 * Fenced blocks, tracking fence length so a ````text wrapper holding a
 * ```randomness sample yields the OUTER block only — the inner one is
 * an exhibit of syntax, not something to run.
 */
function fencedBlocks(file: string): Block[] {
    const src = readDoc(file);
    const lines = src.split("\n");
    const out: Block[] = [];
    let open: { fence: string; lang: string; line: number; body: string[] } | null =
        null;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\s*(`{3,})\s*(\S*)\s*$/);
        if (open === null) {
            if (m) open = { fence: m[1], lang: m[2], line: i + 1, body: [] };
            continue;
        }
        // Only a fence at least as long as the opener can close it.
        if (m && m[2] === "" && m[1].length >= open.fence.length) {
            out.push({
                file,
                line: open.line,
                lang: open.lang,
                body: open.body.join("\n"),
            });
            open = null;
            continue;
        }
        open.body.push(lines[i]);
    }
    return out;
}

/** A block that is generator source rather than prose or output. */
function isGeneratorSource(b: Block): boolean {
    if (b.lang !== "text" && b.lang !== "randomness") return false;
    // A nested fence means this is a wrapper showing what to type.
    if (/^\s*```/m.test(b.body)) return false;
    return /^\s*(Table|Set|Define|Prompt|MaxReps|Use|Title|Header|Footer)\s*:/im.test(
        b.body
    );
}

const generatorBlocks = docFiles.flatMap((f) =>
    fencedBlocks(f).filter(isGeneratorSource)
);

describe("documentation: every generator example parses and rolls", () => {
    test("the scan actually found blocks (guards the extractor)", () => {
        // If this collapses, the fence-matching above has drifted and
        // the rest of this file is silently testing nothing.
        expect(generatorBlocks.length).toBeGreaterThan(15);
    });

    test.each(
        generatorBlocks.map((b) => [`${shortName(b.file)}:${b.line}`, b] as const)
    )("%s", (_label, b) => {
        const file = parseGeneratorFile(b.body);
        expect(file.tables.length).toBeGreaterThan(0);

        // Many reference examples are fragments that deliberately call
        // a table defined elsewhere in the prose (or Use:'d from
        // another note). Rolling those raises "Unknown table: X", and
        // that is not a documentation defect — so tolerate exactly
        // that error, for a name the block does not define, and treat
        // every other failure as real.
        const defined = new Set(
            file.tables.map((t) => t.name.toLowerCase())
        );
        let thrown: Error | null = null;
        try {
            // A fixed seed keeps failure messages stable; output itself
            // is random by design and is not asserted.
            new Evaluator(file, [], { seed: 1 }).run();
        } catch (e) {
            thrown = e as Error;
        }
        if (thrown !== null) {
            const missing = thrown.message.match(/^Unknown table: (.+)$/);
            if (!missing || defined.has(missing[1].toLowerCase())) {
                throw thrown;
            }
        }
    });
});

// ────────────────────────────────────────────────────────────────────
// Names the docs use must be names the engine answers to
// ────────────────────────────────────────────────────────────────────

/**
 * The filter names `applyFilter` implements, read out of the source
 * rather than duplicated here — a hand-copied list would drift, and
 * drift is the whole problem this file exists to catch.
 */
function implementedFilters(): Set<string> {
    const src = fs.readFileSync(
        path.join(__dirname, "..", "..", "src", "engine", "filters.ts"),
        "utf8"
    );
    const start = src.indexOf("export function applyFilter");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start);
    const names = new Set<string>();
    for (const m of body.matchAll(/^\s*case "([^"]+)":/gm)) names.add(m[1]);
    return names;
}

/** Filter names the docs tell people to write after `>>`. */
function documentedFilters(): { name: string; where: string }[] {
    const out: { name: string; where: string }[] = [];
    for (const f of docFiles) {
        readDoc(f)
            .split("\n")
            .forEach((line, i) => {
                for (const m of line.matchAll(/>>\s*([A-Za-z+][\w+-]*)/g)) {
                    out.push({
                        name: m[1].toLowerCase(),
                        where: `${shortName(f)}:${i + 1}`,
                    });
                }
            });
    }
    return out;
}

describe("documentation: every filter the docs mention exists", () => {
    const engine = implementedFilters();
    const documented = documentedFilters();

    test("the scan found filter mentions (guards the extractor)", () => {
        expect(documented.length).toBeGreaterThan(10);
    });

    test("no doc names a filter the engine does not implement", () => {
        // An unknown filter name is returned unchanged with no error,
        // so a typo — or an invented filter — looks to the reader like
        // a filter that silently does nothing. `>> a` shipped that way.
        const unknown = documented.filter((d) => !engine.has(d.name));
        expect(unknown.map((u) => `${u.where} → >> ${u.name}`)).toEqual([]);
    });
});

/** Directive keywords the parser recognises, read from its own regex. */
function implementedDirectives(): Set<string> {
    const src = fs.readFileSync(
        path.join(__dirname, "..", "..", "src", "engine", "fileParser.ts"),
        "utf8"
    );
    const m = src.match(/const DIRECTIVE_PREFIX = \/\^\\s\*\(\?:([^)]+)\)/);
    expect(m).not.toBeNull();
    return new Set((m as RegExpMatchArray)[1].split("|").map((s) => s.toLowerCase()));
}

describe("documentation: every directive in an example is real", () => {
    const engine = implementedDirectives();
    // Directives that legitimately appear in examples but are handled
    // outside DIRECTIVE_PREFIX (they are file-level, not line-level).
    const alsoReal = new Set(["header", "footer"]);

    const used = generatorBlocks.flatMap((b) =>
        b.body
            .split("\n")
            .map((line) => line.match(/^\s*([A-Za-z]+)\s*:/))
            .filter((m): m is RegExpMatchArray => m !== null)
            .map((m) => ({
                name: m[1].toLowerCase(),
                where: `${shortName(b.file)}:${b.line}`,
            }))
    );

    test("no example uses a directive the parser never sees", () => {
        // `!set monster=goblin` shipped in the reference for months.
        // It is not a directive at all — `!` opens a deck pick — so the
        // variable was never set and the example rendered a broken
        // embed. Anything Capitalised-and-colon in an example block
        // should be a directive the parser knows, or a table item that
        // happens to contain a colon.
        const suspicious = used.filter(
            (u) =>
                !engine.has(u.name) &&
                !alsoReal.has(u.name) &&
                // Prose-y item lines like "Coins: 10x10 silver" are
                // fine; only flag words that LOOK like directives.
                /^(set|define|table|type|roll|use|prompt|title|formatting|maxreps|default|shuffle|endtable|deck|flip|header|footer)$/.test(
                    u.name
                )
        );
        expect(suspicious.map((u) => `${u.where} → ${u.name}:`)).toEqual([]);
    });
});
