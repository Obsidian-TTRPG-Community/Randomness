/**
 * Dice Roller compatibility — merge Phase 3, first slice.
 *
 * Translates the syntax of @javalent/dice-roller (MIT, © Jeremy
 * Valentine) into rdm-engine expressions, so existing notes written
 * for that plugin render unchanged once its prefixes (`dice:`,
 * `dice+:`, `dice-:`, `dice-mod:`) are routed through the Randomness
 * inline pipeline. One engine, two syntaxes — this module is pure
 * string-to-string translation with no evaluation of its own.
 *
 * Supported here:
 *   - Dice formulas with full order-of-operations, all modifiers
 *     (`kh`/`kl`/`dl`/`dh`, `!`, `!!`, `r`, `s`, `u`), special dice
 *     (`d%`, `dXX%`, `dF`, `d[Y,Z]`), and Dice Roller's *bare* dice
 *     conditions: `3d6>=5` means success counting there, so it is
 *     rewritten to the rdm grammar's explicit `cs` marker
 *     (`3d6cs>=5`). Spaces are stripped first, as Dice Roller does.
 *   - Omitted values: `d20` rolls one die, `3d` rolls d100s
 *     (Dice Roller's documented defaults).
 *   - Table/list rollers: `[[Note^block-id]]` with optional
 *     repetitions (`3[[Note^id]]`, `1d4+1[[Note^id]]`, legacy
 *     `2d[[Note^id]]` = 2 rolls) and column picks (`|Header`, `|xy`).
 *     These translate to the rdm direct-wikilink form and resolve
 *     through the markdown-content table source (merge Phase 2).
 *   - Display flags (`|nodice`, `|form`, `|noform`, `|render`,
 *     `|norender`, `|avg`, `|none`, `|text(…)`) are accepted and
 *     stripped. They only affected presentation in Dice Roller; the
 *     roll itself is unchanged. They're reported back to the caller
 *     so a future display layer can honour them.
 *
 *   - Whole-note rolls (merge Phase 4): `[[Note]]` → random block,
 *     `[[Note]]|line` → random line (block-type filters approximate
 *     to the block roll), and tag rolls `#tag` / `#tag|link` (one
 *     random tagged note; backed by Obsidian's metadata cache, no
 *     Dataview needed).
 *
 * Not yet supported (clear errors instead of wrong results):
 *   - The every-file tag mode (`#tag|+`).
 *   - Fantasy AGE stunt dice (`dS`) and Genesys narrative dice —
 *     symbol displays, planned with the graphical layer (Phase 6).
 */

import { parseDiceModifiers } from "../engine/dice";

/** Thrown for Dice Roller syntax we can't honour yet. The message is
 * user-facing (rendered in the inline error span). */
export class DiceCompatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DiceCompatError";
    }
}

export interface DiceTranslation {
    /** Equivalent rdm expression, ready for the inline pipeline. */
    expr: string;
    /** Display flags stripped from the input (currently inert). */
    flags: string[];
}

/** Trailing display flags. `text(...)` may contain anything but parens. */
const FLAG_RE =
    /\|(nodice|dice|form|noform|render|norender|avg|none|paren|noparen|round|floor|ceil|noround|signed|text\([^()]*\))\s*$/i;

/**
 * Strip trailing Dice Roller display flags (`|form`, `|nodice`,
 * `|text(…)`, …) from an expression, returning the bare formula or
 * roller. Column picks (`|Header`) are NOT display flags, so they are
 * preserved. The inline renderer uses this to show a clean
 * `formula → result` for `|form` without the flag leaking in.
 */
export function stripDisplayFlags(expr: string): string {
    let s = expr.trim();
    for (;;) {
        const m = s.match(FLAG_RE);
        if (m === null) return s;
        s = s.slice(0, m.index).trimEnd();
    }
}

/**
 * Characters a bare dice formula may contain: digits, the dice
 * letters (`d`, `F`, `%`), modifier letters (`kh`/`kl`/`dl`/`dh`,
 * `r`, `s`, `u`, `i`, `cs`), arithmetic, comparisons, face-range
 * brackets, and spaces. Deliberately a whitelist — every character
 * of generator syntax (`{}`, `@`, `#`, `|`) is absent, so an
 * expression that is really a table call can never match.
 */
