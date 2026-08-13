/**
 * Tests for Dice Roller compatibility — merge Phase 3, first slice.
 *
 * Layers:
 *   1. translateDiceExpression: formulas (defaults, modifiers, bare
 *      success conditions → `cs`), table rollers with repetitions and
 *      column picks, flags, and friendly errors for the unsupported.
 *   2. Multi-prefix lockingService: parse/serialise round-trips, lock
 *      targeting that distinguishes `rdm:` from `dice:` spans.
 *   3. End-to-end: a translated `dice:` expression rolls through the
 *      inline scope pipeline.
 */

import {
    translateDiceExpression,
    stripDisplayFlags,
    braceBareFormula,
    DiceCompatError,
} from "../../src/compat/diceCompat";
import {
    parseInlineCall,
    serialiseInlineCall,
    applyLockToSource,
    transformAllInlineCalls,
    findAllInlineCallPositions,
    matchInlinePrefix,
    callKey,
    evalSourceOf,
    INLINE_PREFIX,
} from "../../src/views/lockingService";
import { parseDirectWikilinkCall } from "../../src/resolver/mdContent";
import { inMemorySource } from "../../src/resolver/fileResolver";
import { buildInlineBundle } from "../../src/resolver/scope";
import { Evaluator } from "../../src/engine/evaluator";

const t = (s: string) => translateDiceExpression(s).expr;

// ─── Formula translation ───

describe("translateDiceExpression: formulas", () => {
    test("plain formulas wrap in braces, spaces stripped", () => {
        expect(t("1d20 + 5")).toBe("{1d20+5}");
        expect(t("3d4+3d4-(3d4 * 1d4) - 2^1d7")).toBe(
            "{3d4+3d4-(3d4*1d4)-2^1d7}"
        );
        expect(t("42")).toBe("{42}");
    });

    test("omitted roll count and faces get Dice Roller defaults", () => {
        expect(t("d20")).toBe("{1d20}");
        expect(t("3d")).toBe("{3d100}");
        expect(t("3d + 2")).toBe("{3d100+2}");
        expect(t("d%")).toBe("{1d%}");
        expect(t("dF")).toBe("{1dF}");
        expect(t("1d6+d4")).toBe("{1d6+1d4}");
    });

    test("faces default never mangles dl/dh modifiers", () => {
        expect(t("4d6dl1")).toBe("{4d6dl1}");
        expect(t("4d6dh")).toBe("{4d6dh}");
        expect(t("2d20kh")).toBe("{2d20kh}");
    });

    test("bare dice conditions become explicit cs success counting", () => {
        expect(t("3d6>=5")).toBe("{3d6cs>=5}");
        expect(t("1d20=20")).toBe("{1d20cs=20}");
        expect(t("3d6>=5-=1")).toBe("{3d6cs>=5-=1}");
        expect(t("2d20kh>=15")).toBe("{2d20khcs>=15}");
    });

    test("modifier conditions are NOT re-marked as cs", () => {
        expect(t("1d4!=3")).toBe("{1d4!=3}");
        expect(t("1d4!i=!3")).toBe("{1d4!i=!3}");
        expect(t("1d4r<3")).toBe("{1d4r<3}");
        expect(t("1d4r<2>3")).toBe("{1d4r<2>3}");
    });

    test("explicit cs in input is left alone", () => {
        expect(t("3d6cs>=5")).toBe("{3d6cs>=5}");
    });

    test("arithmetic minus is not mistaken for a condition", () => {
        expect(t("3d6-1")).toBe("{3d6-1}");
        expect(t("3d6-1d4")).toBe("{3d6-1d4}");
    });

    test("special dice pass through", () => {
        expect(t("1d66%")).toBe("{1d66%}");
        expect(t("4dF")).toBe("{4dF}");
        expect(t("1d[3,5]")).toBe("{1d[3,5]}");
    });

    test("display flags are stripped and reported", () => {
        const r = translateDiceExpression("1d20 + 2|nodice|text(Dexterity +2)");
        expect(r.expr).toBe("{1d20+2}");
        expect(r.flags).toEqual(["nodice", "text(Dexterity +2)"]);
        expect(t("2d6|render")).toBe("{2d6}");
        expect(t("2d6+3|avg")).toBe("{2d6+3}");
    });

    test("unsupported constructs throw friendly errors", () => {
        expect(() => t("#tag|+")).toThrow(/every-file/i);
        expect(() => t("1dS")).toThrow(/stunt/i);
        expect(() => t("")).toThrow(DiceCompatError);
    });
});

