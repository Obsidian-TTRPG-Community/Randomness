/**
 * Tests for whole-note line/block rollers and tag rollers — Dice
 * Roller merge Phase 4.
 *
 * Layers:
 *   1. Extraction: extractNoteLines / extractNoteBlocks (frontmatter,
 *      fences, ^block-id stripping, thematic breaks).
 *   2. Direct-call parsing: [[Note|line]] / [[Note|block]] with
 *      repetitions; #tag / #tag|link.
 *   3. End-to-end: line/block/tag rolls through scope + engine,
 *      seeded and deterministic.
 *   4. dice: compat translation for the newly supported forms.
 */

import {
    extractNoteLines,
    extractNoteBlocks,
    parseDirectWikilinkCall,
    parseDirectTagCall,
    LINES_PREFIX,
    BLOCKS_PREFIX,
} from "../../src/resolver/mdContent";
import {
    inMemorySource,
    parseFileSource,
} from "../../src/resolver/fileResolver";
import { buildInlineBundle } from "../../src/resolver/scope";
import { Evaluator } from "../../src/engine/evaluator";
import { translateDiceExpression } from "../../src/compat/diceCompat";

const NOTE = [
    "---",
    "tags: [rumour]",
    "---",
    "# Rumours",
    "",
    "The old mill is haunted.",
    "",
    "Wolves were seen north of town.",
    "They looked hungry.",
    "",
    "---",
    "",
    "```text",
    "not markdown",
    "",
    "still one block",
    "```",
    "",
    "^ignored-id",
].join("\n");

// ─── Extraction ───

describe("extractNoteLines / extractNoteBlocks", () => {
    test("lines: frontmatter and ^id lines removed, all else kept", () => {
        const lines = extractNoteLines(NOTE);
        expect(lines).toContain("# Rumours");
        expect(lines).toContain("The old mill is haunted.");
        expect(lines).toContain("They looked hungry.");
        expect(lines).not.toContain("tags: [rumour]");
        expect(lines).not.toContain("^ignored-id");
    });

    test("blocks: blank-line separated, fences whole, breaks dropped", () => {
        const blocks = extractNoteBlocks(NOTE);
        expect(blocks).toContain("# Rumours");
        expect(blocks).toContain("The old mill is haunted.");
        expect(blocks).toContain(
            "Wolves were seen north of town.\nThey looked hungry."
        );
        // The fenced block survives as ONE block despite its blank line.
        expect(blocks.some((b) => b.startsWith("```text"))).toBe(true);
        // Thematic break and trailing ^id dropped.
        expect(blocks).not.toContain("---");
        expect(blocks).not.toContain("^ignored-id");
    });
});

// ─── Direct-call parsing ───

describe("parseDirectWikilinkCall: |line and |block", () => {
    test("whole-note rolls target the hidden tables", () => {
        expect(parseDirectWikilinkCall("[[Rumours|line]]")?.tableCall).toBe(
            `[@${LINES_PREFIX}rumours]`
        );
        expect(parseDirectWikilinkCall("[[Camp/Rumours|block]]")?.tableCall).toBe(
            `[@${BLOCKS_PREFIX}rumours]`
        );
        expect(parseDirectWikilinkCall("3[[Rumours|line]]")?.tableCall).toBe(
            `[@3 ${LINES_PREFIX}rumours >> implode]`
        );
    });

    test("ordinary aliases are NOT direct calls", () => {
        expect(parseDirectWikilinkCall("[[Rumours|the rumours]]")).toBeNull();
    });
});

describe("parseDirectTagCall", () => {
    test("tag and tag|link forms", () => {
        expect(parseDirectTagCall("#rumour")).toEqual({
            tag: "rumour",
            mode: "block",
        });
        expect(parseDirectTagCall("#town/north|link")).toEqual({
            tag: "town/north",
            mode: "link",
        });
    });

    test("non-tags are null", () => {
        expect(parseDirectTagCall("[@table]")).toBeNull();
        expect(parseDirectTagCall("# heading text")).toBeNull();
    });
});