const BARE_FORMULA_CHARS = /^[0-9dDfFkKhHlLrRsSuUiIcC%!<>=+\-*/(),.[\] ]+$/;

/** At least one real die: `2d6`, `d20`, `1d%`, `4dF`, `1d[3,5]`. */
const HAS_DIE = /\d*[dD](\d+|%|[fF](?![a-zA-Z])|\[)/;

/**
 * Is this whole `rdm:` expression nothing but a dice formula?
 *
 * `rdm:` expressions mix literal text with calls, so dice normally
 * live in `{…}` — which means `` `rdm:2d10` `` used to render the
 * literal text "2d10", silently. Anyone writing that means the roll
 * (it's the `dice:` grammar, where the formula IS the expression),
 * so we treat it as `{2d10}`.
 *
 * Returns the braced expression, or null to leave the text alone.
 * The test is deliberately narrow: the whole expression must be a
 * formula. Mixed text like `you take 2d6` keeps its old meaning,
 * because there the literal reading is a real possibility.
 */
export function braceBareFormula(expr: string): string | null {
    const s = expr.trim();
    if (s === "") return null;
    // Face ranges are the one construct with brackets; drop them
    // before the charset test so a stray `[` elsewhere still fails.
    const withoutRanges = s.replace(/\[\s*-?\d+\s*,\s*-?\d+\s*\]/g, "");
    if (withoutRanges.includes("[") || withoutRanges.includes("]")) {
        return null;
    }
    if (!BARE_FORMULA_CHARS.test(s)) return null;
    if (!HAS_DIE.test(s)) return null;
    // Brace it for the NATIVE grammar rather than routing through
    // translateDiceExpression: this is an `rdm:` span, and the two
    // grammars disagree about a bare comparison. `{3d6>=10}` is 1
    // when the total reaches 10 here, where Dice Roller reads it as
    // success counting. Going native keeps `rdm:3d6>=10` and
    // `rdm:{3d6>=10}` the same roll, which is the whole point.
    //
    // The one thing worth normalising is Dice Roller's omitted count,
    // since someone arriving from that syntax will type `d20`:
    // the native parser wants `1d20`.
    const withCount = s.replace(
        /(^|[^0-9A-Za-z_)\]])([dD])(?=[0-9%fF[])/g,
        (_m, before: string, d: string) => `${before}1${d}`
    );
    return `{${withCount}}`;
}

/**
 * Translate a Dice Roller expression (the text after the `dice:`
 * prefix) into an rdm expression. Throws DiceCompatError with a
 * user-facing message for unsupported constructs.
 */
export function translateDiceExpression(
    raw: string,
    aliases?: Record<string, string>
): DiceTranslation {
    let s = raw.trim();
    const flags: string[] = [];
    const stripFlags = () => {
        for (;;) {
            const m = s.match(FLAG_RE);
            if (!m) break;
            flags.unshift(m[1]);
            s = s.slice(0, m.index).trimEnd();
        }
    };
    // Strip trailing display flags, innermost-last.
    stripFlags();

    // Formula aliases (Dice Roller's settings-defined formulas): when
    // the whole expression matches an alias, substitute its formula
    // and continue translating. One substitution pass only — aliases
    // don't reference other aliases. The alias's own flags are
    // stripped and honoured too.
    if (aliases) {
        const key = Object.keys(aliases).find(
            (k) => k.trim().toLowerCase() === s.toLowerCase()
        );
        if (key !== undefined) {
            s = aliases[key].trim();
            stripFlags();
        }
    }

    // Tag rolls, with the same optional repetition prefix the table
    // roller below accepts (`3#rumour`, `{1d4}#rumour|link`).
    if (/^(?:\d+|\{[^{}]+\})?\s*#/.test(s)) {
        return { expr: translateTagRoller(s), flags };
    }

    // Table roller: optional repetitions, then a wikilink, then an
    // optional |column pick.
    const table = s.match(/^(.*?)\[\[([^[\]]+)\]\]([^[\]]*)$/);
    if (table) {
        return {
            expr: translateTableRoller(
                table[1].trim(),
                table[2].trim(),
                table[3].trim()
            ),
            flags,
        };
    }

    return { expr: "{" + translateFormula(s) + "}", flags };
}

