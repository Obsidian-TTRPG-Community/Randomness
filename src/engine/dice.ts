/**
 * Dice core — modifiers, conditions, and special dice.
 *
 * Part of the Dice Roller merge (docs/dice-roller-merge-plan.md, Phase 1).
 * Modifier semantics ported from @javalent/dice-roller (MIT, © Jeremy
 * Valentine), reimplemented for the Randomness engine so that codeblocks,
 * inline `rdm:` calls, the future `dice:` compat surface, and the JS API
 * all share one implementation.
 *
 * Supported suffixes after `NdN` (must be adjacent — no whitespace):
 *   k / kh{n} / kl{n}   keep highest/lowest {n} (default 1)
 *   dl{n} / dh{n}       drop lowest/highest {n} (default 1)
 *   !{n|i}              explode: extra die per max roll, chained {n} times
 *   !!{n|i}             explode & combine (numerically identical to !)
 *   r{n|i}              re-roll minimum rolls, up to {n} times
 *   s / sa / sd         sort results ascending/descending
 *   u                   re-roll until all results are unique
 *   cs<cond>...         count successes: each die scores +1 if it meets any
 *                       condition, -1 on a `-=`/`=-` condition, else 0
 *
 * Explode and re-roll accept optional trailing conditions (`!i=!3`, `r<3`)
 * that replace their default trigger. Conditions chain and are OR'd.
 *
 * Special faces (parsed by the expression grammar, rolled here):
 *   d%        percentile — d100 per die
 *   dF        Fudge/Fate — faces −1, 0, +1
 *   d[Y,Z]    custom face range Y..Z
 *
 * Design constraints:
 *   - Success counting requires the explicit `cs` marker in this grammar.
 *     Bare `3d6>=5` keeps its IPP3 meaning (sum comparison) — the `dice:`
 *     compat parser (merge Phase 3) accepts Dice Roller's bare form.
 *   - A plain unmodified `NdN` roll consumes the RNG stream identically to
 *     the pre-merge engine (one rollDie per die), so seeded corpus output
 *     is unchanged.
 *   - Modifiers apply in declaration order; keep/drop always applies last;
 *     success conditions score after everything else (mirrors Dice Roller).
 */

import { RNG } from "./rng";

// ─────────────────────── Types ───────────────────────

export interface DieDetail {
    /** Final value of this die. */
    value: number;
    /** False when removed by keep/drop. Dropped dice don't count. */
    kept: boolean;
    /** True when this die was added by an explosion. */
    exploded: boolean;
    /** True when this die was re-rolled (r or u). */
    rerolled: boolean;
}

export type CondOp = "=" | "=!" | ">" | "<" | ">=" | "<=" | "-=";

export interface DiceCondition {
    op: CondOp;
    n: number;
}

export type FaceSpec =
    | { kind: "sides"; sides: number }
    | { kind: "range"; min: number; max: number }
    | { kind: "fudge" };

interface KeepMod { type: "kh" | "kl" | "dl" | "dh"; n: number; }
interface ExplodeMod { times: number; conditions: DiceCondition[]; }
interface RerollMod { times: number; conditions: DiceCondition[]; }

/** One entry per modifier, in declaration order (keep/drop excluded). */
type OrderedMod =
    | { type: "explode"; mod: ExplodeMod }
    | { type: "reroll"; mod: RerollMod }
    | { type: "unique" }
    | { type: "sort"; dir: "a" | "d" };

export interface DiceModifiers {
    ordered: OrderedMod[];
    keep?: KeepMod;
    /** Present when `cs` was used — total becomes a success count. */
    successes?: DiceCondition[];
}

export interface DiceRollOutcome {
    /** Sum of kept dice, or success count when `cs` is present. */
    total: number;
    /** Per-die detail, for tooltips / future display work. */
    dice: DieDetail[];
}

/**
 * One dice term captured during an evaluation, in roll order. The
 * evaluator reports these through EvaluatorOptions.onDice so the UI
 * can show what each die rolled instead of only the sum (Ironsworn
 * challenge dice, stat arrays, …).
 */
