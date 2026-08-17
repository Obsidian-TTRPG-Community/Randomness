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
 *   5. Tag/property filters (tags AND/OR, frontmatter properties).
 */

import {
    extractNoteLines,
    extractNoteBlocks,
    parseDirectWikilinkCall,
    parseDirectTagCall,
    renderPropTemplate,
    matchesTagRollFilter,
    TagRollFilter,
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
        expect(parseDirectTagCall("#rumour")).toMatchObject({
            mode: "block",
            filter: { tagGroups: [["rumour"]], props: [] },
        });
        expect(parseDirectTagCall("#town/north|link")).toMatchObject({
            mode: "link",
            filter: { tagGroups: [["town/north"]], props: [] },
        });
        expect(parseDirectTagCall("#town/north|linkpath")).toMatchObject({
            mode: "linkpath",
            filter: { tagGroups: [["town/north"]], props: [] },
        });
    });

    test("tag AND / OR groups", () => {
        expect(parseDirectTagCall("#npc|#merchant")?.filter.tagGroups).toEqual(
            [["npc"], ["merchant"]]
        );
        expect(parseDirectTagCall("#npc,#monster")?.filter.tagGroups).toEqual([
            ["npc", "monster"],
        ]);
    });

    test("property filters, with OR values and link mode", () => {
        const c = parseDirectTagCall("#npc|universe=Eldara,Vex|link");
        expect(c).toMatchObject({
            mode: "link",
            filter: {
                tagGroups: [["npc"]],
                props: [{ key: "universe", values: ["Eldara", "Vex"] }],
            },
        });
        expect(c?.label).toBe("#npc|universe=Eldara,Vex");
    });

    test("folder= segments become folder filters, not props", () => {
        const c = parseDirectTagCall("*|folder=Bestiary/Undead|cr=3|link");
        expect(c).toMatchObject({
            mode: "link",
            filter: {
                tagGroups: [],
                folders: ["Bestiary/Undead"],
                props: [{ key: "cr", values: ["3"] }],
            },
        });
        expect(c?.label).toBe("folder=Bestiary/Undead|cr=3");
        // Comma = OR; slashes normalised.
        expect(
            parseDirectTagCall("#monster|folder=A,/B/")?.filter.folders
        ).toEqual(["A", "B"]);
        // A folder alone is a valid filter for the * source.
        expect(parseDirectTagCall("*|folder=Bestiary")).not.toBeNull();
    });

    test("* source rolls on properties alone", () => {
        expect(parseDirectTagCall("*|universe=Eldara")).toMatchObject({
            mode: "block",
            filter: {
                tagGroups: [],
                props: [{ key: "universe", values: ["Eldara"] }],
            },
        });
        // A bare * (no filters) is NOT a tag call.
        expect(parseDirectTagCall("*")).toBeNull();
        expect(parseDirectTagCall("*|link")).toBeNull();
    });

    test("dice-compat and unknown word suffixes approximate to block", () => {
        expect(parseDirectTagCall("#rumour|-")?.mode).toBe("block");
        expect(parseDirectTagCall("#rumour|paragraph")?.mode).toBe("block");
    });

    test("non-tags are null", () => {
        expect(parseDirectTagCall("[@table]")).toBeNull();
        expect(parseDirectTagCall("# heading text")).toBeNull();
        expect(parseDirectTagCall("#npc|=broken")).toBeNull();
        expect(parseDirectTagCall("#npc|universe=")).toBeNull();
    });
});

