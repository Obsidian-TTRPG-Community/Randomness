/**
 * Markdown content tables — Dice Roller merge, Phase 2.
 *
 * Turns ordinary markdown tables and lists in a note into rollable
 * engine tables, addressed by their Obsidian `^block-id`. This is the
 * feature Dice Roller called "table rollers" (`dice: [[Note^id]]`),
 * rebuilt as a resolver-level table *source* so everything the engine
 * already does — `[@…]` calls, repetitions, filters, locks, seeds —
 * applies to note content with no extra plumbing.
 *
 * What becomes a table (the block must carry a `^block-id` on the line
 * after it — up to two blank lines allowed — or it is skipped; without
 * an id there is nothing stable to call it):
 *
 *   - **Markdown table, one column** → weighted table `<id>`, one item
 *     per row.
 *   - **Markdown table, multiple columns** → `<id>` (whole rows, cells
 *     joined with ", "), plus `<id>.<header>` per column, plus
 *     `<id>.xy` (every cell — Dice Roller's `|xy` random-cell pick).
 *   - **Lookup form** — exactly two columns and the first header is a
 *     dice formula (`dice: 1d20` or `1d20`) with range-like first
 *     cells (`1-2`, `01–50`, `13,14`, `11`) → an engine lookup table:
 *     the header formula is rolled and the row whose range covers the
 *     result is returned.
 *   - **List** (bulleted or numbered, nested items flattened) →
 *     weighted table `<id>`, one item per list entry.
 *
 * Cell/item text is kept raw, so `{2d6}`, `[@OtherTable]`, wikilinks,
 * and embeds inside a cell all evaluate/render exactly as they would in
 * a generator file — nested rollers come for free.
 *
 * Also exported: wikilink-reference helpers shared by the file
 * resolver, the async prefetcher, and inline scope, so
 * `Use: [[Note^id]]` and direct `rdm:[[Note^id]]` calls agree on what a
 * wikilink means.
 */

import { TableDecl, TableItem } from "../engine/ast";
import { translateDiceExpression } from "../compat/diceCompat";

// ────────────────────────────────────────────────────────────────────
// Wikilink reference helpers
// ────────────────────────────────────────────────────────────────────

/**
 * If `ref` is a wikilink (`[[Note]]`, `[[Folder/Note^id]]`,
 * `[[Note#Heading]]`), return the file part as a plain path with `.md`
 * appended when no extension is present. Returns null when `ref` is
 * not a wikilink — callers fall through to their existing handling.
 *
 * The `^block-id` / `#heading` / `|alias` suffixes are stripped: a
 * wikilink `Use:` imports the whole note (all of its block-id tables
 * and `randomness` codeblocks); the block-id names which table to
 * call, it does not narrow the import.
 */
export function wikilinkToPath(ref: string): string | null {
    const m = ref.trim().match(/^\[\[(.+)\]\]$/);
    if (!m) return null;
    let inner = m[1];
    // Strip |alias, #heading, ^block — file part is everything before.
    inner = inner.split("|")[0].split("#")[0].split("^")[0].trim();
    if (inner === "") return null;
    // Append .md when there's no extension on the final segment.
    const lastSeg = inner.slice(inner.lastIndexOf("/") + 1);
    if (!lastSeg.includes(".")) inner += ".md";
    return inner;
}

export interface DirectWikilinkCall {
    /** The original wikilink, for Use: resolution (file part only). */
    fileRef: string;
    /** Engine table name to call: block-id, `id.Header`, or `id.xy`. */
    tableName: string;
    /** Repetition prefix: `"3"` or `"{1d4+1}"`; `""` for one roll. */
    reps: string;
    /** The complete engine call, e.g. `[@3 loot]` or `[@npcs.xy]`. */
    tableCall: string;
}

/**
 * Detect a "direct call" expression: an inline `rdm:` whose entire
 * body is a wikilink *with a block-id*, optionally with a `|column`
 * pick — `[[Note^loot]]`, `[[Note^loot|Header 2]]`, `[[Note^loot|xy]]`.
 *
 * Returns null for anything else — in particular a plain `[[Note]]`
 * without `^id` stays untouched (it renders as a normal wikilink).
 */
