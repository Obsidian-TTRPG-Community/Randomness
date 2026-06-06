/**
 * File-level parser for IPP3 generator files.
 *
 * Handles the line-oriented structure: comments, line continuation, command
 * detection (Use, Set, Define, Table, Type, Roll, Default, Shuffle, Prompt,
 * Header, Footer, MaxReps, Formatting, Title, EndTable), and weighted /
 * lookup / dictionary item parsing.
 *
 * Item *content* (the right-hand side of items, with [@…], {…}, escapes,
 * etc.) is kept as raw strings here. The contentParser module turns those
 * into Node trees.
 *
 * IPP3 commands are case-insensitive. Whitespace around colons is allowed.
 * The first table declared in the file is the "main" table (entry point).
 */

import { Assignment, GeneratorFile, PromptDecl, TableDecl, TableItem } from "./ast";

export class ParseError extends Error {
    constructor(message: string, public line: number) {
        super(`Line ${line}: ${message}`);
        this.name = "ParseError";
    }
}

// Command keywords recognised at the start of a line (case-insensitive).
// Order matters for nothing here, but keeping them sorted by frequency aids readability.
const COMMAND_KEYWORDS = [
    "use", "set", "define", "table", "type", "roll", "default",
    "shuffle", "prompt", "header", "footer", "maxreps", "formatting",
    "title", "endtable", "with"
] as const;

type CommandKeyword = typeof COMMAND_KEYWORDS[number];

/**
 * Recognise lines whose value would be polluted by `&` line
 * continuation. Per the IPP3 manual: "When used at the end of the
 * line within a table item, the ampersand acts as a line continuation
 * marker." Continuation is for ITEM lines. Directive lines (Set:,
 * Define:, Roll:, Type:, Table:, Use:, Prompt:, etc.) terminate at
 * end-of-line and should not absorb following lines even if they end
 * with `&`. Files that put `&` at the end of a directive line are
 * relying on undocumented (and inconsistent) IPP3 behaviour; we
 * follow the spec.
 */
const DIRECTIVE_PREFIX = /^\s*(?:Set|Define|Table|Type|Roll|Use|Prompt|Title|Formatting|MaxReps|Default|Shuffle|EndTable)\s*:/i;

/** Split source into logical lines, applying line continuations (`&` at EOL). */
function preprocessLines(source: string): { text: string; lineNum: number }[] {
    // Normalise line endings — IPP3 files are typically CRLF (Windows origin)
    const normalised = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rawLines = normalised.split("\n");
    const result: { text: string; lineNum: number }[] = [];

    let i = 0;
    while (i < rawLines.length) {
        let current = rawLines[i];
        let startLine = i + 1;
        // Line continuation: `&` at end of line (after trimming trailing whitespace)
        // joins this line with the next, *without* a separator.
        // The `&` is the continuation marker; everything before it is kept.
        // Per the IPP3 spec, continuation applies to item lines only —
        // directive lines (Set:, Roll:, etc.) terminate at EOL even if
        // they end with `&`. This matters for community generators
        // that put `&` after a Set: directive then follow with body
        // content; without this guard, the body gets sucked into the
        // Set's value and the table emits empty output.
        const isDirective = DIRECTIVE_PREFIX.test(current);
        if (!isDirective) {
            while (i + 1 < rawLines.length && /\&\s*$/.test(current)) {
                current = current.replace(/\&\s*$/, "") + rawLines[i + 1];
                i++;
            }
        }
        result.push({ text: current, lineNum: startLine });
        i++;
    }
    return result;
}

/** Strip whole-line comments and inline `//` comments. */
function stripComment(line: string): string {
    const trimmed = line.replace(/^\s+/, "");
    // Whole-line comment markers: #, ;, //
    if (trimmed.startsWith("#") || trimmed.startsWith(";") || trimmed.startsWith("//")) {
        return "";
    }
    // Inline `//` comment per IPP3 spec: anything from `//` to end
    // of line is ignored. Example from docs:
    //   The name is [@npcnames] //comment to be ignored
    //
    // Caveat: this strip is naive — it doesn't skip `//` inside
    // string literals (e.g. `{'a//b'}`) or filter arguments
    // (e.g. `[x >> replace //a//b]` if someone used // as a
    // delimiter). The spec doesn't address those cases and real
    // IPP3 corpora don't seem to hit them, so we follow the simple
    // spec rule. If an author needs a literal `//`, they can put
    // a space between the slashes or use `\/\/`.
    //
    // We do NOT strip inside `[...]` because a few filter argument
    // forms use `/` as a separator, and stripping mid-filter would
    // corrupt the call. The conservative rule: only strip `//`
    // that appears outside any unclosed `[`.
    return stripInlineDoubleSlash(line);
}

function stripInlineDoubleSlash(line: string): string {
    let depth = 0;
    for (let i = 0; i < line.length - 1; i++) {
        const c = line[i];
        if (c === "[") depth++;
        else if (c === "]" && depth > 0) depth--;
        else if (c === "/" && line[i + 1] === "/" && depth === 0) {
            // Strip from here to end of line, also trimming
            // trailing whitespace before the `//`.
            return line.slice(0, i).replace(/\s+$/, "");
        }
    }
    return line;
}

