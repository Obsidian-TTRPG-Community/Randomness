/**
 * Locking service — the preview/lock state machine for inline rdm: calls.
 *
 * The model (from STATUS.md): "preview-first, manual lock". Rendering
 * never mutates the note. The user sees a preview. If they want to
 * commit it, they click Lock and the note text changes from
 *
 *     `rdm:[@Names]`        (unfilled)
 * to
 *     `rdm:[@Names]⟹Alice`  (locked)
 *
 * "Reroll" on a locked call strips the `⟹result` suffix, returning to
 * unfilled. Subsequent renders treat it as fresh.
 *
 * The preview state lives in memory, keyed by (notePath, position,
 * expr). The point: re-rendering a note (scroll, edit elsewhere) must
 * show the SAME preview the user saw last time — otherwise locking
 * would commit a different value than what was on screen, which is
 * the bug this whole model exists to prevent.
 *
 * This module is pure logic. The DOM-touching processor lives in
 * `inlineProcessor.ts`; the lock-button click handler calls
 * `lockInline` here, which returns a transformed source string for
 * the processor to write back via `Vault.process`.
 */

import { translateDiceExpression } from "../compat/diceCompat";

// ────────────────────────────────────────────────────────────────────
// Text-level transforms — pure, no DOM, no state.
// ────────────────────────────────────────────────────────────────────

/**
 * The separator between an expression and its locked result. Chosen to
 * be visually obvious and unlikely to collide with generator output.
 *
 * The character is "⟹" (U+27F9, LONG RIGHTWARDS DOUBLE ARROW). Don't
 * confuse it with "⇒" (U+21D2, RIGHTWARDS DOUBLE ARROW) — both render
 * similarly in some fonts, but we use the longer one because it's
 * less common in regular prose.
 */
export const LOCK_SEPARATOR = "⟹";

/**
 * Inline trigger. Backtick-wrapped so it survives Obsidian's markdown
 * rendering as a code span — that's how the post-processor finds it.
 * The form is `rdm:EXPR` for unfilled and `rdm:EXPR⟹RESULT` for
 * locked.
 */
export const INLINE_PREFIX = "rdm:";

/**
 * Dice Roller compatibility prefixes (merge Phase 3). All four are
 * routed through the same pipeline; the expression is translated by
 * src/compat/diceCompat.ts at evaluation time. `dice+:` / `dice-:`
 * were Dice Roller's per-roll save toggles and `dice-mod:` its
 * note-modifying roll — locks subsume all three, so they alias to
 * plain `dice:` behaviour with the lock button available.
 */
export const DICE_COMPAT_PREFIXES = [
    "dice-mod:",
    "dice+:",
    "dice-:",
    "dice:",
] as const;

const ALL_PREFIXES: readonly string[] = [
    INLINE_PREFIX,
    ...DICE_COMPAT_PREFIXES,
];

/** Regex source matching any inline prefix (longest alternatives first). */
const PREFIX_ALTERNATION = "(?:rdm:|dice-mod:|dice\\+:|dice-:|dice:)";

/** Return the inline prefix `text` starts with, or null. */
export function matchInlinePrefix(text: string): string | null {
    for (const p of ALL_PREFIXES) {
        if (text.startsWith(p)) return p;
    }
    return null;
}

/**
 * Registry-key / identity string for a call: prefix + expression.
 * Two spans with the same expression under different prefixes are
 * different calls (e.g. `rdm:1d20` is literal text, `dice:1d20`
 * rolls), so previews and lock targeting must not collide.
 */
export function callKey(call: InlineCall): string {
    const prefix = call.prefix ?? INLINE_PREFIX;
    // Native calls keep the bare expression as their key — the shape
    // the preview registry has always used — so only compat prefixes
    // get namespaced.
    return prefix === INLINE_PREFIX ? call.expr : prefix + call.expr;
}

/**
 * The expression to actually EVALUATE for a call. `rdm:` calls
 * evaluate their expression as-is; Dice Roller prefixes are
 * translated first. Throws DiceCompatError (user-facing message)
 * for unsupported Dice Roller constructs.
 */
export function evalSourceOf(
    call: InlineCall,
    aliases?: Record<string, string>
): string {
    const prefix = call.prefix ?? INLINE_PREFIX;
    if (prefix === INLINE_PREFIX) return call.expr;
    return translateDiceExpression(call.expr, aliases).expr;
}

/**
 * Parse an inline call's textual content into its expression and
 * optional locked result. Input is the text INSIDE the backticks —
 * e.g. `rdm:[@Names]⟹Alice` (with no backticks).
 *
 * Returns null if the content isn't an inline call at all.
 */