export interface DiceTraceEntry {
    /** The term as written in the expression, e.g. "4d6dl1". */
    notation: string;
    /** The term's contribution (sum of kept dice / success count). */
    total: number;
    dice: DieDetail[];
}

/**
 * Long form of one trace entry: `4d6dl1 → 5, 3, (1), 6`. Dropped
 * dice are parenthesised, exploded dice marked with `!`, re-rolled
 * dice with `r`.
 */
export function formatDiceTraceEntry(e: DiceTraceEntry): string {
    return `${e.notation} → ${diceFaceList(e.dice)}`;
}

/** Long form of a whole trace, entries joined with `; `. */
export function formatDiceBreakdown(entries: DiceTraceEntry[]): string {
    return entries.map(formatDiceTraceEntry).join("; ");
}

/**
 * Compact face list for visible display next to a result: one term
 * gives `7, 3`; several give `2d10: 7, 3; 1d6: 4`.
 */
export function formatDiceFacesInline(entries: DiceTraceEntry[]): string {
    if (entries.length === 1) return diceFaceList(entries[0].dice);
    return entries
        .map((e) => `${e.notation}: ${diceFaceList(e.dice)}`)
        .join("; ");
}

function diceFaceList(dice: DieDetail[]): string {
    return dice
        .map((d) => {
            let s = String(d.value);
            if (d.exploded) s += "!";
            if (d.rerolled) s += "r";
            if (!d.kept) s = `(${s})`;
            return s;
        })
        .join(", ");
}

/** Cap for `i` (infinite) explode/re-roll and for unique attempts. */
const INFINITE_CAP = 100;

// ─────────────────────── Suffix parser ───────────────────────

/**
 * Parse dice modifier suffixes starting at `pos`. Returns the modifiers
 * (null when none present) and the position after the last one consumed.
 * Only consumes text it fully recognises — anything else is left for the
 * caller's grammar to reject exactly as it did before the merge.
 */