/** Match `CommandName:` prefix (case-insensitive). Returns keyword + rest, or null. */
function matchCommand(line: string): { keyword: CommandKeyword; rest: string } | null {
    const m = line.match(/^\s*([A-Za-z]+)\s*:\s*(.*)$/);
    if (!m) return null;
    const kw = m[1].toLowerCase();
    if ((COMMAND_KEYWORDS as readonly string[]).includes(kw)) {
        return { keyword: kw as CommandKeyword, rest: m[2] };
    }
    return null;
}

/**
 * Parse a "Set:" or "Define:" line.
 * Format: `Set: var_name=value` or `Define: var_name=value`.
 * Everything after the first `=` is the value (including any spaces).
 */
function parseAssignment(kind: "set" | "define", rest: string, lineNum: number): Assignment {
    const eq = rest.indexOf("=");
    if (eq === -1) {
        throw new ParseError(`${kind}: missing '=' in assignment`, lineNum);
    }
    const name = rest.slice(0, eq).trim();
    const value = rest.slice(eq + 1);
    if (!name) throw new ParseError(`${kind}: empty variable name`, lineNum);
    return { kind, name, valueSource: value };
}

/**
 * Parse a Prompt: line.
 * Format: `Prompt: <label> {<options>} <default>`
 * Options are pipe-delimited; if `{}` is empty, the prompt is free-text.
 * Everything after the closing `}` (with optional leading whitespace) is the default.
 */
function parsePrompt(rest: string, lineNum: number): PromptDecl {
    const open = rest.indexOf("{");
    const close = rest.indexOf("}", open + 1);
    if (open === -1 || close === -1) {
        throw new ParseError("Prompt: missing { or }", lineNum);
    }
    const label = rest.slice(0, open).trim();
    const optionsRaw = rest.slice(open + 1, close);
    const options = optionsRaw === ""
        ? []
        : optionsRaw.split("|").map(s => s.trim());
    const defaultValue = rest.slice(close + 1).trim();
    return { label, options, defaultValue };
}

/**
 * Parse the prefix of a table item line for weight or lookup-range.
 * Returns the parsed prefix info and the content portion.
 *
 *   "3:Goblin"     → weight 3, content "Goblin"
 *   "1-5:Orc"      → range [1,5], content "Orc"
 *   "fighter:hd10" → dict key "fighter", content "hd10" (dictionary tables only)
 *   "Goblin"       → no prefix, content "Goblin"
 *
 * Tricky: an item like "1: this" is a lookup row; "1d6: that" could be a weight
 * of "1d6" but IPP3 doesn't support dice in weights — only integers in lookup
 * ranges. We treat "<digits>-<digits>:" as range, "<digits>:" as weight, and
 * "<non-numeric>:" as dictionary key. Item content that genuinely starts with
 * "text:" without being a key must be escaped — but in practice this is rare
 * because content with literal colons (like "Skills: foo") works fine as long
 * as the leading word has spaces or special chars.
 */
function parseItemPrefix(
    line: string,
    tableType: "weighted" | "lookup" | "dictionary"
): { weight?: number; lookupRange?: [number, number]; dictKey?: string; content: string } {
    const trimmed = line.replace(/^\s+/, "");

    // Helper: strip at most ONE leading space from content after the
    // prefix's colon. IPP3 convention is `1: Goblin` where the space
    // between `:` and the value is purely formatting — not part of
    // the value. Stripping more would surprise authors who genuinely
    // wanted indented content; stripping exactly one is the canonical
    // behaviour.
    const stripLeadSpace = (s: string) =>
        s.startsWith(" ") ? s.slice(1) : s;

    if (tableType === "dictionary") {
        // dict tables: split on first colon, everything before is key, after is value
        const colon = trimmed.indexOf(":");
        if (colon === -1) {
            // No colon — treat whole thing as content (probably the default value or odd usage)
            return { content: trimmed };
        }
        const key = trimmed.slice(0, colon).trim();
        const content = stripLeadSpace(trimmed.slice(colon + 1));
        return { dictKey: key, content };
    }

    // Lookup range: "N-M:"
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)\s*:(.*)$/s);
    if (rangeMatch) {
        const low = parseInt(rangeMatch[1], 10);
        const high = parseInt(rangeMatch[2], 10);
        return { lookupRange: [low, high], content: stripLeadSpace(rangeMatch[3]) };
    }

    // Single-value lookup OR weight: "N:" — distinction depends on table type
    const numMatch = trimmed.match(/^(\d+)\s*:(.*)$/s);
    if (numMatch) {
        const n = parseInt(numMatch[1], 10);
        if (tableType === "lookup") {
            return { lookupRange: [n, n], content: stripLeadSpace(numMatch[2]) };
        } else {
            return { weight: n, content: stripLeadSpace(numMatch[2]) };
        }
    }

    // No prefix
    return { content: trimmed };
}

