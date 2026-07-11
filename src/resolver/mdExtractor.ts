/**
 * Markdown extractor.
 *
 * Pulls fenced codeblocks tagged `randomness` (or `randomness:something`)
 * out of a Markdown file and concatenates them as a virtual .ipt source.
 * This means a .md note can contain a generator inline alongside its
 * prose, and `Use:` can target it the same way as a standalone .ipt file.
 *
 * Fence detection follows CommonMark loosely:
 *   - Opening fence: three or more backticks, then `randomness` (case-
 *     insensitive), optionally followed by `:label` and trailing
 *     whitespace.
 *   - Closing fence: same number of backticks (or more), no info string.
 *   - Content between fences is taken verbatim.
 *
 * Multiple codeblocks in one file are concatenated with a single blank
 * line between them. The fileParser is tolerant of blank lines, so this
 * preserves table boundaries cleanly.
 *
 * Edge cases handled:
 *   - Tilde fences (~~~) — supported, same rules.
 *   - Indented (≤3 spaces) opening fences — supported, indent stripped.
 *   - Tab-indented opening fences — NOT supported (CommonMark says no).
 *   - Nested codeblocks — the outer fence wins; inner backticks are
 *     content as long as they don't match the outer fence's length.
 */

/** Public entry — returns the concatenated virtual .ipt source. */
export function extractRandomnessCodeblocks(md: string): string {
    const blocks = findBlocks(md);
    return blocks.map((b) => b.content).join("\n\n");
}

/**
 * Lower-level variant — returns the blocks with their line ranges. The
 * scope module uses this to map an inline `rdm:` call back to the
 * codeblock(s) visible in the same file.
 */
export interface CodeblockSpan {
    /** 0-indexed line where the opening fence appears. */
    openLine: number;
    /** 0-indexed line where the closing fence appears (or EOF if unclosed). */
    closeLine: number;
    /** Raw content between the fences, joined by "\n". */
    content: string;
    /** Optional label after "randomness:" (e.g. "main", "settlement"). */
    label?: string;
}

/**
 * Memoised codeblock scan. Like extractMarkdownContentTables, this is
 * called once per inline span while building the inline scope, so a big
 * note is otherwise re-split and re-scanned hundreds of times per
 * render. The result is a pure function of `md` and callers treat it as
 * read-only, so a small content-keyed LRU is safe and cheap.
 */
const BLOCKS_CACHE = new Map<string, CodeblockSpan[]>();
const BLOCKS_CACHE_MAX = 8;

export function findBlocks(md: string): CodeblockSpan[] {
    const cached = BLOCKS_CACHE.get(md);
    if (cached !== undefined) {
        BLOCKS_CACHE.delete(md);
        BLOCKS_CACHE.set(md, cached);
        return cached;
    }
    const result = findBlocksUncached(md);
    BLOCKS_CACHE.set(md, result);
    if (BLOCKS_CACHE.size > BLOCKS_CACHE_MAX) {
        const oldest = BLOCKS_CACHE.keys().next().value;
        if (oldest !== undefined) BLOCKS_CACHE.delete(oldest);
    }
    return result;
}

function findBlocksUncached(md: string): CodeblockSpan[] {
    const lines = md.split(/\r?\n/);
    const out: CodeblockSpan[] = [];
    let i = 0;
    while (i < lines.length) {
        const open = matchOpeningFence(lines[i]);
        if (!open) {
            i++;
            continue;
        }
        const openLine = i;
        const startContent = i + 1;
        // Find matching closing fence
        let closeLine = lines.length; // EOF fallback
        for (let j = startContent; j < lines.length; j++) {
            const stripped = lines[j].replace(/^ {0,3}/, "");
            // Closing fence: same char, length ≥ opening, no info string
            const re = new RegExp(
                `^${open.fenceChar === "`" ? "`" : "~"}{${open.fenceLen},}\\s*$`
            );
            if (re.test(stripped)) {
                closeLine = j;
                break;
            }
        }
        const content = lines.slice(startContent, closeLine).join("\n");
        out.push({ openLine, closeLine, content, label: open.label });
        i = closeLine + 1;
    }
    return out;
}

interface OpeningFence {
    fenceChar: "`" | "~";
    fenceLen: number;
    label?: string;
}

/**
 * Match an opening fence on a line. Returns null if the line isn't an
 * opening `randomness` fence.
 *
 * Accepted shapes (with up to 3 leading spaces):
 *   ```randomness
 *   ```randomness:label
 *   ~~~~randomness   ← four tildes is fine
 *   ```RANDOMNESS    ← case-insensitive
 */
function matchOpeningFence(line: string): OpeningFence | null {
    // Allow up to 3 spaces of indent, per CommonMark.
    const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*([A-Za-z][\w:-]*)\s*$/);
    if (!m) return null;
    const fence = m[1];
    const info = m[2];
    // Split label off the info string
    const [lang, ...rest] = info.split(":");
    if (lang.toLowerCase() !== "randomness") return null;
    return {
        fenceChar: fence[0] === "`" ? "`" : "~",
        fenceLen: fence.length,
        label: rest.length > 0 ? rest.join(":") : undefined,
    };
}