// ─── Table rollers ───

describe("translateDiceExpression: table rollers", () => {
    test("plain and repeated wikilink rolls", () => {
        expect(t("[[Note^loot]]")).toBe("[[Note^loot]]");
        expect(t("3[[Note^loot]]")).toBe("3[[Note^loot]]");
        expect(t("2d[[Note^loot]]")).toBe("2[[Note^loot]]"); // legacy Xd = X
        expect(t("1d4+1[[Note^loot]]")).toBe("{1d4+1}[[Note^loot]]");
    });

    test("column picks survive", () => {
        expect(t("[[Note^npcs]]|Header 2")).toBe("[[Note^npcs|Header 2]]");
        expect(t("[[Note^npcs]]|xy")).toBe("[[Note^npcs|xy]]");
    });

    test("flags on table rollers are stripped", () => {
        expect(t("3[[Note^loot]]|nodice")).toBe("3[[Note^loot]]");
    });

    test("whole-note, line, and tag rolls translate (Phase 4)", () => {
        expect(t("[[Note]]")).toBe("[[Note|block]]");
        expect(t("[[Note^id]]|line")).toBe("[[Note|line]]");
        expect(t("#tag|paragraph")).toBe("#tag");
    });
});

// ─── Direct wikilink calls with repetitions ───

describe("parseDirectWikilinkCall with repetitions", () => {
    test("count and dice-expression prefixes", () => {
        expect(parseDirectWikilinkCall("3[[N^t]]")?.tableCall).toBe(
            "[@3 t >> implode]"
        );
        expect(parseDirectWikilinkCall("{1d4+1}[[N^t|xy]]")?.tableCall).toBe(
            "[@{1d4+1} t.xy >> implode]"
        );
        expect(parseDirectWikilinkCall("[[N^t]]")?.tableCall).toBe("[@t]");
        expect(parseDirectWikilinkCall("1[[N^t]]")?.tableCall).toBe("[@t]");
    });
});

// ─── Multi-prefix locking service ───