// ─── parseFileSource hidden tables ───

describe("hidden per-note tables", () => {
    test(".md files gain __lines: and __blocks: tables", () => {
        const file = parseFileSource("Camp/Rumours.md", NOTE);
        const names = file.tables.map((t) => t.name);
        expect(names).toContain(`${LINES_PREFIX}rumours`);
        expect(names).toContain(`${BLOCKS_PREFIX}rumours`);
    });
});

// ─── End-to-end ───

describe("line/block/tag rolls end-to-end", () => {
    const source = inMemorySource({
        "Camp/Rumours.md": NOTE,
        "Camp/Sightings.md": "A dragon overhead.\n\nStrange lights.",
    });
    const tagFiles = (tag: string) =>
        tag === "rumour" ? ["Camp/Rumours.md", "Camp/Sightings.md"] : [];

    function roll(expr: string, seed = 1): string {
        const bundle = buildInlineBundle(expr, {
            notePath: "Camp/journal.md",
            noteSource: "",
            source,
            tagFiles,
        });
        return new Evaluator(bundle.main, bundle.extras, { seed }).run();
    }

    test("[[Note|line]] rolls a line", () => {
        const lines = extractNoteLines(NOTE);
        for (let seed = 1; seed <= 20; seed++) {
            expect(lines).toContain(roll("[[Rumours|line]]", seed));
        }
    });

    test("[[Note|block]] rolls a block", () => {
        const blocks = extractNoteBlocks(NOTE);
        for (let seed = 1; seed <= 20; seed++) {
            expect(blocks).toContain(roll("[[Rumours|block]]", seed));
        }
    });

    test("#tag rolls a block from one of the tagged notes", () => {
        const candidates = [
            ...extractNoteBlocks(NOTE),
            "A dragon overhead.",
            "Strange lights.",
        ];
        const seen = new Set<string>();
        for (let seed = 1; seed <= 40; seed++) {
            const out = roll("#rumour", seed);
            expect(candidates).toContain(out);
            seen.add(out);
        }
        expect(seen.size).toBeGreaterThan(1); // actually varies
    });

    test("#tag|link inserts a wikilink to a tagged note", () => {
        for (let seed = 1; seed <= 10; seed++) {
            const out = roll("#rumour|link", seed);
            expect(["[[Camp/Rumours]]", "[[Camp/Sightings]]"]).toContain(out);
        }
    });

    test("seeded tag rolls are deterministic", () => {
        expect(roll("#rumour", 7)).toBe(roll("#rumour", 7));
    });

    test("unknown tag and missing lookup error clearly", () => {
        expect(() => roll("#nope")).toThrow(/No notes found/);
        expect(() =>
            buildInlineBundle("#rumour", {
                notePath: "n.md",
                noteSource: "",
                source,
            })
        ).toThrow(/tag index/);
    });
});

// ─── dice: compat for the new forms ───

describe("dice: compat for sections, lines, and tags", () => {
    const t = (s: string) => translateDiceExpression(s).expr;

    test("whole-note and line rolls translate instead of erroring", () => {
        expect(t("[[Note]]")).toBe("[[Note|block]]");
        expect(t("[[Note]]|line")).toBe("[[Note|line]]");
        expect(t("3d[[Note]]")).toBe("3[[Note|block]]");
        expect(t("[[Note]]|paragraph")).toBe("[[Note|block]]"); // approximated
    });

    test("tag rolls translate", () => {
        expect(t("#rumour")).toBe("#rumour");
        expect(t("#rumour|-")).toBe("#rumour");
        expect(t("#rumour|link")).toBe("#rumour|link");
        expect(t("#rumour|paragraph")).toBe("#rumour");
        expect(() => t("#rumour|+")).toThrow(/every-file/i);
    });
});