export function parseDiceModifiers(
    source: string,
    pos: number
): { mods: DiceModifiers | null; pos: number } {
    const mods: DiceModifiers = { ordered: [] };
    let found = false;

    const readInt = (): number | null => {
        let s = "";
        while (pos < source.length && /[0-9]/.test(source[pos])) {
            s += source[pos];
            pos++;
        }
        return s === "" ? null : parseInt(s, 10);
    };

    /** Parse `{n}` or `i` after ! / !! / r. Default 1. */
    const readTimes = (): number => {
        if (source[pos] === "i") {
            pos++;
            return INFINITE_CAP;
        }
        return readInt() ?? 1;
    };

    /** Parse a chain of conditions. Returns [] when none found. */
    const readConditions = (): DiceCondition[] => {
        const out: DiceCondition[] = [];
        while (pos < source.length) {
            let op: CondOp | null = null;
            if (source.startsWith("<=", pos)) { op = "<="; pos += 2; }
            else if (source.startsWith(">=", pos)) { op = ">="; pos += 2; }
            else if (source.startsWith("=!", pos)) { op = "=!"; pos += 2; }
            else if (source.startsWith("-=", pos)) { op = "-="; pos += 2; }
            else if (source.startsWith("=-", pos)) { op = "-="; pos += 2; }
            else if (source[pos] === "<") { op = "<"; pos += 1; }
            else if (source[pos] === ">") { op = ">"; pos += 1; }
            else if (source[pos] === "=") { op = "="; pos += 1; }
            if (!op) break;
            let neg = false;
            if (source[pos] === "-") { neg = true; pos++; }
            const n = readInt();
            if (n === null) {
                // Not a condition after all (e.g. `=` of a comparison with
                // a non-numeric operand). Rewind the operator and stop.
                pos -= op.length + (neg ? 1 : 0);
                break;
            }
            out.push({ op, n: neg ? -n : n });
        }
        return out;
    };

    while (pos < source.length) {
        const start = pos;
        const ch = source[pos];

        // keep highest/lowest: k / kh{n} / kl{n}
        if (ch === "k") {
            pos++;
            let type: "kh" | "kl" = "kh";
            if (source[pos] === "h") { pos++; }
            else if (source[pos] === "l") { type = "kl"; pos++; }
            mods.keep = { type, n: readInt() ?? 1 };
            found = true;
            continue;
        }

        // drop lowest/highest: dl{n} / dh{n} — do NOT consume a bare `d`.
        if (ch === "d" && (source[pos + 1] === "l" || source[pos + 1] === "h")) {
            const type = source[pos + 1] === "l" ? "dl" : "dh";
            pos += 2;
            mods.keep = { type, n: readInt() ?? 1 };
            found = true;
            continue;
        }

        // explode (& combine): ! / !!  + optional times + optional conditions
        if (ch === "!") {
            pos++;
            if (source[pos] === "!") pos++; // !! is numerically identical
            const times = readTimes();
            const conditions = readConditions();
            mods.ordered.push({ type: "explode", mod: { times, conditions } });
            found = true;
            continue;
        }

        // re-roll: r + optional times + optional conditions
        if (ch === "r") {
            pos++;
            const times = readTimes();
            const conditions = readConditions();
            mods.ordered.push({ type: "reroll", mod: { times, conditions } });
            found = true;
            continue;
        }

        // sort: s / sa / sd
        if (ch === "s") {
            pos++;
            let dir: "a" | "d" = "a";
            if (source[pos] === "a") { pos++; }
            else if (source[pos] === "d") { dir = "d"; pos++; }
            mods.ordered.push({ type: "sort", dir });
            found = true;
            continue;
        }

        // unique: u
        if (ch === "u") {
            pos++;
            mods.ordered.push({ type: "unique" });
            found = true;
            continue;
        }

        // count successes: cs + conditions (at least one required)
        if (ch === "c" && source[pos + 1] === "s") {
            pos += 2;
            const conditions = readConditions();
            if (conditions.length === 0) {
                pos = start; // `cs` with no condition isn't ours — rewind
                break;
            }
            mods.successes = conditions;
            found = true;
            continue;
        }

        break;
    }

    return { mods: found ? mods : null, pos };
}

// ─────────────────────── Roller ───────────────────────

function faceMin(faces: FaceSpec): number {
    switch (faces.kind) {
        case "sides": return 1;
        case "range": return faces.min;
        case "fudge": return -1;
    }
}

function faceMax(faces: FaceSpec): number {
    switch (faces.kind) {
        case "sides": return faces.sides;
        case "range": return faces.max;
        case "fudge": return 1;
    }
}

function rollOne(faces: FaceSpec, rng: RNG): number {
    switch (faces.kind) {
        case "sides": return rng.rollDie(faces.sides);
        case "range": return rng.intInclusive(faces.min, faces.max);
        case "fudge": return rng.intInclusive(-1, 1);
    }
}

function matches(value: number, cond: DiceCondition): boolean {
    switch (cond.op) {
        case "=": return value === cond.n;
        case "=!": return value !== cond.n;
        case ">": return value > cond.n;
        case "<": return value < cond.n;
        case ">=": return value >= cond.n;
        case "<=": return value <= cond.n;
        case "-=": return value === cond.n;
    }
}

function matchesAny(value: number, conds: DiceCondition[]): boolean {
    return conds.some((c) => matches(value, c));
}

/**
 * Roll `count` dice with the given faces and modifiers.
 *
 * When `mods` is null this consumes the RNG stream exactly like the
 * pre-merge engine (`RNG.rollDice`): one `rollDie` per die, in order.
 * The float-count quirk (`2.5d6` rolls 3 dice) is preserved.
 */