describe("matchesTagRollFilter", () => {
    const f = (
        tagGroups: string[][],
        props: TagRollFilter["props"] = []
    ): TagRollFilter => ({ tagGroups, props });
    const tags = new Set(["npc", "town/north"]);

    test("tag groups AND together; tags in a group OR", () => {
        expect(matchesTagRollFilter(tags, undefined, f([["npc"]]))).toBe(true);
        expect(
            matchesTagRollFilter(tags, undefined, f([["npc"], ["merchant"]]))
        ).toBe(false);
        expect(
            matchesTagRollFilter(tags, undefined, f([["merchant", "npc"]]))
        ).toBe(true);
        // Nested tags match their parent.
        expect(matchesTagRollFilter(tags, undefined, f([["town"]]))).toBe(true);
    });

    test("property values match case-insensitively, OR'd", () => {
        const fm = { universe: "Eldara", Level: 3 };
        expect(
            matchesTagRollFilter(tags, fm, f([], [{ key: "universe", values: ["eldara"] }]))
        ).toBe(true);
        expect(
            matchesTagRollFilter(tags, fm, f([], [{ key: "universe", values: ["Vex", "Eldara"] }]))
        ).toBe(true);
        expect(
            matchesTagRollFilter(tags, fm, f([], [{ key: "universe", values: ["Vex"] }]))
        ).toBe(false);
        // Case-insensitive keys; non-string values stringify.
        expect(
            matchesTagRollFilter(tags, fm, f([], [{ key: "level", values: ["3"] }]))
        ).toBe(true);
        // Missing property / no frontmatter fails.
        expect(
            matchesTagRollFilter(tags, fm, f([], [{ key: "region", values: ["x"] }]))
        ).toBe(false);
        expect(
            matchesTagRollFilter(tags, undefined, f([], [{ key: "universe", values: ["Eldara"] }]))
        ).toBe(false);
    });

    test("list-valued properties match if any entry hits", () => {
        const fm = { universe: ["Eldara", "Vex"] };
        expect(
            matchesTagRollFilter(tags, fm, f([], [{ key: "universe", values: ["vex"] }]))
        ).toBe(true);
    });

    test("wikilink values match target basename and alias", () => {
        const fm = { universe: "[[Worlds/Eldara|The Realm]]" };
        for (const want of ["Eldara", "the realm", "[[Worlds/Eldara|The Realm]]"]) {
            expect(
                matchesTagRollFilter(tags, fm, f([], [{ key: "universe", values: [want] }]))
            ).toBe(true);
        }
    });

    test("folder filters match by path prefix, case-insensitively", () => {
        const filt: TagRollFilter = {
            tagGroups: [],
            props: [],
            folders: ["Bestiary/Undead"],
        };
        expect(
            matchesTagRollFilter(tags, undefined, filt, "Bestiary/Undead/Wight.md")
        ).toBe(true);
        expect(
            matchesTagRollFilter(tags, undefined, filt, "bestiary/undead/deep/Ghast.md")
        ).toBe(true);
        expect(
            matchesTagRollFilter(tags, undefined, filt, "Bestiary/UndeadX/Wight.md")
        ).toBe(false);
        expect(
            matchesTagRollFilter(tags, undefined, filt, "Elsewhere/Wight.md")
        ).toBe(false);
        // No path available → folder filters can't match.
        expect(matchesTagRollFilter(tags, undefined, filt)).toBe(false);
    });

    test("* value means property exists", () => {
        expect(
            matchesTagRollFilter(tags, { universe: "x" }, f([], [{ key: "universe", values: ["*"] }]))
        ).toBe(true);
        expect(
            matchesTagRollFilter(tags, {}, f([], [{ key: "universe", values: ["*"] }]))
        ).toBe(false);
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
    // Mirrors the plugin's metadata-cache lookup over two fake notes:
    // both tagged #rumour, only Sightings carries universe: Eldara.
    const meta: Record<string, { tags: Set<string>; fm?: Record<string, unknown> }> = {
        "Camp/Rumours.md": { tags: new Set(["rumour"]) },
        "Camp/Sightings.md": {
            tags: new Set(["rumour"]),
            fm: { universe: "Eldara" },
        },
    };
    const tagFiles = (filter: TagRollFilter) =>
        Object.keys(meta)
            .filter((p) =>
                matchesTagRollFilter(meta[p].tags, meta[p].fm, filter, p)
            )
            .sort();

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

    test("#tag|link inserts a wikilink shown as the note name", () => {
        for (let seed = 1; seed <= 10; seed++) {
            const out = roll("#rumour|link", seed);
            expect([
                "[[Camp/Rumours|Rumours]]",
                "[[Camp/Sightings|Sightings]]",
            ]).toContain(out);
        }
    });

    test("#tag|linkpath shows the full vault path instead", () => {
        for (let seed = 1; seed <= 10; seed++) {
            const out = roll("#rumour|linkpath", seed);
            expect(["[[Camp/Rumours]]", "[[Camp/Sightings]]"]).toContain(out);
        }
    });

    test("seeded tag rolls are deterministic", () => {
        expect(roll("#rumour", 7)).toBe(roll("#rumour", 7));
    });

    test("property filter narrows the candidates", () => {
        for (let seed = 1; seed <= 10; seed++) {
            expect(roll("#rumour|universe=Eldara|link", seed)).toBe(
                "[[Camp/Sightings|Sightings]]"
            );
            expect(roll("*|universe=Eldara|link", seed)).toBe(
                "[[Camp/Sightings|Sightings]]"
            );
            expect(["A dragon overhead.", "Strange lights."]).toContain(
                roll("#rumour|universe=Eldara", seed)
            );
        }
        expect(() => roll("#rumour|universe=Vex")).toThrow(
            /No notes found matching #rumour\|universe=Vex/
        );
    });

    test("folder filter narrows to notes under that folder", () => {
        for (let seed = 1; seed <= 6; seed++) {
            expect([
                "[[Camp/Rumours|Rumours]]",
                "[[Camp/Sightings|Sightings]]",
            ]).toContain(roll("*|folder=Camp|link", seed));
            expect(roll("*|folder=Camp|universe=Eldara|link", seed)).toBe(
                "[[Camp/Sightings|Sightings]]"
            );
        }
        expect(() => roll("*|folder=Elsewhere|link")).toThrow(
            /No notes found matching folder=Elsewhere/
        );
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
        expect(t("#rumour|linkpath")).toBe("#rumour|linkpath");
        expect(t("#rumour|paragraph")).toBe("#rumour");
        expect(() => t("#rumour|+")).toThrow(/every-file/i);
    });

    test("filter segments pass through the dice: prefix", () => {
        expect(t("#npc|universe=Eldara|link")).toBe(
            "#npc|universe=Eldara|link"
        );
        expect(t("#npc|#merchant")).toBe("#npc|#merchant");
        expect(t("#npc|link|universe=Eldara")).toBe(
            "#npc|universe=Eldara|link"
        );
    });

    // The tagless `*` source is the same roll with no tag constraint.
    // It used to miss the tag-roll dispatch entirely and fall through
    // to the formula branch, coming out as `{*|folder=Bestiary|link}`
    // — no error, just a nonsense formula — while the reference said
    // these filters work under the dice: prefix.
    test("the tagless * source translates like any other tag roll", () => {
        expect(t("*|folder=Bestiary|link")).toBe("*|folder=Bestiary|link");
        expect(t("*|universe=Eldara")).toBe("*|universe=Eldara");
        expect(t("*|folder=Bestiary|cr=3|linkpath")).toBe(
            "*|folder=Bestiary|cr=3|linkpath"
        );
        expect(t("3*|folder=Bestiary|unique|link")).toBe(
            "3*|folder=Bestiary|unique|link"
        );
        expect(t("{1d4}*|folder=Bestiary|link")).toBe(
            "{1d4}*|folder=Bestiary|link"
        );
        // `prop:` still owns the rest of the line, link mode and all.
        expect(t("*|folder=Bestiary|prop:{{name}} CR {{cr}}")).toBe(
            "*|folder=Bestiary|prop:{{name}} CR {{cr}}"
        );
        // A `#tag` roll is untouched by the widened dispatch.
        expect(t("#npc|folder=Bestiary|link")).toBe("#npc|folder=Bestiary|link");
    });

    test("a * roll rolls end-to-end under both prefixes", () => {
        const meta: Record<string, { tags: Set<string>; fm?: Record<string, unknown> }> = {
            "Bestiary/Hag.md": { tags: new Set(), fm: { cr: 3 } },
            "Bestiary/Wolf.md": { tags: new Set(), fm: { cr: 2 } },
        };
        const opts = {
            notePath: "Session/log.md",
            noteSource: "",
            source: inMemorySource({}),
            tagFiles: (f: TagRollFilter) =>
                Object.keys(meta)
                    .filter((p) => matchesTagRollFilter(meta[p].tags, meta[p].fm, f, p))
                    .sort(),
            tagFrontmatter: (p: string) => meta[p]?.fm,
        };
        const render = (expr: string) => {
            const b = buildInlineBundle(expr, opts);
            return new Evaluator(b.main, b.extras, { seed: 5 }).run();
        };
        const native = render("*|folder=Bestiary|prop:{{name}} CR {{cr}}");
        const compat = render(t("*|folder=Bestiary|prop:{{name}} CR {{cr}}"));
        expect(native).toMatch(/^(Hag CR 3|Wolf CR 2)$/);
        // Same seed, same translated expression — the two prefixes
        // must land on the same note, not merely both "work".
        expect(compat).toBe(native);
    });
});

// ─── Property output (`prop:` templates) ───

describe("parseDirectTagCall: prop: templates", () => {
    test("bare key shorthand expands to a placeholder", () => {
        const c = parseDirectTagCall("#npc|prop:cr");
        expect(c?.mode).toBe("prop");
        expect(c?.template).toBe("{{cr}}");
    });

    test("template keeps its literal text, spacing and pipes", () => {
        const c = parseDirectTagCall(
            "#npc|prop:{{link}} — CR {{cr}}, {{hp}} HP"
        );
        expect(c?.template).toBe("{{link}} — CR {{cr}}, {{hp}} HP");
        const piped = parseDirectTagCall("#npc|prop:[[{{path}}|{{name}}]]");
        expect(piped?.template).toBe("[[{{path}}|{{name}}]]");
    });

    test("each referenced property becomes an exists-filter", () => {
        const c = parseDirectTagCall("*|folder=Bestiary|prop:{{cr}}/{{hp}}");
        expect(c?.filter.props).toEqual([
            { key: "cr", values: ["*"] },
            { key: "hp", values: ["*"] },
        ]);
    });

    test("an explicit constraint on the same key is not widened", () => {
        const c = parseDirectTagCall("#npc|cr=3|prop:{{cr}} {{hp}}");
        expect(c?.filter.props).toEqual([
            { key: "cr", values: ["3"] },
            { key: "hp", values: ["*"] },
        ]);
    });

    test("reserved placeholders add no filter", () => {
        const c = parseDirectTagCall("#npc|prop:{{link}} {{name}} {{path}}");
        expect(c?.filter.props).toEqual([]);
        expect(c?.filter.tagGroups).toEqual([["npc"]]);
    });

    test("prop: alone is a valid source — any note with the property", () => {
        const c = parseDirectTagCall("*|prop:cr");
        expect(c?.mode).toBe("prop");
        expect(c?.filter.props).toEqual([{ key: "cr", values: ["*"] }]);
    });

    test("malformed templates are rejected", () => {
        expect(parseDirectTagCall("#npc|prop:")).toBeNull();
        expect(parseDirectTagCall("#npc|prop:{{}}")).toBeNull();
        expect(parseDirectTagCall("#npc|prop:CR is {{}}")).toBeNull();
    });

    test("other modes are unaffected", () => {
        expect(parseDirectTagCall("#npc|link")?.mode).toBe("link");
        expect(parseDirectTagCall("#npc")?.template).toBeUndefined();
    });
});

describe("renderPropTemplate", () => {
    const FM = { cr: 3, hp: 45, types: ["fey", "humanoid"], name: "Ignored" };

    test("reserved placeholders describe the note", () => {
        expect(
            renderPropTemplate(
                "{{link}} {{linkpath}} {{path}} {{name}}",
                "Bestiary/Bog Hag.md",
                FM
            )
        ).toBe(
            "[[Bestiary/Bog Hag|Bog Hag]] [[Bestiary/Bog Hag]] " +
                "Bestiary/Bog Hag Bog Hag"
        );
    });

    test("frontmatter lookup is case-insensitive; lists join", () => {
        expect(
            renderPropTemplate("{{CR}} / {{types}}", "B/Hag.md", FM)
        ).toBe("3 / fey, humanoid");
    });

    test("property values are escaped, so `[` and `{` stay literal", () => {
        const out = renderPropTemplate("{{note}}", "B/Hag.md", {
            note: "hits [@twice] for {2d6}",
        });
        expect(out).toBe("hits \\[@twice] for \\{2d6}");
    });

    test("missing and empty values render empty, not 'undefined'", () => {
        expect(renderPropTemplate("[{{nope}}]", "B/Hag.md", FM)).toBe("[]");
        expect(
            renderPropTemplate("[{{x}}]", "B/Hag.md", { x: null })
        ).toBe("[]");
        expect(renderPropTemplate("[{{x}}]", "B/Hag.md", undefined)).toBe(
            "[]"
        );
    });
});

describe("prop: rolls end-to-end", () => {
    const meta: Record<
        string,
        { tags: Set<string>; fm?: Record<string, unknown> }
    > = {
        "Bestiary/Bog Hag.md": {
            tags: new Set(["monster"]),
            fm: { cr: 3, hp: 45 },
        },
        "Bestiary/Dust Mephit.md": {
            tags: new Set(["monster"]),
            fm: { cr: 1, hp: 17 },
        },
        // No cr/hp: must never be picked by a template using them.
        "Bestiary/Notes.md": { tags: new Set(["monster"]) },
        // Right properties, wrong folder.
        "NPCs/Guard.md": { tags: new Set(["npc"]), fm: { cr: 1, hp: 11 } },
    };
    const tagFiles = (filter: TagRollFilter) =>
        Object.keys(meta)
            .filter((p) =>
                matchesTagRollFilter(meta[p].tags, meta[p].fm, filter, p)
            )
            .sort();
    const tagFrontmatter = (p: string) => meta[p]?.fm;

    function roll(expr: string, seed: number): string {
        const bundle = buildInlineBundle(expr, {
            notePath: "Session/log.md",
            noteSource: "",
            source: inMemorySource({}),
            tagFiles,
            tagFrontmatter,
        });
        return new Evaluator(bundle.main, bundle.extras, { seed }).run();
    }

    test("every property in one template comes from the same note", () => {
        const valid = new Set([
            "[[Bestiary/Bog Hag|Bog Hag]] — CR 3, 45 HP",
            "[[Bestiary/Dust Mephit|Dust Mephit]] — CR 1, 17 HP",
        ]);
        const seen = new Set<string>();
        for (let seed = 1; seed <= 40; seed++) {
            const out = roll(
                "*|folder=Bestiary|prop:{{link}} — CR {{cr}}, {{hp}} HP",
                seed
            );
            expect(valid).toContain(out);
            seen.add(out);
        }
        // Both candidates reachable — the pick is a real roll.
        expect(seen.size).toBe(2);
    });

    test("notes missing a referenced property are never picked", () => {
        for (let seed = 1; seed <= 40; seed++) {
            expect(["3", "1"]).toContain(roll("#monster|prop:cr", seed));
        }
    });

    test("folder= narrows the candidates", () => {
        for (let seed = 1; seed <= 20; seed++) {
            expect(roll("*|folder=NPCs|prop:{{name}} CR {{cr}}", seed)).toBe(
                "Guard CR 1"
            );
        }
    });

    test("seeded rolls are deterministic", () => {
        const a = roll("*|folder=Bestiary|prop:{{name}} {{cr}}", 7);
        const b = roll("*|folder=Bestiary|prop:{{name}} {{cr}}", 7);
        expect(a).toBe(b);
    });

    test("no matching note is a clear error", () => {
        expect(() => roll("*|folder=Nowhere|prop:cr", 1)).toThrow(
            /No notes found/i
        );
    });

    test("without a frontmatter lookup, prop: rolls explain themselves", () => {
        expect(() =>
            buildInlineBundle("#monster|prop:cr", {
                notePath: "Session/log.md",
                noteSource: "",
                source: inMemorySource({}),
                tagFiles,
            })
        ).toThrow(/metadata cache/i);
    });

    test("dice: compat passes a prop template through intact", () => {
        expect(
            translateDiceExpression("#monster|prop:{{link}} — CR {{cr}}").expr
        ).toBe("#monster|prop:{{link}} — CR {{cr}}");
        expect(
            translateDiceExpression("#npc|link|cr=3|prop:{{cr}}").expr
        ).toBe("#npc|cr=3|prop:{{cr}}");
    });
});

// ─── Repetitions and |unique ───

describe("parseDirectTagCall: repetitions and |unique", () => {
    test("a count or a dice prefix is captured, not rejected", () => {
        expect(parseDirectTagCall("3#monster")?.reps).toBe("3");
        expect(parseDirectTagCall("{1d4}#monster|link")?.reps).toBe("{1d4}");
        expect(parseDirectTagCall("3*|folder=B|prop:cr")?.reps).toBe("3");
    });

    test("no prefix means one pick", () => {
        const c = parseDirectTagCall("#monster");
        expect(c?.reps).toBe("");
        expect(c?.unique).toBe(false);
    });

    test("|unique is a draw style, not a mode", () => {
        const c = parseDirectTagCall("3#monster|unique|link");
        expect(c?.unique).toBe(true);
        expect(c?.mode).toBe("link");
        expect(c?.reps).toBe("3");
    });

    test("|unique composes with prop: when it comes first", () => {
        const c = parseDirectTagCall("3*|folder=B|unique|prop:{{name}}");
        expect(c?.unique).toBe(true);
        expect(c?.mode).toBe("prop");
        expect(c?.template).toBe("{{name}}");
    });

    test("the filter still parses after a prefix", () => {
        const c = parseDirectTagCall("{1d3}#npc|universe=Eldara|link");
        expect(c?.filter.tagGroups).toEqual([["npc"]]);
        expect(c?.filter.props).toEqual([
            { key: "universe", values: ["Eldara"] },
        ]);
    });

    test("a prefix without a tag source is still not a tag call", () => {
        expect(parseDirectTagCall("3[[Note|line]]")).toBeNull();
        expect(parseDirectTagCall("3")).toBeNull();
    });
});

describe("repeated tag rolls end-to-end", () => {
    const meta: Record<
        string,
        { tags: Set<string>; fm?: Record<string, unknown> }
    > = {
        "Bestiary/Hag.md": { tags: new Set(["monster"]), fm: { cr: 3 } },
        "Bestiary/Mephit.md": { tags: new Set(["monster"]), fm: { cr: 1 } },
        "Bestiary/Wolf.md": { tags: new Set(["monster"]), fm: { cr: 2 } },
    };
    const tagFiles = (filter: TagRollFilter) =>
        Object.keys(meta)
            .filter((p) =>
                matchesTagRollFilter(meta[p].tags, meta[p].fm, filter, p)
            )
            .sort();
    const tagFrontmatter = (p: string) => meta[p]?.fm;

    function roll(expr: string, seed: number): string {
        const bundle = buildInlineBundle(expr, {
            notePath: "Session/log.md",
            noteSource: "",
            source: inMemorySource({}),
            tagFiles,
            tagFrontmatter,
        });
        return new Evaluator(bundle.main, bundle.extras, { seed }).run();
    }

    test("N picks are comma-joined", () => {
        const out = roll("3#monster|link", 1);
        expect(out.split(", ")).toHaveLength(3);
        for (const part of out.split(", ")) {
            expect(part).toMatch(/^\[\[Bestiary\/\w+\|\w+\]\]$/);
        }
    });

    test("plain repeats may repeat a note; unique never does", () => {
        let sawRepeat = false;
        for (let seed = 1; seed <= 40; seed++) {
            const parts = roll("3#monster|link", seed).split(", ");
            if (new Set(parts).size < 3) sawRepeat = true;
        }
        expect(sawRepeat).toBe(true);

        for (let seed = 1; seed <= 40; seed++) {
            const parts = roll("3#monster|unique|link", seed).split(", ");
            expect(new Set(parts).size).toBe(3);
        }
    });

    test("unique asked for more notes than exist yields all of them", () => {
        for (let seed = 1; seed <= 10; seed++) {
            const parts = roll("9#monster|unique|link", seed).split(", ");
            expect(parts).toHaveLength(3);
            expect(new Set(parts).size).toBe(3);
        }
    });

    test("repetitions work with prop: templates", () => {
        const out = roll("3*|folder=Bestiary|unique|prop:{{name}} CR {{cr}}", 4);
        const parts = out.split(", ");
        expect(parts).toHaveLength(3);
        expect(new Set(parts).size).toBe(3);
        for (const p of parts) expect(p).toMatch(/^\w+ CR \d$/);
    });

    test("a dice prefix rolls the count", () => {
        const seen = new Set<number>();
        for (let seed = 1; seed <= 40; seed++) {
            seen.add(roll("{1d3}#monster|link", seed).split(", ").length);
        }
        expect(seen.size).toBeGreaterThan(1);
        for (const n of seen) expect(n).toBeGreaterThanOrEqual(1);
    });

    test("reps of 1 stays a single pick, not a one-item join", () => {
        expect(roll("1#monster|link", 5)).toBe(roll("#monster|link", 5));
    });

    test("dice: compat carries the prefix and |unique through", () => {
        expect(translateDiceExpression("3#monster|link").expr).toBe(
            "3#monster|link"
        );
        expect(translateDiceExpression("{1d4}#monster|unique").expr).toBe(
            "{1d4}#monster|unique"
        );
        expect(
            translateDiceExpression("3#monster|unique|prop:{{cr}}").expr
        ).toBe("3#monster|unique|prop:{{cr}}");
    });
});

// ─── |sep: custom separators ───

describe("parseDirectTagCall / parseDirectWikilinkCall: |sep:", () => {
    test("no sep: means the default join, not an empty glue", () => {
        expect(parseDirectTagCall("3#monster|link")?.sep).toBeUndefined();
        expect(parseDirectWikilinkCall("3[[Note^loot]]")?.sep).toBeUndefined();
        expect(parseDirectWikilinkCall("3[[Note^loot]]")?.tableCall).toBe(
            "[@3 loot >> implode]"
        );
    });

    test("a tag roll takes sep: as a draw option, keeping its mode", () => {
        const c = parseDirectTagCall("3#monster|sep:<br>|link");
        expect(c?.sep).toBe("<br>");
        expect(c?.mode).toBe("link");
        expect(c?.reps).toBe("3");
    });

    test("sep: composes with unique and prop:", () => {
        const c = parseDirectTagCall("3#npc|unique|sep:<br>|prop:{{name}}");
        expect(c?.sep).toBe("<br>");
        expect(c?.unique).toBe(true);
        expect(c?.mode).toBe("prop");
        expect(c?.template).toBe("{{name}}");
    });

    test("spacing inside the glue survives — it IS the separator", () => {
        expect(parseDirectTagCall("3#monster|sep: — |link")?.sep).toBe(" — ");
        expect(parseDirectTagCall("3#monster|sep:<br>• |link")?.sep).toBe(
            "<br>• "
        );
    });

    test("escapes decode: \\n newline, \\t tab, \\_ space, \\\\ backslash", () => {
        expect(parseDirectTagCall("3#monster|sep:\\n|link")?.sep).toBe("\n");
        expect(parseDirectTagCall("3#monster|sep:\\t|link")?.sep).toBe("\t");
        expect(parseDirectTagCall("3#monster|sep:,\\_|link")?.sep).toBe(", ");
        expect(parseDirectTagCall("3#monster|sep:\\\\|link")?.sep).toBe("\\");
    });

    test("a wikilink roll takes sep: outside the brackets", () => {
        const c = parseDirectWikilinkCall("3[[Note^loot]]|sep:<br>");
        expect(c?.sep).toBe("<br>");
        expect(c?.tableName).toBe("loot");
        expect(c?.tableCall).toBe("[@3 loot >> implode <br>]");
    });

    test("sep: does not eat a column pick", () => {
        const c = parseDirectWikilinkCall("3[[Note^npcs|Trait]]|sep:;\\_");
        expect(c?.tableName).toBe("npcs.Trait");
        // `\_` is how a trailing space is written: markdown code spans
        // strip one, and the expression reaches us trimmed.
        expect(c?.sep).toBe("; ");
        expect(c?.tableCall).toBe("[@3 npcs.Trait >> implode ;\\_]");
    });

    test("sep: works on whole-note line/block rolls", () => {
        const c = parseDirectWikilinkCall("3[[Rumours|line]]|sep:\\n");
        expect(c?.tableName).toBe(LINES_PREFIX + "rumours");
        expect(c?.tableCall).toBe(`[@3 ${LINES_PREFIX}rumours >> implode \\n]`);
    });

    test("a glue full of engine syntax is escaped, not executed", () => {
        const c = parseDirectWikilinkCall("3[[Note^loot]]|sep: [@x] {1d6} >>");
        expect(c?.sep).toBe(" [@x] {1d6} >>");
        expect(c?.tableCall).toBe(
            "[@3 loot >> implode \\_\\[@x\\]\\_\\{1d6\\}\\_\\>>]"
        );
    });

    test("an empty glue joins with nothing", () => {
        expect(parseDirectWikilinkCall("3[[Note^loot]]|sep:")?.sep).toBe("");
        expect(parseDirectWikilinkCall("3[[Note^loot]]|sep:")?.tableCall).toBe(
            "[@3 loot >> implode \\z]"
        );
    });

    test("sep: without repetitions is harmless", () => {
        const c = parseDirectWikilinkCall("[[Note^loot]]|sep:<br>");
        expect(c?.tableCall).toBe("[@loot]");
    });
});

describe("|sep: end-to-end", () => {
    const meta: Record<
        string,
        { tags: Set<string>; fm?: Record<string, unknown> }
    > = {
        "Bestiary/Hag.md": { tags: new Set(["monster"]), fm: { cr: 3 } },
        "Bestiary/Mephit.md": { tags: new Set(["monster"]), fm: { cr: 1 } },
        "Bestiary/Wolf.md": { tags: new Set(["monster"]), fm: { cr: 2 } },
    };
    const tagFiles = (filter: TagRollFilter) =>
        Object.keys(meta)
            .filter((p) =>
                matchesTagRollFilter(meta[p].tags, meta[p].fm, filter, p)
            )
            .sort();
    const tagFrontmatter = (p: string) => meta[p]?.fm;

    function roll(expr: string, seed: number, files: Record<string, string> = {}): string {
        const bundle = buildInlineBundle(expr, {
            notePath: "Session/log.md",
            noteSource: "",
            source: inMemorySource(files),
            tagFiles,
            tagFrontmatter,
        });
        return new Evaluator(bundle.main, bundle.extras, { seed }).run();
    }

    test("tag roll: <br> separates instead of a comma", () => {
        const out = roll("3#monster|sep:<br>|link", 1);
        expect(out).not.toContain(", ");
        expect(out.split("<br>")).toHaveLength(3);
    });

    test("tag roll: \\n renders as a real newline", () => {
        const out = roll("3#monster|sep:\\n|link", 2);
        expect(out.split("\n")).toHaveLength(3);
    });

    test("tag roll: a bullet glue keeps its trailing space", () => {
        const out = roll("3#monster|unique|sep:<br>• |link", 3);
        expect(out.split("<br>• ")).toHaveLength(3);
        expect(out).not.toContain("•[[");
    });

    test("tag roll: sep: composes with a prop: template", () => {
        const out = roll("3*|folder=Bestiary|unique|sep:<br>|prop:{{name}} CR {{cr}}", 4);
        const parts = out.split("<br>");
        expect(parts).toHaveLength(3);
        for (const p of parts) expect(p).toMatch(/^\w+ CR \d$/);
    });

    test("wikilink roll: sep: joins the repetitions", () => {
        const files = {
            "Session/Loot.md": ["| Loot |", "| --- |", "| a ring |", "| a sword |", "", "^loot", ""].join("\n"),
        };
        const out = roll("3[[Loot^loot]]|sep:<br>", 7, files);
        expect(out.split("<br>")).toHaveLength(3);
        expect(out).not.toContain(", ");
    });

    test("the default is still a comma list", () => {
        expect(roll("3#monster|link", 1).split(", ")).toHaveLength(3);
    });

    test("dice: compat carries sep: through, spacing intact", () => {
        expect(translateDiceExpression("3#monster|sep:<br>|link").expr).toBe(
            "3#monster|sep:<br>|link"
        );
        expect(translateDiceExpression("3#monster|sep:<br>• |link").expr).toBe(
            "3#monster|sep:<br>• |link"
        );
        expect(translateDiceExpression("3[[Note^loot]]|sep:<br>").expr).toBe(
            "3[[Note^loot]]|sep:<br>"
        );
        expect(
            translateDiceExpression("3[[Note^npcs]]|Trait|sep:;\\_").expr
        ).toBe("3[[Note^npcs|Trait]]|sep:;\\_");
    });

    // translateTableRoller has THREE returns that re-attach the glue —
    // whole-note block, whole-note line, and block-id — and only the
    // last was covered. A missing `+ sepTail` on either of the others
    // would drop the separator under the dice: prefix only, which is
    // exactly the prefix-specific difference the compat layer exists
    // to prevent.
    test("dice: whole-note line and block rolls carry sep: too", () => {
        expect(translateDiceExpression("3[[Rumours]]|sep:<br>").expr).toBe(
            "3[[Rumours|block]]|sep:<br>"
        );
        expect(translateDiceExpression("3[[Rumours]]|line|sep:<br>").expr).toBe(
            "3[[Rumours|line]]|sep:<br>"
        );
        // A block-type filter still approximates to the block roll,
        // and must not swallow the glue on the way.
        expect(
            translateDiceExpression("3[[Rumours]]|paragraph|sep:\\n").expr
        ).toBe("3[[Rumours|block]]|sep:\\n");
    });

    test("dice: sep: survives unique, prop: and an empty glue", () => {
        expect(
            translateDiceExpression("3#npc|unique|sep:<br>|link").expr
        ).toBe("3#npc|unique|sep:<br>|link");
        expect(
            translateDiceExpression(
                "3*|folder=Bestiary|sep:<br>|prop:{{name}} CR {{cr}}"
            ).expr
        ).toBe("3*|folder=Bestiary|sep:<br>|prop:{{name}} CR {{cr}}");
        // `sep:` with nothing after it is a real glue (join with
        // nothing), not an absent one — it must not be dropped as an
        // unknown word segment.
        expect(translateDiceExpression("3#monster|sep:|link").expr).toBe(
            "3#monster|sep:|link"
        );
    });

    // The glue may contain brackets, which the table-roller pattern
    // forbids in a suffix. Before the peel moved up into
    // translateDiceExpression this fell through to the formula
    // branch and produced `{3[[Note^loot]]|sep:] [}` — no error, just
    // a nonsense formula downstream.
    test("dice: a glue containing brackets still parses as a roller", () => {
        expect(translateDiceExpression("3[[Note^loot]]|sep:] [").expr).toBe(
            "3[[Note^loot]]|sep:] ["
        );
        expect(translateDiceExpression("3[[Note^loot]]|sep:[x]").expr).toBe(
            "3[[Note^loot]]|sep:[x]"
        );
    });

    // Claimed in the CHANGELOG ("line and block rolls") but only
    // asserted at the parse layer before — this runs it.
    test("wikilink roll: sep: joins a whole-note block roll", () => {
        const files = {
            "Session/Rumours.md": "first rumour\n\nsecond rumour\n\nthird rumour\n",
        };
        const out = roll("3[[Rumours|block]]|sep:<br>", 11, files);
        expect(out.split("<br>")).toHaveLength(3);
        expect(out).not.toContain(", ");
    });

    // "Separator text is never evaluated" was only checked against the
    // generated call string. This is the claim itself: the glue comes
    // out of the engine as literal text.
    test("a glue full of engine syntax renders as itself", () => {
        const files = {
            "Session/Loot.md": ["| Loot |", "| --- |", "| a ring |", "", "^loot", ""].join("\n"),
        };
        const out = roll("3[[Loot^loot]]|sep: [@x] {1d6} ", 12, files);
        expect(out).toBe("a ring [@x] {1d6}a ring [@x] {1d6}a ring");
    });

    // The trap the docs now call out explicitly: a trailing space is
    // trimmed off the whole expression before sep: ever sees it, so a
    // glue that should end in a space needs `\_`.
    test("a trailing space in the glue needs \\_ to survive", () => {
        const files = {
            "Session/Loot.md": ["| Loot |", "| --- |", "| a ring |", "", "^loot", ""].join("\n"),
        };
        expect(roll("3[[Loot^loot]]|sep: /", 13, files)).toBe(
            "a ring /a ring /a ring"
        );
        expect(roll("3[[Loot^loot]]|sep: /\\_", 13, files)).toBe(
            "a ring / a ring / a ring"
        );
    });
});