export interface InlineCall {
    expr: string;
    /** The locked result, or undefined if unfilled. */
    locked?: string;
    /**
     * The prefix this call was written with (`rdm:` or a Dice Roller
     * compat prefix). Optional so existing call sites and tests that
     * build literals keep compiling; absent means `rdm:`.
     * Serialisation preserves it, so locking a `dice:` span writes
     * back `dice:…⟹result`, never rewriting the user's prefix.
     */
    prefix?: string;
}

export function parseInlineCall(text: string): InlineCall | null {
    const prefix = matchInlinePrefix(text);
    if (prefix === null) return null;
    const rest = text.slice(prefix.length);
    // A bare prefix with no expression (`` `dice:` `` in prose, e.g. a
    // heading mentioning the syntax) is a literal mention, not a call —
    // leave it as plain code rather than rendering an error span.
    const sepIdx = rest.indexOf(LOCK_SEPARATOR);
    const exprPart = sepIdx === -1 ? rest : rest.slice(0, sepIdx);
    if (exprPart.trim() === "") return null;
    // `rdm:` calls omit the prefix field — absent means rdm: — so the
    // parsed shape (and every test/caller comparing it structurally)
    // is unchanged for the native prefix.
    const prefixField =
        prefix === INLINE_PREFIX ? {} : { prefix };
    if (sepIdx === -1) {
        return { expr: rest, ...prefixField };
    }
    return {
        expr: rest.slice(0, sepIdx),
        locked: rest.slice(sepIdx + LOCK_SEPARATOR.length),
        ...prefixField,
    };
}

/**
 * Serialise an InlineCall back to its textual form (the content
 * between backticks). The inverse of parseInlineCall.
 */
export function serialiseInlineCall(call: InlineCall): string {
    const prefix = call.prefix ?? INLINE_PREFIX;
    if (call.locked === undefined) {
        return prefix + call.expr;
    }
    return prefix + call.expr + LOCK_SEPARATOR + call.locked;
}

/**
 * Transform a full note source by applying a lock to a specific
 * inline call. We identify the target by expression text AND
 * occurrence index (to disambiguate when the same expression appears
 * multiple times in one note).
 *
 * Returns the new source. If the target isn't found, returns the
 * original unchanged — the caller can detect this via referential
 * equality.
 *
 * Why occurrence-index rather than character offset: offsets are
 * fragile under concurrent edits. Two `rdm:[@X]` calls on the same
 * note are distinguished by "which one of the same-expr calls this
 * is", which survives unrelated edits anywhere else in the file.
 */
export function applyLockToSource(
    source: string,
    targetExpr: string,
    occurrence: number,
    result: string,
    targetPrefix: string = INLINE_PREFIX
): string {
    return transformNthMatch(source, targetPrefix, targetExpr, occurrence, () => ({
        expr: targetExpr,
        locked: result,
        prefix: targetPrefix,
    }));
}

/**
 * Transform a full note source by REMOVING the lock from a specific
 * inline call (returning it to unfilled state). Used by Reroll.
 */
export function applyUnlockToSource(
    source: string,
    targetExpr: string,
    occurrence: number,
    targetPrefix: string = INLINE_PREFIX
): string {
    return transformNthMatch(source, targetPrefix, targetExpr, occurrence, () => ({
        expr: targetExpr,
        prefix: targetPrefix,
    }));
}

/**
 * Transform every inline call in a note source. Used by the "Lock all
 * in note" and "Reroll all in note" commands. The transform callback
 * receives the parsed call and returns the new call (or null to leave
 * unchanged).
 */
export function transformAllInlineCalls(
    source: string,
    transform: (call: InlineCall) => InlineCall | null
): string {
    // Match `rdm:...` inside backticks. We use a careful pattern:
    //   `rdm:` then any chars except backtick until closing backtick.
    // The backticks are part of the codespan syntax; they MUST be
    // preserved in the output, hence the wrapping.
    return source.replace(
        new RegExp("`(" + PREFIX_ALTERNATION + "[^`]*)`", "g"),
        (whole, inner: string) => {
            const call = parseInlineCall(inner);
            if (!call) return whole;
            const updated = transform(call);
            if (updated === null) return whole;
            return "`" + serialiseInlineCall(updated) + "`";
        }
    );
}

/**
 * Apply a per-call transform to the Nth occurrence of an
 * expression. Other occurrences are left alone.
 *
 * Implementation: walk all inline calls, counting matches of the
 * target expression. When we hit the right occurrence, apply the
 * transform; otherwise leave the call alone.
 */
function transformNthMatch(
    source: string,
    targetPrefix: string,
    targetExpr: string,
    occurrence: number,
    transform: (call: InlineCall) => InlineCall
): string {
    let seen = 0;
    return transformAllInlineCalls(source, (call) => {
        if (call.expr !== targetExpr) return null;
        if ((call.prefix ?? INLINE_PREFIX) !== targetPrefix) return null;
        const idx = seen++;
        if (idx !== occurrence) return null;
        return transform(call);
    });
}