// ────────────────────────────────────────────────────────────────────
// Table rollers
// ────────────────────────────────────────────────────────────────────

function translateTableRoller(
    repsRaw: string,
    inner: string,
    suffix: string
): string {
    const link = inner.match(
        /^([^#|^]+?)\s*(?:#[^|^]*)?(?:\^([A-Za-z0-9-]+))?$/
    );
    const file = link?.[1]?.trim();
    const blockId = link?.[2];
    if (!file) {
        throw new DiceCompatError(`Unrecognised wikilink: '[[${inner}]]'`);
    }

    let column = "";
    if (suffix !== "") {
        const sm = suffix.match(/^\|(.+)$/);
        if (!sm) {
            throw new DiceCompatError(
                `Unrecognised text after the wikilink: '${suffix}'`
            );
        }
        column = sm[1].trim();
    }

    if (!blockId) {
        // Whole-note roll (Dice Roller's section/line rollers).
        // `|line` picks a random line; anything else — including the
        // old block-type filters (`|paragraph`, `|heading`, …) —
        // approximates to a random block.
        const kind = /^line$/i.test(column) ? "line" : "block";
        return withReps(repsRaw, `[[${file}|${kind}]]`);
    }
    if (/^line$/i.test(column)) {
        // `[[Note^id]]|line` — Dice Roller treated |line as whole-note.
        return withReps(repsRaw, `[[${file}|line]]`);
    }

    const target = `[[${file}^${blockId}${column ? "|" + column : ""}]]`;
    return withReps(repsRaw, target);
}

/** Prepend a translated repetition prefix to a direct-call target. */
function withReps(repsRaw: string, target: string): string {
    let reps = "";
    if (repsRaw !== "") {
        const plain = repsRaw.match(/^(\d+)$/);
        const legacy = repsRaw.match(/^(\d+)d$/i); // Xd == X rolls
        if (plain) reps = plain[1];
        else if (legacy) reps = legacy[1];
        else reps = "{" + translateFormula(repsRaw) + "}";
    }
    return reps === "" || reps === "1" ? target : `${reps}${target}`;
}

/**
 * Tag rolls: `#tag` → random block from a random tagged note (Dice
 * Roller's `|-` single-note mode, our only mode); `#tag|link` → link
 * to a random tagged note (shown as its name), `#tag|linkpath` → the
 * same shown as the full path. `|+` (a result from EVERY tagged file) has
 * no equivalent yet. Block-type filters approximate to the block roll.
 * Randomness filter segments (`|#tag`, `|prop=value`) pass through
 * unchanged so they work under the dice: prefix too.
 */
function translateTagRoller(s: string): string {
    // Repetition prefix rides along untouched — `rdm:` parses it with
    // the same grammar, so there's nothing to translate.
    const rep = s.match(/^(\d+|\{[^{}]+\})\s*(?=#)/);
    if (rep) return rep[1] + translateTagRoller(s.slice(rep[0].length));
    // A `prop:` template owns the rest of the expression (pipes and
    // all), so translate only what precedes it and re-attach it
    // verbatim. Without this the template's segments would be read as
    // Dice Roller block-type filters and silently dropped.
    const propAt = s.toLowerCase().indexOf("|prop:");
    if (propAt >= 0) {
        // A template supersedes any link mode in the head (`{{link}}`
        // is how a template asks for one), so don't re-emit it.
        const head = translateTagRoller(s.slice(0, propAt)).replace(
            /\|link(path)?$/i,
            ""
        );
        return head + s.slice(propAt);
    }
    const m = s.match(/^#([^|\s]+)((?:\|[^|]*)*)$/);
    if (!m) {
        throw new DiceCompatError(`Unrecognised tag roll: '${s}'`);
    }
    const tagName = m[1];
    const suffixes = (m[2] ?? "")
        .split("|")
        .map((x) => x.trim())
        .filter((x) => x !== "");
    let linkMode: "" | "link" | "linkpath" = "";
    let unique = false;
    const filters: string[] = [];
    for (const suf of suffixes) {
        const low = suf.toLowerCase();
        if (low === "+") {
            throw new DiceCompatError(
                "The every-file tag mode (#tag|+) isn't supported yet — " +
                    "#tag rolls one result from one random tagged note."
            );
        }
        if (low === "link" || low === "linkpath") {
            linkMode = low;
            continue;
        }
        if (low === "unique") {
            // Randomness-native, not Dice Roller: pass it through so
            // the no-repeat draw survives the dice: prefix.
            unique = true;
            continue;
        }
        if (suf.startsWith("#") || suf.includes("=")) {
            filters.push(suf);
            continue;
        }
        // Block-type filters (`paragraph`, `-`, …) approximate to the
        // default block roll: drop them.
    }
    let out = `#${tagName}`;
    for (const f of filters) out += `|${f}`;
    if (unique) out += "|unique";
    if (linkMode) out += `|${linkMode}`;
    return out;
}

// ────────────────────────────────────────────────────────────────────
// Formulas
// ────────────────────────────────────────────────────────────────────

function translateFormula(raw: string): string {
    // Dice Roller strips all whitespace before parsing.
    let s = raw.replace(/\s+/g, "");
    if (s === "") {
        throw new DiceCompatError("Empty dice formula.");
    }

    if (/(^|\d)dS/.test(s)) {
        throw new DiceCompatError(
            "Fantasy AGE stunt dice (dS) aren't supported yet — they " +
                "arrive with the dice-display layer in a later phase."
        );
    }

    // Omitted roll count: a `d` at the start or after an operator
    // rolls one die (`d20` → `1d20`).
    s = s.replace(
        /(^|[^0-9A-Za-z_\])])[dD](?=[0-9%F[])/g,
        (_m, before: string) => before + "1d"
    );

    // Omitted faces: `3d` rolls d100s. The negative lookahead keeps
    // real faces (`d6`), special dice (`d%`, `dF`, `d[`), and the
    // dl/dh drop modifiers (whose `d` also follows a digit) intact.
    s = s.replace(/(\d)[dD](?![0-9%F[lh])/g, "$1d100");

    // Bare dice conditions are success counting in Dice Roller;
    // the rdm grammar requires the explicit `cs` marker (bare
    // comparisons keep their IPP3 sum-comparison meaning there).
    s = insertSuccessMarkers(s);

    return s;
}

const DICE_TERM_RE =
    /(\d+(?:\.\d+)?)[dD](\d+%?|%|F|\[-?\d+,-?\d+\])/g;
const CONDITION_RE = /^(<=|>=|=!|=-|-=|<|>|=)(-?\d+)/;

/**
 * Insert `cs` before bare condition chains that directly follow a
 * dice term (after any modifiers). Conditions belonging to explode/
 * re-roll modifiers are consumed by the shared modifier scanner and
 * left alone; an explicit `cs` in the input is likewise untouched.
 */
function insertSuccessMarkers(s: string): string {
    let out = "";
    let last = 0;
    DICE_TERM_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DICE_TERM_RE.exec(s)) !== null) {
        if (m.index < last) continue; // inside an already-consumed span
        const afterDice = m.index + m[0].length;
        // Walk the modifier suffix with the engine's own scanner so
        // modifier conditions (`!i=!3`, `r<3`) and explicit `cs` are
        // consumed, not re-marked.
        const { pos } = parseDiceModifiers(s, afterDice);
        let p = pos;
        let any = false;
        for (;;) {
            const cm = s.slice(p).match(CONDITION_RE);
            if (!cm) break;
            any = true;
            p += cm[0].length;
        }
        if (any) {
            out += s.slice(last, pos) + "cs" + s.slice(pos, p);
            last = p;
            DICE_TERM_RE.lastIndex = p;
        }
    }
    return out + s.slice(last);
}