export function parseDirectWikilinkCall(
    expr: string
): DirectWikilinkCall | null {
    // `[[Note|line]]` / `[[Note|block]]` (no block-id): roll a random
    // line / block from the whole note (merge Phase 4). Same optional
    // repetition prefix as the block-id form. These target the hidden
    // per-note tables parseFileSource builds (see LINES_PREFIX /
    // BLOCKS_PREFIX below).
    const whole = expr
        .trim()
        .match(/^(\d+|\{[^{}]+\})?\s*\[\[([^[\]#|^]+)(?:#[^[\]|^]*)?\|(line|block)\]\]$/i);
    if (whole) {
        const reps = whole[1] ?? "";
        const file = whole[2].trim();
        const kind = whole[3].toLowerCase() as "line" | "block";
        const tableName =
            (kind === "line" ? LINES_PREFIX : BLOCKS_PREFIX) +
            noteBaseName(file).toLowerCase();
        const repsPart = reps === "" || reps === "1" ? "" : `${reps} `;
        const joiner = repsPart === "" ? "" : " >> implode";
        return {
            fileRef: `[[${file}]]`,
            tableName,
            reps,
            tableCall: `[@${repsPart}${tableName}${joiner}]`,
        };
    }
    // Optional repetition prefix (a count or a braced dice expression)
    // before the wikilink: `3[[Note^id]]`, `{1d4+1}[[Note^id]]`. Added
    // for Dice Roller compat (`dice: 3[[Note^id]]`), and available to
    // `rdm:` for free.
    const m = expr
        .trim()
        .match(/^(\d+|\{[^{}]+\})?\s*\[\[([^[\]#|^]+)(?:#[^[\]|^]*)?\^([A-Za-z0-9-]+)(?:\|([^[\]]+))?\]\]$/);
    if (!m) return null;
    const reps = m[1] ?? "";
    const file = m[2].trim();
    const blockId = m[3];
    const column = m[4]?.trim();
    const tableName = column ? `${blockId}.${column}` : blockId;
    const repsPart = reps === "" || reps === "1" ? "" : `${reps} `;
    // Multi-rep inline rolls join with ", " — the engine's default
    // multi-rep join is bare concatenation (IPP3 behaviour, pinned by
    // the corpus), which is unreadable inside prose. A comma list is
    // what an inline span wants; authors composing display themselves
    // can always write the [@N table >> …] form directly.
    const joiner = repsPart === "" ? "" : " >> implode";
    return {
        fileRef: `[[${file}]]`,
        tableName,
        reps,
        tableCall: `[@${repsPart}${tableName}${joiner}]`,
    };
}

// ────────────────────────────────────────────────────────────────────
// Extraction
// ────────────────────────────────────────────────────────────────────

/** Max blank lines allowed between a block and its `^block-id` line. */
const MAX_ID_GAP = 2;

const BLOCK_ID_RE = /^\^([A-Za-z0-9-]+)\s*$/;
const TABLE_ROW_RE = /^ {0,3}\|/;
const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/**
 * Memoised extraction cache. A big note re-renders every inline span
 * independently (see inlineProcessor), and each span rebuilds the whole
 * inline scope — so without this, a 2,000-line note with hundreds of
 * `dice:` spans re-parses itself hundreds of times per render (measured
 * at ~4.5 ms x hundreds = multi-second stalls). The parse is a pure
 * function of (md, selfBase) and the engine never mutates the returned
 * TableDecls (deck/shuffle state lives on the Evaluator, keyed by table
 * name), so the same array can be shared across every span in a render
 * burst. Keyed by the note text, so an edit is a natural cache miss;
 * a tiny LRU bounds memory when several notes are open.
 */
interface ExtractCacheEntry {
    selfBase: string;
    result: TableDecl[];
}
const EXTRACT_CACHE = new Map<string, ExtractCacheEntry>();
const EXTRACT_CACHE_MAX = 8;

/**
 * Extract every block-id'd markdown table and list in `md` as engine
 * TableDecls. Blocks without a `^block-id` are skipped. Memoised by
 * content — see EXTRACT_CACHE.
 *
 * Keyed by `md` alone (not `selfBase + md`) to avoid allocating a fresh
 * ~200 KB copy of the note on every lookup — a big note is looked up
 * hundreds of times per render. `selfBase` is stored on the entry and
 * re-checked on a hit; it derives from the note's own path, so it's
 * stable for a given `md`, and a mismatch simply recomputes.
 */
export function extractMarkdownContentTables(
    md: string,
    selfBase?: string
): TableDecl[] {
    const sb = selfBase ?? "";
    const cached = EXTRACT_CACHE.get(md);
    if (cached !== undefined && cached.selfBase === sb) {
        // Refresh recency: delete + re-insert moves it to the newest
        // slot in Map's insertion order.
        EXTRACT_CACHE.delete(md);
        EXTRACT_CACHE.set(md, cached);
        return cached.result;
    }
    const result = extractMarkdownContentTablesUncached(md, selfBase);
    EXTRACT_CACHE.set(md, { selfBase: sb, result });
    if (EXTRACT_CACHE.size > EXTRACT_CACHE_MAX) {
        // Evict the oldest entry (first key in insertion order).
        const oldest = EXTRACT_CACHE.keys().next().value;
        if (oldest !== undefined) EXTRACT_CACHE.delete(oldest);
    }
    return result;
}

function extractMarkdownContentTablesUncached(
    md: string,
    selfBase?: string
): TableDecl[] {
    const lines = md.split(/\r?\n/);
    const out: TableDecl[] = [];
    let i = 0;
    while (i < lines.length) {
        // Markdown table: header row + separator row.
        if (TABLE_ROW_RE.test(lines[i]) && isSeparatorRow(lines[i + 1] ?? "")) {
            const start = i;
            i += 2;
            while (i < lines.length && TABLE_ROW_RE.test(lines[i])) i++;
            const rows = lines.slice(start, i);
            const { id, next } = findBlockId(lines, i);
            if (id !== null) out.push(...tableToDecls(id, rows));
            i = next;
            continue;
        }
        // List: one or more list-item lines.
        const li = lines[i].match(LIST_ITEM_RE);
        if (li) {
            const items: string[] = [];
            while (i < lines.length) {
                const m = lines[i].match(LIST_ITEM_RE);
                if (m) {
                    items.push(m[2].trim());
                } else if (/^\s{2,}\S/.test(lines[i]) && items.length > 0) {
                    // Indented continuation of the previous item.
                    items[items.length - 1] += " " + lines[i].trim();
                } else {
                    break;
                }
                i++;
            }
            const { id, next } = findBlockId(lines, i);
            if (id !== null && items.length > 0) {
                out.push(makeTable(id, items.filter((s) => s !== "")));
            }
            i = next;
            continue;
        }
        // Paragraph with a ^block-id: a one-item table. Dice Roller's
        // roller accepted ANY block, and real sheets use small
        // paragraph blocks as aliases — a block whose only content is
        // another roll ("^underworld-lawful-day" → roll underworld).
        if (isParagraphLine(lines[i])) {
            const start = i;
            while (i < lines.length && isParagraphLine(lines[i])) i++;
            const { id, next } = findBlockId(lines, i);
            if (id !== null) {
                const text = lines
                    .slice(start, i)
                    .map((l) => l.trim())
                    .join(" ")
                    .trim();
                if (text !== "") out.push(makeTable(id, [text]));
            }
            i = next > i ? next : i;
            continue;
        }
        i++;
    }
    // Embedded `dice: …` spans in cell text roll as part of the
    // result (see rewriteEmbeddedDiceSpans).
    for (const decl of out) {
        for (const item of decl.items) {
            item.rawContent = rewriteEmbeddedDiceSpans(
                item.rawContent,
                selfBase
            );
        }
    }
    return out;
}

/**
 * Look for a `^block-id` line at `from`, skipping up to MAX_ID_GAP
 * blank lines. Returns the id (or null) and the line index to resume
 * scanning from (past the id line when found; `from` otherwise).
 */
function findBlockId(
    lines: string[],
    from: number
): { id: string | null; next: number } {
    let j = from;
    let blanks = 0;
    while (j < lines.length && lines[j].trim() === "" && blanks < MAX_ID_GAP) {
        j++;
        blanks++;
    }
    const m = j < lines.length ? lines[j].match(BLOCK_ID_RE) : null;
    if (m) return { id: m[1], next: j + 1 };
    return { id: null, next: from };
}

/** True if the line is a markdown table separator row (`| --- | :-: |`). */
function isSeparatorRow(line: string): boolean {
    if (!TABLE_ROW_RE.test(line)) return false;
    const cells = splitRow(line);
    if (cells.length === 0) return false;
    return cells.every((c) => /^:?-+:?$/.test(c) || c === "");
}

/**
 * Split a table row into trimmed cells. Pipes inside wikilinks
 * (`[[Note|alias]]`) and escaped pipes (`\|`) don't split; escaped
 * pipes become literal pipes in the output.
 */
function splitRow(line: string): string[] {
    const WIKI_PIPE = String.fromCharCode(0); // placeholder: pipe in [[..|..]]
    const ESC_PIPE = String.fromCharCode(1); // placeholder: escaped pipe
    // Inside a wikilink the alias pipe may itself be escaped for the
    // markdown table (`[[Note\\|alias]]`) — drop that backslash too.
    let masked = line.replace(/\[\[[^\]]*\]\]/g, (m) =>
        m.split("\\|").join(WIKI_PIPE).split("|").join(WIKI_PIPE)
    );
    masked = masked.replace(/\\\|/g, ESC_PIPE);
    let s = masked.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s
        .split("|")
        .map((c) =>
            c.split(WIKI_PIPE).join("|").split(ESC_PIPE).join("|").trim()
        );
}

/** Build a weighted TableDecl from item strings. */
function makeTable(name: string, items: string[]): TableDecl {
    return {
        name,
        type: "weighted",
        shuffleTargets: [],
        inTableSets: [],
        items: items.map((rawContent): TableItem => ({ weight: 1, rawContent })),
    };
}

/**
 * A line that can belong to a plain paragraph block: non-empty and
 * not one of the structures the extractor handles specially (tables,
 * lists, headings, quotes/callouts, fences, block-id lines).
 */
function isParagraphLine(line: string): boolean {
    const t = line.trim();
    if (t === "") return false;
    if (TABLE_ROW_RE.test(line)) return false;
    if (LIST_ITEM_RE.test(line)) return false;
    if (BLOCK_ID_RE.test(t)) return false;
    if (/^(#{1,6}\s|>|```|~~~|---\s*$)/.test(t)) return false;
    return true;
}

/**
 * Rewrite `dice: …` code spans EMBEDDED IN CELL TEXT into engine dice
 * expressions so they roll as part of the result. Dice Roller
 * rendered results through MarkdownRenderer, which revived such spans
 * as live rollers — the 1E Inns corpus relies on it ("Bustling
 * `dice:1d8+5` x # Inn Rooms"). We deliberately don't revive spans in
 * rendered results (recursion + lock targeting), so the translation
 * happens here, at extraction time. Only pure formulas are rewritten;
 * table/tag rollers and untranslatable spans keep their literal text.
 */
function rewriteEmbeddedDiceSpans(
    cell: string,
    selfBase?: string
): string {
    return cell.replace(/`dice:([^`]*)`/gi, (whole, inner: string) => {
        try {
            const { expr } = translateDiceExpression(inner.trim());
            // Pure formula → engine dice.
            if (expr.startsWith("{") && expr.endsWith("}")) return expr;
            // Table roller pointing back at THIS note → a direct
            // engine call ([@id], reps and column picks included).
            // Case-insensitive: Obsidian links are, and corpus files
            // really do write [[encounter Tables]].
            const direct = parseDirectWikilinkCall(expr);
            if (direct !== null && selfBase !== undefined) {
                const target = wikilinkToPath(direct.fileRef);
                if (
                    target !== null &&
                    noteBaseName(target).toLowerCase() ===
                        selfBase.toLowerCase()
                ) {
                    return direct.tableCall;
                }
            }
        } catch {
            // fall through to the backtick strip below
        }
        // Untranslatable (cross-note rollers, unsupported syntax):
        // drop the backticks so the engine's content parser doesn't
        // choke on them — the span text shows literally instead of
        // erroring the whole cell.
        return "dice:" + inner;
    });
}

/** Dice-formula sniff for lookup headers: `1d20`, `dice: 2d6+1`, `d%`. */
function looksLikeDiceFormula(s: string): boolean {
    return /\b\d*d\d+\b|\bd%|\bdF\b/i.test(s);
}

const RANGE_RE = /^(\d+)\s*[-–—]\s*(\d+)$/;
const NUM_LIST_RE = /^\d+(\s*,\s*\d+)+$/;

/**
 * Strip markdown emphasis/code wrapping from a lookup key cell —
 * authors habitually bold their dice columns (`**1**`, `**1-2**`),
 * and Dice Roller tolerated that.
 */
function normaliseLookupKey(s: string): string {
    let key = s.trim();
    let prev = "";
    while (prev !== key) {
        prev = key;
        key = key
            .replace(/^\*\*(.*)\*\*$/s, "$1")
            .replace(/^__(.*)__$/s, "$1")
            .replace(/^\*(.*)\*$/s, "$1")
            .replace(/^_(.*)_$/s, "$1")
            .replace(/^`(.*)`$/s, "$1")
            .trim();
    }
    return key;
}

/** Convert one markdown table (with block id) into TableDecl(s). */
function tableToDecls(id: string, rowLines: string[]): TableDecl[] {
    let headers = splitRow(rowLines[0]);
    let body = rowLines
        .slice(2)
        .map(splitRow)
        .filter((cells) => cells.some((c) => c !== ""));
    if (body.length === 0) return [];

    // Real sheets pad every row with a trailing empty column
    // (`| key | value |     |`). Drop columns that are empty in the
    // header AND in every body row, so a padded two-column lookup
    // table is still recognised as one instead of falling through to
    // the multi-column path (which would join the key cell into the
    // result — "01-30, Creature, resident").
    let width = Math.max(headers.length, ...body.map((r) => r.length));
    while (
        width > 1 &&
        (headers[width - 1] ?? "") === "" &&
        body.every((r) => (r[width - 1] ?? "") === "")
    ) {
        width--;
    }
    headers = headers.slice(0, width);
    body = body.map((r) => r.slice(0, width));

    // Lookup form: two columns, dice-formula header, range-like keys.
    if (headers.length === 2 && looksLikeDiceFormula(headers[0])) {
        const keys = body.map((r) => normaliseLookupKey(r[0] ?? ""));
        const rangeLike = keys.every(
            (k) => RANGE_RE.test(k) || NUM_LIST_RE.test(k) || /^\d+$/.test(k)
        );
        if (rangeLike) {
            // Headers arrive as `dice:1d100` (backticked code spans)
            // in real sheets — strip code wrapping before the prefix.
            const rollExpr = headers[0]
                .replace(/`/g, "")
                .trim()
                .replace(/^dice:\s*/i, "")
                .trim();
            const items: TableItem[] = [];
            for (const row of body) {
                const key = normaliseLookupKey(row[0] ?? "");
                const content = (row[1] ?? "").trim();
                const range = key.match(RANGE_RE);
                if (range) {
                    items.push({
                        lookupRange: [
                            parseInt(range[1], 10),
                            parseInt(range[2], 10),
                        ],
                        rawContent: content,
                    });
                } else if (NUM_LIST_RE.test(key)) {
                    for (const part of key.split(",")) {
                        const n = parseInt(part.trim(), 10);
                        items.push({ lookupRange: [n, n], rawContent: content });
                    }
                } else {
                    const n = parseInt(key, 10);
                    items.push({ lookupRange: [n, n], rawContent: content });
                }
            }
            return [
                {
                    name: id,
                    type: "lookup",
                    rollExpr,
                    shuffleTargets: [],
                    inTableSets: [],
                    items,
                },
            ];
        }
    }

    // Uniform table(s).
    const decls: TableDecl[] = [];
    if (headers.length <= 1) {
        decls.push(
            makeTable(
                id,
                body.map((r) => r[0] ?? "").filter((s) => s !== "")
            )
        );
        return decls;
    }

    // Whole rows: cells joined with ", " (empty cells skipped).
    decls.push(
        makeTable(
            id,
            body.map((r) => r.filter((c) => c !== "").join(", "))
        )
    );
    // Per-column variants: `<id>.<header>`.
    headers.forEach((header, col) => {
        const name = `${id}.${header !== "" ? header : `col${col + 1}`}`;
        const items = body.map((r) => r[col] ?? "").filter((s) => s !== "");
        if (items.length > 0) decls.push(makeTable(name, items));
    });
    // Random cell: `<id>.xy` (unless a real column is named xy).
    if (!headers.some((h) => h.toLowerCase() === "xy")) {
        const cells = body.flat().filter((s) => s !== "");
        decls.push(makeTable(`${id}.xy`, cells));
    }
    return decls;
}

// ────────────────────────────────────────────────────────────────────
// Whole-note lines & blocks (merge Phase 4)
// ────────────────────────────────────────────────────────────────────

/**
 * Hidden per-note table names. Prefixed with `__` so they can't clash
 * with author tables and don't show up naturally in autocomplete; the
 * suffix is the note's basename (lowercased) so several imported notes
 * coexist.
 */
export const LINES_PREFIX = "__lines:";
export const BLOCKS_PREFIX = "__blocks:";

/** Cap on how many tagged notes a single #tag roll imports. */
export const TAG_FILE_CAP = 50;

/** Basename without extension: "Camp/My Note.md" → "My Note". */
export function noteBaseName(pathOrRef: string): string {
    const seg = pathOrRef.slice(pathOrRef.lastIndexOf("/") + 1);
    const dot = seg.lastIndexOf(".");
    return dot > 0 ? seg.slice(0, dot) : seg;
}

/** Strip a leading YAML frontmatter block. */
function stripFrontmatter(md: string): string {
    const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
    return m ? md.slice(m[0].length) : md;
}

/**
 * Every non-empty line of the note (frontmatter and `^block-id`-only
 * lines removed). Dice Roller's `|line` roll.
 */
export function extractNoteLines(md: string): string[] {
    return stripFrontmatter(md)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== "" && !BLOCK_ID_RE.test(l));
}

/**
 * Blank-line-separated blocks of the note (Dice Roller's section
 * roll, approximated from raw text). Fenced code blocks stay whole;
 * frontmatter, thematic breaks, and `^block-id` lines are dropped.
 */
export function extractNoteBlocks(md: string): string[] {
    const lines = stripFrontmatter(md).split(/\r?\n/);
    const blocks: string[] = [];
    let current: string[] = [];
    let fence: string | null = null;
    const flush = () => {
        // Trim trailing ^block-id lines — they label the block, they
        // aren't content.
        while (
            current.length > 0 &&
            BLOCK_ID_RE.test(current[current.length - 1].trim())
        ) {
            current.pop();
        }
        const text = current.join("\n").trim();
        current = [];
        if (text === "") return;
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(text)) return; // thematic break
        blocks.push(text);
    };
    for (const line of lines) {
        const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (fence === null && fenceMatch) {
            fence = fenceMatch[1];
            current.push(line);
            continue;
        }
        if (fence !== null) {
            current.push(line);
            if (fenceMatch && fenceMatch[1].startsWith(fence[0]) && fenceMatch[1].length >= fence.length) {
                fence = null;
            }
            continue;
        }
        if (line.trim() === "") {
            flush();
            continue;
        }
        current.push(line);
    }
    flush();
    return blocks;
}

// ────────────────────────────────────────────────────────────────────
// Tag rolls (merge Phase 4)
// ────────────────────────────────────────────────────────────────────

export interface DirectTagCall {
    /** Tag without the leading `#`. */
    tag: string;
    /** What to produce: a random block from a tagged note, or a link. */
    mode: "block" | "link";
}

/**
 * Detect a direct tag-roll expression: `#tag`, `#tag|link`. Dice
 * Roller's `|-` (single random note) matches our default behaviour and
 * is accepted as plain mode; block-type filters are approximated to
 * the block mode. Returns null for anything that isn't a tag call.
 */
export function parseDirectTagCall(expr: string): DirectTagCall | null {
    const m = expr.trim().match(/^#([A-Za-z0-9_/-]+)(?:\|(.*))?$/);
    if (!m) return null;
    const suffix = (m[2] ?? "").trim().toLowerCase();
    if (suffix === "link") return { tag: m[1], mode: "link" };
    return { tag: m[1], mode: "block" };
}