/**
 * One entry in the result of `findAllInlineCallPositions` — describes
 * an inline call's location and per-expression occurrence index in
 * a note source.
 */
export interface InlineCallPosition {
    /** The parsed call (expr, locked?). */
    call: InlineCall;
    /** Character offset of the opening backtick in the source. */
    sourceOffset: number;
    /** 0-indexed line containing the call. */
    line: number;
    /**
     * 0-indexed position of this call among same-expression calls
     * in source order. So `[0, 1, 2]` for three identical `rdm:[@X]`
     * calls in a row. Lock/reroll target the source by this index
     * via `applyLockToSource(source, expr, occurrence, ...)`.
     */
    occurrence: number;
}

/**
 * Walk a note's source and return the position of every inline
 * `rdm:` call. Each entry carries the source offset, line number,
 * and per-expression occurrence index — enough for the inline post-
 * processor to match a rendered DOM element to its source-level
 * identity so lock/reroll target the right call even when several
 * identical calls coexist in the note.
 *
 * Returns positions in source order. Lines and offsets are 0-based.
 */
export function findAllInlineCallPositions(
    source: string
): InlineCallPosition[] {
    const out: InlineCallPosition[] = [];
    // Track per-expression occurrence counters so each entry's
    // index reflects how many same-expression calls came before
    // it in the source.
    const exprCounts = new Map<string, number>();
    // Pre-compute line boundaries once so each call's line lookup
    // is a binary search rather than counting newlines from
    // the start every time.
    const lineStarts = computeLineStarts(source);
    const re = new RegExp("`(" + PREFIX_ALTERNATION + "[^`]*)`", "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
        const parsed = parseInlineCall(m[1]);
        if (!parsed) continue;
        const occ = exprCounts.get(callKey(parsed)) ?? 0;
        exprCounts.set(callKey(parsed), occ + 1);
        out.push({
            call: parsed,
            sourceOffset: m.index,
            line: offsetToLine(m.index, lineStarts),
            occurrence: occ,
        });
    }
    return out;
}

/**
 * Pre-compute the source offset of every line in the string.
 * Returns an array where `result[i]` is the offset of line i's
 * first character. Length = number of lines.
 */
function computeLineStarts(source: string): number[] {
    const out = [0];
    for (let i = 0; i < source.length; i++) {
        if (source[i] === "\n") out.push(i + 1);
    }
    return out;
}

/** Binary search the line containing a given source offset. */
function offsetToLine(offset: number, lineStarts: number[]): number {
    // Standard lower-bound: find the largest line whose start
    // is ≤ offset.
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (lineStarts[mid] <= offset) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

// ────────────────────────────────────────────────────────────────────
// Preview registry — in-memory state for the current session.
// ────────────────────────────────────────────────────────────────────

/**
 * Identity for an inline call within a note. The post-processor uses
 * (sourcePath, expr, occurrence) to look up preview state. Position-
 * within-the-note isn't enough on its own because Obsidian rerenders
 * sections incrementally; expr+occurrence is stable across edits to
 * unrelated parts of the note.
 */
export interface PreviewKey {
    sourcePath: string;
    expr: string;
    occurrence: number;
}

/**
 * Stable string form of a PreviewKey, suitable for Map lookups.
 */
function keyString(key: PreviewKey): string {
    // The separator characters here can't appear in occurrence (a
    // number) or sourcePath (a vault path — no nulls). The expr is the
    // free-form bit, but it goes last so a null byte is sufficient.
    return key.sourcePath + "\u0000" + key.occurrence + "\u0000" + key.expr;
}

/**
 * In-memory store of preview results. One per plugin instance,
 * shared across all inline calls.
 *
 * The store is cleared per note when the note's contents change in a
 * way that would invalidate previews — but that's the caller's
 * responsibility; the registry itself just stores and retrieves.
 */
export class PreviewRegistry {
    private map = new Map<string, string>();

    /** Look up a stored preview. Returns undefined if none recorded. */
    get(key: PreviewKey): string | undefined {
        return this.map.get(keyString(key));
    }

    /** Record a preview result. Overwrites any existing entry. */
    set(key: PreviewKey, result: string): void {
        this.map.set(keyString(key), result);
    }

    /** Drop a preview entry. Used by Reroll. */
    delete(key: PreviewKey): void {
        this.map.delete(keyString(key));
    }

    /** Drop every preview for a given note. */
    clearNote(sourcePath: string): void {
        const prefix = sourcePath + "\u0000";
        for (const k of [...this.map.keys()]) {
            if (k.startsWith(prefix)) this.map.delete(k);
        }
    }

    /** Drop everything. Used for full plugin teardown. */
    clear(): void {
        this.map.clear();
    }

    /** Number of entries. Test helper. */
    size(): number {
        return this.map.size;
    }
}