/**
 * Parse a full generator file source into a GeneratorFile AST.
 */
export function parseGeneratorFile(source: string): GeneratorFile {
    const lines = preprocessLines(source);
    const file: GeneratorFile = {
        uses: [],
        topLevelSets: [],
        prompts: [],
        tables: []
    };

    let currentTable: TableDecl | null = null;
    // After "Table: Foo" but before the first item, we're in "table header" mode
    // where Type:, Roll:, Default:, Shuffle: are accepted.
    let inTableHeader = false;

    for (const { text, lineNum } of lines) {
        // Skip blank lines and comments at file level
        const stripped = stripComment(text);
        if (stripped.trim() === "") continue;

        const cmd = matchCommand(stripped);

        if (cmd) {
            const { keyword, rest } = cmd;

            // EndTable closes the current table
            if (keyword === "endtable") {
                if (currentTable) {
                    file.tables.push(currentTable);
                    currentTable = null;
                    inTableHeader = false;
                }
                continue;
            }

            // Table: starts a new table (closes the previous one if any)
            if (keyword === "table") {
                if (currentTable) {
                    file.tables.push(currentTable);
                }
                currentTable = {
                    name: rest.trim(),
                    type: "weighted",
                    shuffleTargets: [],
                    inTableSets: [],
                    items: []
                };
                inTableHeader = true;
                continue;
            }

            // Top-level commands (allowed outside tables OR before items in a table)
            // Several of these can appear inside a table header before items begin.

            if (keyword === "use") {
                file.uses.push(rest.trim());
                continue;
            }

            if (keyword === "header") {
                file.header = rest;
                continue;
            }

            if (keyword === "footer") {
                file.footer = rest;
                continue;
            }

            if (keyword === "title") {
                file.title = rest;
                continue;
            }

            if (keyword === "maxreps") {
                const n = parseInt(rest.trim(), 10);
                if (Number.isNaN(n)) {
                    throw new ParseError("MaxReps: expected integer", lineNum);
                }
                file.maxReps = n;
                continue;
            }

            if (keyword === "formatting") {
                const f = rest.trim().toLowerCase();
                if (f !== "html" && f !== "text") {
                    throw new ParseError(`Formatting: expected 'html' or 'text', got '${f}'`, lineNum);
                }
                file.formatting = f;
                continue;
            }

            if (keyword === "prompt") {
                file.prompts.push(parsePrompt(rest, lineNum));
                continue;
            }

            if (keyword === "set" || keyword === "define") {
                const assignment = parseAssignment(keyword, rest, lineNum);
                if (currentTable && inTableHeader) {
                    currentTable.inTableSets.push(assignment);
                } else if (currentTable) {
                    // Set/Define appearing after items have started — still
                    // attaches to the current table (it'll be evaluated each
                    // time the table is rolled).
                    currentTable.inTableSets.push(assignment);
                } else {
                    file.topLevelSets.push(assignment);
                }
                continue;
            }

            // Table-specific commands — only valid in a table header
            if (keyword === "type") {
                if (!currentTable) throw new ParseError("Type: outside a Table", lineNum);
                const t = rest.trim().toLowerCase();
                if (t === "lookup") currentTable.type = "lookup";
                else if (t === "weighted") currentTable.type = "weighted";
                else if (t === "dictionary") currentTable.type = "dictionary";
                else throw new ParseError(`Type: unknown '${t}'`, lineNum);
                continue;
            }

            if (keyword === "roll") {
                if (!currentTable) throw new ParseError("Roll: outside a Table", lineNum);
                currentTable.rollExpr = rest.trim();
                continue;
            }

            if (keyword === "default") {
                if (!currentTable) throw new ParseError("Default: outside a Table", lineNum);
                currentTable.defaultValue = rest;
                continue;
            }

            if (keyword === "shuffle") {
                if (!currentTable) throw new ParseError("Shuffle: outside a Table", lineNum);
                currentTable.shuffleTargets.push(rest.trim());
                continue;
            }

            // "with" appears only inside table calls, never as a file-level command.
            // Falling through here means treat as item content.
        }

        // Not a command — it's a table item
        if (!currentTable) {
            // Bare content outside a table — IPP3 allows this for "first table"
            // implicit declarations? No — spec says first Table: declares main.
            // Bare content outside any table is malformed; tolerate by ignoring.
            continue;
        }

        // Once we see an item, we're past the table header
        inTableHeader = false;

        // Use the stripped line (with inline `//` comments removed)
        // — earlier this code passed the raw `text` here, which let
        // `//` comments leak into item content.
        const prefix = parseItemPrefix(stripped, currentTable.type);
        const item: TableItem = {
            weight: prefix.weight,
            lookupRange: prefix.lookupRange,
            dictKey: prefix.dictKey,
            rawContent: prefix.content
        };
        currentTable.items.push(item);
    }

    // Flush the last table
    if (currentTable) {
        file.tables.push(currentTable);
    }

    return file;
}
