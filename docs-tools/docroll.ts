/**
 * docroll — evaluate a documentation example against the real engine.
 *
 * Not shipped. This exists so a doc example can be EXECUTED rather
 * than eyeballed: every wrong example we have shipped so far was
 * invisible to both tsc and jest.
 *
 * Usage:
 *   node docroll.cjs gen  <file.rdm> <TableName> [seed]
 *   node docroll.cjs src  <TableName> [seed] < generator source on stdin
 *   node docroll.cjs inline <expr> [seed] [notePath] < note markdown on stdin
 */
import * as fs from "fs";
import { parseGeneratorFile } from "../src/engine/fileParser";
import { Evaluator } from "../src/engine/evaluator";
import { buildInlineBundle } from "../src/resolver/scope";
import { inMemorySource } from "../src/resolver/fileResolver";
import { TagRollFilter, matchesTagRollFilter } from "../src/resolver/mdContent";
import { evalSourceOf } from "../src/views/lockingService";

const readStdin = (): string => {
    try {
        return fs.readFileSync(0, "utf8");
    } catch {
        return "";
    }
};

// A small fake vault so tag rolls (#tag / *|folder=) can be exercised
// from the docs. Notes are declared in the note markdown as HTML
// comments: <!-- vault: path.md | tags: a,b | fm: key=value; key=value -->
interface FakeNote {
    path: string;
    tags: Set<string>;
    fm: Record<string, unknown>;
    body: string;
}
function parseFakeVault(note: string): FakeNote[] {
    const out: FakeNote[] = [];
    const re = /<!--\s*vault:\s*([^|]+?)\s*(?:\|\s*tags:\s*([^|]*?)\s*)?(?:\|\s*fm:\s*([^|]*?)\s*)?(?:\|\s*body:\s*([\s\S]*?)\s*)?-->/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(note)) !== null) {
        const fm: Record<string, unknown> = {};
        for (const pair of (m[3] ?? "").split(";")) {
            const eq = pair.indexOf("=");
            if (eq > 0) fm[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
        }
        out.push({
            path: m[1],
            tags: new Set(
                (m[2] ?? "")
                    .split(",")
                    .map((t) => t.trim().replace(/^#/, "").toLowerCase())
                    .filter(Boolean)
            ),
            fm,
            body: (m[4] ?? "A block.").replace(/\\n/g, "\n"),
        });
    }
    return out;
}

const [, , mode, ...rest] = process.argv;

try {
    if (mode === "gen" || mode === "src") {
        const src =
            mode === "gen" ? fs.readFileSync(rest[0], "utf8") : readStdin();
        const table = mode === "gen" ? rest[1] : rest[0];
        const seedArg = mode === "gen" ? rest[2] : rest[1];
        const file = parseGeneratorFile(src);
        const ev = new Evaluator(file, [], {
            seed: seedArg === undefined ? undefined : Number(seedArg),
        });
        process.stdout.write(
            table ? ev.runByName(table) : ev.run()
        );
    } else if (mode === "inline") {
        // Normalise exactly as the renderer does: a bare formula
        // (`rdm:2d10`) is braced, and a `dice:` prefix is translated.
        const rawExpr = rest[0];
        const prefix = process.env.DOCROLL_PREFIX;
        const expr = evalSourceOf(
            prefix === undefined || prefix === "rdm:"
                ? { expr: rawExpr }
                : { expr: rawExpr, prefix }
        );
        const seedArg = rest[1];
        const notePath = rest[2] ?? "Note.md";
        const noteSource = readStdin();
        const vault = parseFakeVault(noteSource);
        const files: Record<string, string> = {};
        for (const n of vault) files[n.path] = n.body;
        const bundle = buildInlineBundle(expr, {
            notePath,
            noteSource,
            source: inMemorySource(files),
            tagFiles: (filter: TagRollFilter) =>
                vault
                    .filter((n) =>
                        matchesTagRollFilter(n.tags, n.fm, filter, n.path)
                    )
                    .map((n) => n.path)
                    .sort(),
            tagFrontmatter: (p: string) =>
                vault.find((n) => n.path === p)?.fm,
        });
        const ev = new Evaluator(bundle.main, bundle.extras, {
            seed: seedArg === undefined || seedArg === "" ? undefined : Number(seedArg),
        });
        process.stdout.write(ev.run());
    } else {
        process.stderr.write("modes: gen | src | inline\n");
        process.exit(2);
    }
} catch (e) {
    process.stdout.write("ERROR: " + (e as Error).message);
    process.exit(1);
}