describe("multi-prefix inline calls", () => {
    test("a bare prefix is a literal mention, not a call", () => {
        // e.g. a heading containing `dice:` — must stay plain code.
        expect(parseInlineCall("dice:")).toBeNull();
        expect(parseInlineCall("dice: ")).toBeNull();
        expect(parseInlineCall("rdm:")).toBeNull();
        expect(parseInlineCall("rdm:⟹x")).toBeNull();
    });

    test("matchInlinePrefix recognises all prefixes", () => {
        expect(matchInlinePrefix("rdm:[@X]")).toBe("rdm:");
        expect(matchInlinePrefix("dice:1d20")).toBe("dice:");
        expect(matchInlinePrefix("dice+:1d20")).toBe("dice+:");
        expect(matchInlinePrefix("dice-:1d20")).toBe("dice-:");
        expect(matchInlinePrefix("dice-mod:1d20")).toBe("dice-mod:");
        expect(matchInlinePrefix("diceroll:1d20")).toBeNull();
    });

    test("parse/serialise round-trips preserve the prefix", () => {
        for (const text of [
            "dice:1d20+5",
            "dice-mod:3d6",
            "dice:[[Note^loot]]⟹a gem",
            "rdm:[@X]⟹y",
        ]) {
            const call = parseInlineCall(text)!;
            expect(serialiseInlineCall(call)).toBe(text);
        }
    });

    test("evalSourceOf translates only compat prefixes", () => {
        expect(evalSourceOf({ expr: "{1d20}", prefix: "rdm:" })).toBe("{1d20}");
        expect(evalSourceOf({ expr: "[@Names]" })).toBe("[@Names]"); // absent = rdm:
        expect(evalSourceOf({ expr: "3d6>=5", prefix: "dice:" })).toBe(
            "{3d6cs>=5}"
        );
        // A BARE formula is the exception: `rdm:1d20` used to render
        // the literal text "1d20", which only ever meant the author
        // forgot the braces. It is braced for the native grammar —
        // note the difference from the `dice:` line above, which
        // rewrites a bare comparison to success counting.
        expect(evalSourceOf({ expr: "1d20" })).toBe("{1d20}");
        expect(evalSourceOf({ expr: "3d6>=5" })).toBe("{3d6>=5}");
    });

    test("callKey separates same expression under different prefixes", () => {
        expect(callKey({ expr: "1d20", prefix: "dice:" })).not.toBe(
            callKey({ expr: "1d20", prefix: "rdm:" })
        );
        expect(callKey({ expr: "x" })).toBe(callKey({ expr: "x", prefix: "rdm:" }));
    });

    test("lock targeting distinguishes prefixes at the same expression", () => {
        const source = "roll `rdm:[[N^t]]` and `dice:[[N^t]]` here";
        const locked = applyLockToSource(source, "[[N^t]]", 0, "RESULT", "dice:");
        expect(locked).toBe(
            "roll `rdm:[[N^t]]` and `dice:[[N^t]]⟹RESULT` here"
        );
    });

    test("occurrence counting is per prefix+expr", () => {
        const source = "`dice:1d6` `rdm:1d6` `dice:1d6`";
        const positions = findAllInlineCallPositions(source);
        expect(positions.map((p) => p.occurrence)).toEqual([0, 0, 1]);
    });

    test("transformAllInlineCalls walks every prefix and keeps them", () => {
        const source = "`dice:1d6` and `rdm:[@X]`";
        const out = transformAllInlineCalls(source, (call) => ({
            ...call,
            locked: "L",
        }));
        expect(out).toBe("`dice:1d6⟹L` and `rdm:[@X]⟹L`");
    });
});

// ─── End-to-end through the inline pipeline ───

describe("dice: expressions roll end-to-end", () => {
    const TABLES = [
        "| Tavern |",
        "| ------ |",
        "| The Prancing Pony |",
        "",
        "^taverns",
    ].join("\n");

    function roll(diceExpr: string, seed = 1): string {
        const translated = evalSourceOf({ expr: diceExpr, prefix: "dice:" });
        const bundle = buildInlineBundle(translated, {
            notePath: "Vault/note.md",
            noteSource: "",
            source: inMemorySource({ "Vault/Tables.md": TABLES }),
        });
        return new Evaluator(bundle.main, bundle.extras, { seed }).run();
    }

    test("formula with modifiers", () => {
        for (let seed = 1; seed <= 50; seed++) {
            const v = Number(roll("2d20kh + 5", seed));
            expect(v).toBeGreaterThanOrEqual(6);
            expect(v).toBeLessThanOrEqual(25);
        }
    });

    test("success counting via bare conditions", () => {
        for (let seed = 1; seed <= 50; seed++) {
            const v = Number(roll("6d6>=1", seed));
            expect(v).toBe(6); // every die ≥ 1
        }
    });

    test("table roller with repetitions", () => {
        const out = roll("2[[Tables^taverns]]");
        // Two rolls of a one-item table, comma-joined for inline prose.
        expect(out).toBe("The Prancing Pony, The Prancing Pony");
    });
});


describe("stripDisplayFlags", () => {
    test("removes a trailing display flag", () => {
        expect(stripDisplayFlags("2d6+3|form")).toBe("2d6+3");
    });
    test("removes several stacked flags", () => {
        expect(stripDisplayFlags("1d20+2|nodice|text(Dex +2)")).toBe("1d20+2");
    });
    test("keeps a column pick (not a display flag)", () => {
        expect(stripDisplayFlags("[[Note^loot]]|Header")).toBe(
            "[[Note^loot]]|Header"
        );
    });
    test("strips a flag but keeps the column pick before it", () => {
        expect(stripDisplayFlags("[[Note^loot]]|Header|form")).toBe(
            "[[Note^loot]]|Header"
        );
    });
    test("leaves a flag-free expression unchanged", () => {
        expect(stripDisplayFlags("2d6+3")).toBe("2d6+3");
    });
});


