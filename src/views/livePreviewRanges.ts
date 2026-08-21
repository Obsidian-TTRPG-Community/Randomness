/**
 * Which inline calls a Live Preview editor should replace with a
 * widget — the decision, separated from CodeMirror.
 *
 * Kept apart from the extension itself so it can be tested without an
 * editor: every rule here is about text offsets and a selection, and
 * all of them have bitten us somewhere else already.
 */

import {
    InlineCall,
    findAllInlineCallPositions,
} from "./lockingService";

export interface InlineCallRange {
    /** Offset of the opening backtick. */
    from: number;
    /** Offset just past the closing backtick. */
    to: number;
    call: InlineCall;
    /** Position among same-expression calls, in source order. */
    occurrence: number;
}

/**
 * Character ranges covered by fenced code blocks.
 *
 * A ```randomness block's body is not prose, and the reference and
 * guide are full of ```text blocks that DISPLAY inline-call syntax
 * without meaning it. The post-processor path dodges this by skipping
 * any `<code>` inside a `<pre>`; in the editor there is no DOM to ask,
 * so the fences are found in the text.
 */
export function fencedRanges(text: string): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    let offset = 0;
    let openFence: string | null = null;
    let openAt = 0;
    for (const line of text.split("\n")) {
        const m = line.match(/^\s*(`{3,}|~{3,})/);
        if (openFence === null) {
            if (m) {
                openFence = m[1][0].repeat(m[1].length);
                openAt = offset;
            }
        } else if (m && m[1][0] === openFence[0] && m[1].length >= openFence.length) {
            out.push([openAt, offset + line.length]);
            openFence = null;
        }
        offset += line.length + 1; // +1 for the newline
    }
    // An unterminated fence runs to the end of the document — that is
    // what the editor shows while you are still typing one.
    if (openFence !== null) out.push([openAt, text.length]);
    return out;
}

/** Is `from`..`to` inside any of these ranges? */
function within(ranges: Array<[number, number]>, from: number): boolean {
    return ranges.some(([a, b]) => from >= a && from < b);
}

export interface RangeOptions {
    /** Full document text. */
    text: string;
    /** Selection, as offsets. A cursor is from === to. */
    selection: { from: number; to: number };
    /**
     * Whether the Dice Roller compat prefixes are live. When off,
     * `dice:` spans belong to the other plugin and must be left alone
     * — exactly as the post-processor treats them.
     */
    compatOn: boolean;
}

/**
 * The inline calls to replace with a widget.
 *
 * Excluded:
 *   - anything inside a fenced code block,
 *   - compat prefixes when compat is off,
 *   - any call the selection touches. That last one is what makes the
 *     roll editable at all: put the cursor in it and you get your
 *     expression back, which is how every other Live Preview widget
 *     behaves. "Touches" is inclusive at both ends, so a cursor
 *     resting immediately after the closing backtick still reveals
 *     the source rather than leaving you nothing to arrow into.
 */
export function inlineCallRanges(opts: RangeOptions): InlineCallRange[] {
    const { text, selection, compatOn } = opts;
    const fenced = fencedRanges(text);
    const out: InlineCallRange[] = [];
    for (const pos of findAllInlineCallPositions(text)) {
        const from = pos.sourceOffset;
        const close = text.indexOf("`", from + 1);
        if (close === -1) continue;
        const to = close + 1;
        if (within(fenced, from)) continue;
        if (!compatOn && pos.call.prefix !== undefined) continue;
        if (selection.to >= from && selection.from <= to) continue;
        out.push({ from, to, call: pos.call, occurrence: pos.occurrence });
    }
    return out;
}