export function rollModifiedDice(
    count: number,
    faces: FaceSpec,
    mods: DiceModifiers | null,
    rng: RNG
): DiceRollOutcome {
    const dice: DieDetail[] = [];
    for (let i = 0; i < count; i++) {
        dice.push({ value: rollOne(faces, rng), kept: true, exploded: false, rerolled: false });
    }

    if (mods) {
        for (const m of mods.ordered) {
            switch (m.type) {
                case "reroll": applyReroll(dice, faces, m.mod, rng); break;
                case "explode": applyExplode(dice, faces, m.mod, rng); break;
                case "unique": applyUnique(dice, faces, rng); break;
                case "sort":
                    dice.sort((a, b) => (m.dir === "a" ? a.value - b.value : b.value - a.value));
                    break;
            }
        }
        if (mods.keep) applyKeep(dice, mods.keep);
    }

    let total: number;
    if (mods?.successes) {
        const negs = mods.successes.filter((c) => c.op === "-=");
        const pos = mods.successes.filter((c) => c.op !== "-=");
        total = 0;
        for (const d of dice) {
            if (!d.kept) continue;
            if (matchesAny(d.value, negs)) total -= 1;
            else if (matchesAny(d.value, pos)) total += 1;
        }
    } else {
        total = dice.reduce((sum, d) => (d.kept ? sum + d.value : sum), 0);
    }

    return { total, dice };
}

function applyReroll(dice: DieDetail[], faces: FaceSpec, mod: RerollMod, rng: RNG) {
    const conds: DiceCondition[] =
        mod.conditions.length > 0 ? mod.conditions : [{ op: "=", n: faceMin(faces) }];
    for (const d of dice) {
        let attempts = 0;
        while (matchesAny(d.value, conds) && attempts < mod.times) {
            d.value = rollOne(faces, rng);
            d.rerolled = true;
            attempts++;
        }
    }
}

function applyExplode(dice: DieDetail[], faces: FaceSpec, mod: ExplodeMod, rng: RNG) {
    const conds: DiceCondition[] =
        mod.conditions.length > 0 ? mod.conditions : [{ op: "=", n: faceMax(faces) }];
    // Iterate over the original dice only; insert exploded dice after their
    // source so detail order reads naturally.
    const originals = dice.length;
    let inserted = 0;
    for (let i = 0; i < originals; i++) {
        const idx = i + inserted;
        if (!matchesAny(dice[idx].value, conds)) continue;
        let chain = 0;
        let lastValue = dice[idx].value;
        while (matchesAny(lastValue, conds) && chain < mod.times) {
            lastValue = rollOne(faces, rng);
            inserted++;
            chain++;
            dice.splice(idx + chain, 0, {
                value: lastValue, kept: true, exploded: true, rerolled: false,
            });
        }
    }
}

function applyUnique(dice: DieDetail[], faces: FaceSpec, rng: RNG) {
    // Impossible to make unique when there are more dice than faces.
    const span = faceMax(faces) - faceMin(faces) + 1;
    if (dice.length > span) return;
    let attempts = 0;
    while (attempts < INFINITE_CAP) {
        const seen = new Set<number>();
        let dup: DieDetail | null = null;
        for (const d of dice) {
            if (seen.has(d.value)) { dup = d; break; }
            seen.add(d.value);
        }
        if (!dup) return;
        dup.value = rollOne(faces, rng);
        dup.rerolled = true;
        attempts++;
    }
}

function applyKeep(dice: DieDetail[], keep: KeepMod) {
    // Normalise drop-forms into keep-forms.
    const n = keep.n;
    const keepCount =
        keep.type === "kh" || keep.type === "kl"
            ? Math.min(n, dice.length)
            : Math.max(dice.length - n, 0);
    const highest = keep.type === "kh" || keep.type === "dl";

    const byValue = dice
        .map((d, i) => ({ d, i }))
        .sort((a, b) => (highest ? b.d.value - a.d.value : a.d.value - b.d.value));
    const kept = new Set(byValue.slice(0, keepCount).map((x) => x.i));
    dice.forEach((d, i) => { d.kept = kept.has(i); });
}