// ─── Bare formulas in rdm: spans ───

describe("braceBareFormula", () => {
    test("a whole-expression formula is braced", () => {
        expect(braceBareFormula("2d10")).toBe("{2d10}");
        expect(braceBareFormula("1d20+5")).toBe("{1d20+5}");
        expect(braceBareFormula("2d6 + 3")).toBe("{2d6 + 3}");
        expect(braceBareFormula("2d6*10")).toBe("{2d6*10}");
        expect(braceBareFormula("1d4-1")).toBe("{1d4-1}");
    });

    test("modifiers and special dice survive", () => {
        expect(braceBareFormula("4d6dl1")).toBe("{4d6dl1}");
        expect(braceBareFormula("2d20kh")).toBe("{2d20kh}");
        expect(braceBareFormula("1d6!")).toBe("{1d6!}");
        expect(braceBareFormula("6d6cs>=5")).toBe("{6d6cs>=5}");
        expect(braceBareFormula("4dF")).toBe("{4dF}");
        expect(braceBareFormula("1d66%")).toBe("{1d66%}");
        expect(braceBareFormula("1d[3,5]")).toBe("{1d[3,5]}");
    });

    test("an omitted die count is filled in, Dice Roller style", () => {
        expect(braceBareFormula("d20")).toBe("{1d20}");
        expect(braceBareFormula("d%")).toBe("{1d%}");
        expect(braceBareFormula("2d6+d4")).toBe("{2d6+1d4}");
    });

    test("a bare comparison keeps NATIVE meaning, not success counting", () => {
        // translateDiceExpression would rewrite this to `3d6cs>=10`
        // (Dice Roller semantics). An rdm: span must mean what
        // `rdm:{3d6>=10}` means, so the text is braced as written.
        expect(braceBareFormula("3d6>=10")).toBe("{3d6>=10}");
    });

    test("generator syntax is never swallowed", () => {
        for (const expr of [
            "[@Names]",
            "[@npcs.Job]",
            "[[Note^loot]]",
            "[!deck]",
            "#rumour|link",
            "3#monster|unique",
            "*|folder=B|prop:cr",
            "{2d6}",
        ]) {
            expect(braceBareFormula(expr)).toBeNull();
        }
    });

    test("text is still text", () => {
        for (const expr of [
            "hello",
            "you take 2d6 damage",
            "the 2d6 hit",
            "1d4 sacks",
            "husk",
            "",
            "   ",
        ]) {
            expect(braceBareFormula(expr)).toBeNull();
        }
    });

    test("something without a real die is left alone", () => {
        // No roll to make — bracing these would change nothing but
        // could surprise someone who wanted the literal characters.
        expect(braceBareFormula("5")).toBeNull();
        expect(braceBareFormula("3+4")).toBeNull();
        expect(braceBareFormula("10d")).toBeNull();
        expect(braceBareFormula("2dX")).toBeNull();
    });
});

describe("evalSourceOf: bare formulas roll under rdm:", () => {
    test("a bare formula evaluates as if braced", () => {
        expect(evalSourceOf({ expr: "2d10" })).toBe("{2d10}");
        expect(evalSourceOf({ expr: "2d10", prefix: "rdm:" })).toBe("{2d10}");
    });

    test("everything else is passed through untouched", () => {
        expect(evalSourceOf({ expr: "[@Names]" })).toBe("[@Names]");
        expect(evalSourceOf({ expr: "{2d6} gold" })).toBe("{2d6} gold");
        expect(evalSourceOf({ expr: "hello" })).toBe("hello");
    });

    test("compat prefixes still go through the translator", () => {
        expect(evalSourceOf({ expr: "2d10", prefix: "dice:" })).toBe("{2d10}");
        expect(evalSourceOf({ expr: "3d6>=10", prefix: "dice:" })).toBe(
            "{3d6cs>=10}"
        );
    });
});
