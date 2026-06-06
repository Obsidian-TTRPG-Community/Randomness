/**
 * Content parser for IPP3 item content.
 *
 * Turns a raw item-content string (the right-hand side of a table item line)
 * into a tree of Node objects that the evaluator can walk.
 *
 * The grammar:
 *
 *   content    ::= ( text | escape | brace | bracket )*
 *   escape     ::= \\ char
 *   brace      ::= { expression }
 *   bracket    ::= [ bracket-body ]
 *   bracket-body ::= '@' subtable-roll-args     -- [@table]
 *                  | '#' subtable-pick-args     -- [#n table]
 *                  | '!' deck-pick-args         -- [!table]
 *                  | '|' inline-table-options   -- [|a|b|c]
 *                  | 'when' ...                 -- [when]...[do]...[end]
 *                  | other ('>>' filter-chain)? -- literal text with filters
 *
 * Bracket contents may contain nested [ ] (for nested table calls), nested
 * { } (for expressions in repetition counts), and escapes. We track depth.
 *
 * Conditionals are special because the [when]...[do]...[end] sequence is not
 * one bracketed token but several — we have to recognise the pattern across
 * adjacent brackets.
 */

import {
    ConditionalNode,
    DeckPickNode,
    DiceNode,
    EscapeNode,
    ExpressionNode,
    FilterCall,
    InlineTableNode,
    LiteralBracketNode,
    Node,
    SubtablePickNode,
    SubtableRollNode,
    TextNode,
    VariableNode
} from "./ast";

export class ContentParseError extends Error {
    constructor(message: string, public position: number) {
        super(`At position ${position}: ${message}`);
        this.name = "ContentParseError";
    }
}

/**
 * Parse a content string into a Node array.
 */
export function parseContent(source: string): Node[] {
    const p = new ContentReader(source);
    return p.parseUntilEnd();
}

/**
 * Cursor-based reader over content text.
 */
class ContentReader {
    private pos = 0;

    constructor(private source: string) {}

    public parseUntilEnd(): Node[] {
        const nodes = this.parseNodes(null);
        if (this.pos < this.source.length) {
            throw new ContentParseError(
                `unexpected trailing content`,
                this.pos
            );
        }
        return this.coalesceConditionals(nodes);
    }

    /**
     * Parse nodes until end-of-source or a closing delimiter is reached.
     * stopAt: characters that should terminate parsing (without consuming them).
     * Used recursively for bracketed/braced regions.
     */
    private parseNodes(stopAt: string | null): Node[] {
        const out: Node[] = [];
        let textBuf = "";

        const flushText = () => {
            if (textBuf.length > 0) {
                out.push({ type: "text", value: textBuf } satisfies TextNode);
                textBuf = "";
            }
        };

        while (this.pos < this.source.length) {
            const ch = this.source[this.pos];
            if (stopAt && stopAt.includes(ch)) {
                break;
            }

            if (ch === "\\") {
                flushText();
                out.push(this.parseEscape());
                continue;
            }

            if (ch === "{") {
                flushText();
                out.push(this.parseBrace());
                continue;
            }

            // Obsidian wiki-syntax pass-through. `[[...]]` and
            // `![[...]]` are recognised by the post-sanitiser
            // link-interpolator and rewritten into `<img>` / `<a>`
            // elements. For that to work, the engine must NOT
            // consume the doubled brackets the way it would for
            // ordinary `[expr]` calls.
            //
            // Approach: when we see `[[` at the top level, emit
            // literal `[[` text and step past it. The character
            // pump then continues with the inner content. Inner
            // `{var}` expressions evaluate normally, so authors
            // can write things like `![[ {filename} .png]]` to
            // build a dynamic embed. The trailing `]]` is just
            // two literal `]` characters in the text stream (a
            // bare `]` outside any bracket is not special to the
            // content parser), so they pass through unchanged.
            //
            // Why not a new AST node: keeping wiki-syntax as raw
            // text means the engine's filter/conditional/dice
            // machinery doesn't need to know anything about it.
            // The post-processor downstream sees the string
            // `[[goblin.png]]` and treats it as a wiki-link;
            // everything in between is the engine's normal job.
            // `[[…]]` disambiguation. Obsidian wiki-links and
            // image embeds (`[[note]]`, `![[image.png]]`) need to
            // pass through as literal text so the post-sanitiser
            // can rewrite them. IPP3 community generators ALSO use
            // `[[…]]` — as an outer "literal" wrap around a
            // conditional or expression, like
            //   Set: X=[[when]{$P}=A[do]X[else]Y[end]]
            // These two uses look identical syntactically; we tell
            // them apart by the content. If the content between
            // `[[` and the next `]]` contains any IPP3 structural
            // marker — `[when]`, `[do]`, `[else]`, `[end]`, or a
            // call sigil like `[@`, `[#`, `[$` — we treat the
            // outer `[` as a regular bracket-expression opener;
            // the inner content's conditional markers will then
            // coalesce normally. If no such marker exists, the
            // `[[…]]` is a wiki-link, so we emit literal `[[`
            // and let the closing `]]` survive as bare text. The
            // `{var}` interpolations don't disqualify a wiki-link
            // — `[[{filename}.png]]` is still a link.
            if (
                ch === "[" &&
                this.pos + 1 < this.source.length &&
                this.source[this.pos + 1] === "["
            ) {
                if (this.looksLikeIpp3Wrap()) {
                    // Fall through to the regular `[` handler
                    // below. The outer `[` opens a literal_bracket
                    // whose text contains `[when]…[end]`; at
                    // render time that text is re-parsed by the
                    // evaluator and the conditional coalesces.
                } else {
                    textBuf += "[[";
                    this.pos += 2;
                    continue;
                }
            }

            if (ch === "[") {
                flushText();
                out.push(this.parseBracket());
                continue;
            }

            textBuf += ch;
            this.pos++;
        }

        flushText();
        return out;
    }

    /**
     * Parse a backslash escape.
     *   \n  → newline node
     *   \t  → tab node
     *   \_  → space node
     *   \z  → empty node
     *   \a  → a/an node
     *   \\  → literal backslash
     *   \X  (any other char) → literal X (used to escape brackets, braces, etc.)
     */
    private parseEscape(): EscapeNode {
        // Consume the backslash
        this.pos++;
        if (this.pos >= this.source.length) {
            // Trailing backslash — treat as literal backslash
            return { type: "escape", kind: "literal", literal: "\\" };
        }
        const next = this.source[this.pos];
        this.pos++;
        switch (next) {
            case "n": return { type: "escape", kind: "n" };
            case "t": return { type: "escape", kind: "t" };
            case "_": return { type: "escape", kind: "_" };
            case "z": return { type: "escape", kind: "z" };
            case "a": return { type: "escape", kind: "a" };
            default:
                return { type: "escape", kind: "literal", literal: next };
        }
    }

    /**
     * Parse a `{...}` brace region.
     * Distinguishes between:
     *   - {name}        → variable reference
     *   - {$name}       → variable reference (legacy)
     *   - {NdN[+-]N}    → dice roll
     *   - {!math}       → legacy math expression marker
     *   - {expression}  → general expression
     *
     * Inner braces are balanced (for nested expressions like {a + {b}}).
     */
    private parseBrace(): ExpressionNode | DiceNode | VariableNode {
        // Consume opening {
        const startPos = this.pos;
        this.pos++;

        let depth = 1;
        let inner = "";
        while (this.pos < this.source.length && depth > 0) {
            const ch = this.source[this.pos];
            if (ch === "\\" && this.pos + 1 < this.source.length) {
                // Escape inside brace — pass through the next char literally
                inner += ch + this.source[this.pos + 1];
                this.pos += 2;
                continue;
            }
            if (ch === "{") {
                depth++;
                inner += ch;
                this.pos++;
                continue;
            }
            if (ch === "}") {
                depth--;
                this.pos++;
                if (depth === 0) break;
                inner += ch;
                continue;
            }
            inner += ch;
            this.pos++;
        }
        if (depth !== 0) {
            throw new ContentParseError("unclosed '{'", startPos);
        }

        const trimmed = inner.trim();

        // Legacy {!expr} → strip the leading !
        const expressionSource = trimmed.startsWith("!")
            ? trimmed.slice(1).trim()
            : trimmed;

        // Pure variable reference: {name} or {$name} — identifier only, no operators or whitespace
        // Match: optional $, then identifier chars
        const varMatch = expressionSource.match(/^\$?([A-Za-z_][A-Za-z0-9_]*)$/);
        if (varMatch) {
            return { type: "variable", name: varMatch[1] };
        }

        // Special: {$1}, {$2} for table parameters — purely numeric after $
        const paramMatch = expressionSource.match(/^\$(\d+)$/);
        if (paramMatch) {
            return { type: "variable", name: paramMatch[1] };
        }

        // Pure dice expression: NdN, NdN+N, NdN-N, ndn*n, etc.
        // We're lenient: any expression containing only digits, d/D, +-*/, spaces, parens.
        // The dedicated dice path is mainly a fast lane; the expression evaluator handles it too.
        // Detect "pure dice" only when it looks like one die OR sum/diff of dice and constants.
        const pureDice = /^\d+\s*[dD]\s*\d+(\s*[+\-*\/]\s*\d+(\s*[dD]\s*\d+)?)*$/.test(expressionSource);
        if (pureDice) {
            return { type: "dice", source: expressionSource };
        }

        // General expression — assignments, math, function calls, table calls inside {…} for math etc.
        return { type: "expression", source: expressionSource };
    }

    /**
     * At a `[[` opener, decide whether this is an Obsidian wiki-link
     * (default — pass through as literal text) or an IPP3 "wrapped
     * expression" like `[[when]…[end]]` (parse outer as a regular
     * bracket so the inner content can re-parse and coalesce its
     * conditional markers).
     *
     * Heuristic: scan forward from the current position looking for
     * a closing `]]`. Inside that window, if we find any IPP3
     * structural marker — `[when]`, `[when not]`, `[do]`, `[else]`,
     * `[end]`, or a call sigil `[@`, `[#`, `[$` — it's a wrapped
     * expression. Otherwise it's a wiki-link. `{var}` interpolations
     * don't qualify either way, so `[[{filename}.png]]` stays a link
     * and `[[when]{$x}=y[do]…[end]]` is recognised as an expression.
     *
     * We bound the scan to keep this cheap; community generators
     * sometimes have very long wrap contents (e.g. nested when
     * chains spanning a few hundred chars), so we look at up to 4 KB
     * which is well past anything realistic. If we exhaust that
     * without finding a closing `]]`, fall back to treating the
     * input as a wiki-link (safer default).
     */
    private looksLikeIpp3Wrap(): boolean {
        const SCAN_LIMIT = 4096;
        const start = this.pos + 2; // skip the [[
        const end = Math.min(start + SCAN_LIMIT, this.source.length);
        // Find ]] within the window (the matching close for this [[).
        // We don't care about nested-bracket depth for the disambig
        // decision — the IPP3 markers we're looking for are
        // unambiguous, so any occurrence inside the [[ … ]] window
        // is decisive.
        let closePos = -1;
        for (let i = start; i < end - 1; i++) {
            if (this.source[i] === "]" && this.source[i + 1] === "]") {
                closePos = i;
                break;
            }
        }
        if (closePos === -1) return false; // no closer → safe default

        const window = this.source.slice(start, closePos);
        return /\[(?:when not|when|do|else|end)\]/i.test(window) ||
            /\[[@#$]/.test(window);
    }

    /**
     * Parse a `[...]` bracketed region.
     */
    private parseBracket(): Node {
        const startPos = this.pos;
        // Consume [
        this.pos++;

        // Read inner content up to matching ], respecting nested [ ] { }
        const inner = this.readBalancedBrackets();

        // Now classify
        return this.classifyBracket(inner, startPos);
    }

    /**
     * Read until the matching closing bracket, returning the raw inner text.
     * Tracks nested brackets and braces. Respects backslash escapes.
     */
    private readBalancedBrackets(): string {
        let depth = 1;
        let buf = "";
        let braceDepth = 0;
        const startPos = this.pos;
        while (this.pos < this.source.length && depth > 0) {
            const ch = this.source[this.pos];
            if (ch === "\\" && this.pos + 1 < this.source.length) {
                buf += ch + this.source[this.pos + 1];
                this.pos += 2;
                continue;
            }
            if (ch === "{") {
                braceDepth++;
                buf += ch;
                this.pos++;
                continue;
            }
            if (ch === "}") {
                if (braceDepth > 0) braceDepth--;
                buf += ch;
                this.pos++;
                continue;
            }
            // Only count [ and ] for depth when not inside a brace expression
            if (braceDepth === 0 && ch === "[") {
                depth++;
                buf += ch;
                this.pos++;
                continue;
            }
            if (braceDepth === 0 && ch === "]") {
                depth--;
                this.pos++;
                if (depth === 0) return buf;
                buf += ch;
                continue;
            }
            buf += ch;
            this.pos++;
        }
        throw new ContentParseError("unclosed '['", startPos);
    }

    /**
     * Determine what kind of bracket this is and produce the right Node.
     */
    private classifyBracket(inner: string, startPos: number): Node {
        // Split off filter chain — find " >> " at the top level (not inside nested brackets).
        // Filters are always at the end and applied left-to-right.
        const { body, filters } = splitFilters(inner);

        // Sub-table roll: [@…]
        if (body.startsWith("@")) {
            return parseSubtableCall(body.slice(1), filters, "subtable_roll");
        }
        // Sub-table pick: [#…]
        if (body.startsWith("#")) {
            return parseSubtableCall(body.slice(1), filters, "subtable_pick");
        }
        // Deck pick: [!…]
        if (body.startsWith("!")) {
            return parseSubtableCall(body.slice(1), filters, "deck_pick");
        }
        // Inline table: [|a|b|c]
        if (body.startsWith("|")) {
            // Strip leading | and split — but options may contain nested expressions
            const optionsRaw = body.slice(1);
            const options = splitInlineOptions(optionsRaw);
            return { type: "inline_table", options, filters } satisfies InlineTableNode;
        }

        // Conditional markers — handled here as raw markers; coalescing
        // [when]...[do]...[else]...[end] into ConditionalNode happens in a
        // post-pass. We emit a special LiteralBracketNode-like marker.
        const lowerBody = body.toLowerCase().trim();
        if (
            lowerBody === "when" ||
            lowerBody === "when not" ||
            lowerBody === "do" ||
            lowerBody === "else" ||
            lowerBody === "end"
        ) {
            // Use literal_bracket as a transport marker for the conditional pass
            return {
                type: "literal_bracket",
                text: "[" + body + "]",  // preserve original for coalescing detection
                filters: []
            } satisfies LiteralBracketNode;
        }

        // Otherwise: literal text in brackets, possibly with filters
        return {
            type: "literal_bracket",
            text: body,
            filters
        } satisfies LiteralBracketNode;
    }

    /**
     * Post-pass: identify [when]...[do]...[else]...[end] sequences and merge
     * them into ConditionalNode. The interleaved nodes between markers become
     * the condition/then/else source — but we lose easy access to the original
     * text. So we serialise the nodes back to source for storage in the
     * ConditionalNode, where they'll be re-parsed when evaluated.
     *
     * Alternatively, we could store nodes directly — but the IPP3 spec says
     * conditionals can't be nested, so a single re-parse pass is fine and
     * keeps the evaluator's job cleaner.
     */
    private coalesceConditionals(nodes: Node[]): Node[] {
        const out: Node[] = [];
        let i = 0;
        while (i < nodes.length) {
            const n = nodes[i];
            if (n.type === "literal_bracket") {
                const marker = isMarker(n);
                if (marker === "when" || marker === "when not") {
                    // Find matching [do], optional [else], and [end]
                    let doIdx = -1, elseIdx = -1, endIdx = -1;
                    for (let j = i + 1; j < nodes.length; j++) {
                        const sub = nodes[j];
                        if (sub.type !== "literal_bracket") continue;
                        const m = isMarker(sub);
                        if (!m) continue;
                        if (m === "do" && doIdx === -1) doIdx = j;
                        else if (m === "else" && elseIdx === -1 && doIdx !== -1) elseIdx = j;
                        else if (m === "end") { endIdx = j; break; }
                    }
                    if (doIdx === -1 || endIdx === -1) {
                        throw new ContentParseError(
                            `[${marker}] without matching [do]/[end]`,
                            0
                        );
                    }
                    const conditionNodes = nodes.slice(i + 1, doIdx);
                    const thenNodes = elseIdx !== -1
                        ? nodes.slice(doIdx + 1, elseIdx)
                        : nodes.slice(doIdx + 1, endIdx);
                    const elseNodes = elseIdx !== -1
                        ? nodes.slice(elseIdx + 1, endIdx)
                        : null;
                    out.push({
                        type: "conditional",
                        negated: marker === "when not",
                        conditionSource: nodesToSource(conditionNodes),
                        thenSource: nodesToSource(thenNodes),
                        elseSource: elseNodes ? nodesToSource(elseNodes) : undefined
                    } satisfies ConditionalNode);
                    i = endIdx + 1;
                    continue;
                }
            }
            out.push(n);
            i++;
        }
        return out;
    }
}

function isMarker(n: Node): string | null {
    if (n.type !== "literal_bracket") return null;
    // The marker form preserved the brackets; non-marker literal_bracket has just text
    const m = n.text.match(/^\[(when not|when|do|else|end)\]$/i);
    return m ? m[1].toLowerCase() : null;
}

/**
 * Serialise a Node array back to source. Used when storing conditional
 * branches for later re-evaluation. Round-trips correctly only for the subset
 * of nodes we actually emit before coalescing.
 */
function nodesToSource(nodes: Node[]): string {
    let out = "";
    for (const n of nodes) {
        switch (n.type) {
            case "text": out += n.value; break;
            case "escape":
                out += "\\";
                if (n.kind === "literal" && n.literal) out += n.literal;
                else out += n.kind;
                break;
            case "expression": out += "{" + n.source + "}"; break;
            case "dice": out += "{" + n.source + "}"; break;
            case "variable": out += "{" + n.name + "}"; break;
            case "subtable_roll": out += renderCall(n, "@"); break;
            case "subtable_pick": out += renderCall(n, "#"); break;
            case "deck_pick": out += renderCall(n, "!"); break;
            case "inline_table":
                out += "[|" + n.options.join("|") + "]";
                break;
            case "literal_bracket": out += n.text.startsWith("[") ? n.text : "[" + n.text + "]"; break;
            case "conditional":
                // Shouldn't appear before coalescing, but handle anyway
                out += "[" + (n.negated ? "when not" : "when") + "]" + n.conditionSource;
                out += "[do]" + n.thenSource;
                if (n.elseSource) out += "[else]" + n.elseSource;
                out += "[end]";
                break;
        }
    }
    return out;
}

function renderCall(n: SubtableRollNode | SubtablePickNode | DeckPickNode, sigil: string): string {
    let s = "[" + sigil;
    if (n.type === "subtable_pick" && n.indexSource) s += n.indexSource + " ";
    if (n.repsSource) s += n.repsSource + " ";
    if (n.assignVar) s += n.assignVar + (n.assignQuiet ? "==" : "=");
    s += n.tableSource;
    if (n.withParams.length > 0) s += " with " + n.withParams.join(", ");
    for (const f of n.filters) {
        s += " >> " + f.name + (f.args ? " " + f.args : "");
    }
    s += "]";
    return s;
}

/**
 * Split inline table options on top-level `|` (not inside nested brackets).
 */
function splitInlineOptions(src: string): string[] {
    const opts: string[] = [];
    let buf = "";
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (ch === "\\" && i + 1 < src.length) {
            buf += ch + src[i + 1];
            i++;
            continue;
        }
        if (ch === "[") { bracketDepth++; buf += ch; continue; }
        if (ch === "]") { bracketDepth--; buf += ch; continue; }
        if (ch === "{") { braceDepth++; buf += ch; continue; }
        if (ch === "}") { braceDepth--; buf += ch; continue; }
        if (ch === "|" && bracketDepth === 0 && braceDepth === 0) {
            opts.push(buf);
            buf = "";
            continue;
        }
        buf += ch;
    }
    opts.push(buf);
    return opts;
}

/**
 * Split a bracket body into (body without filters, filter list).
 * Finds top-level `>>` (not inside nested brackets/braces).
 */
function splitFilters(inner: string): { body: string; filters: FilterCall[] } {
    // Find all top-level ">>" positions
    const positions: number[] = [];
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let i = 0; i < inner.length - 1; i++) {
        const ch = inner[i];
        if (ch === "\\" && i + 1 < inner.length) { i++; continue; }
        if (ch === "[") bracketDepth++;
        else if (ch === "]") bracketDepth--;
        else if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        else if (ch === ">" && inner[i + 1] === ">" && bracketDepth === 0 && braceDepth === 0) {
            positions.push(i);
            i++; // skip next >
        }
    }
    if (positions.length === 0) return { body: inner, filters: [] };

    const body = inner.slice(0, positions[0]);
    const filters: FilterCall[] = [];
    for (let i = 0; i < positions.length; i++) {
        const start = positions[i] + 2;
        const end = i + 1 < positions.length ? positions[i + 1] : inner.length;
        const filterText = inner.slice(start, end).trim();
        // Split name from args at first whitespace
        const ws = filterText.search(/\s/);
        if (ws === -1) {
            filters.push({ name: filterText.toLowerCase(), args: "" });
        } else {
            filters.push({
                name: filterText.slice(0, ws).toLowerCase(),
                args: filterText.slice(ws + 1).trim()
            });
        }
    }
    return { body, filters };
}

/**
 * Parse the body of a sub-table call (whatever was inside [@…], [#…], or [!…]).
 *
 * Format:
 *   [optional-var-assignment] [optional-reps] table-name [with params]
 *
 * Where:
 *   var-assignment = identifier '=' or '=='
 *   reps           = number, {dice}, or {variable}
 *   table-name     = identifier or {variable}; may contain spaces
 *   with params    = 'with' csv-expressions
 *
 * The parser needs to be permissive — table names can contain spaces (eg
 * "Common Place Names"), and reps can be dice/variables. We handle the
 * common cases:
 *   [@HumanName]
 *   [@5 HumanName]
 *   [@{1d6} HumanName]
 *   [@myvar=HumanName]
 *   [@myvar=5 skills with {$class}]
 *   [#5 NextTable]
 *   [#{class} hitdice]
 *   [!5 skills]
 *
 * For [#…], the leading number/expression is the *index* (not reps).
 */
function parseSubtableCall(
    body: string,
    filters: FilterCall[],
    kind: "subtable_roll" | "subtable_pick" | "deck_pick"
): SubtableRollNode | SubtablePickNode | DeckPickNode {
    const trimmed = body.trim();
    let rest = trimmed;

    // 1. Check for variable assignment: `var=...` or `var==...`
    //    Must be at the start, var must be a plain identifier.
    let assignVar: string | undefined;
    let assignQuiet = false;
    const assignMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)(==|=)(?!=)/);
    if (assignMatch) {
        assignVar = assignMatch[1];
        assignQuiet = assignMatch[2] === "==";
        rest = rest.slice(assignMatch[0].length);
    }

    // 2. Check for reps/index: number or {expression} or {$var} followed by whitespace
    //    For [#…], this is the index; for others, it's the reps.
    let leadingExprSource: string | undefined;
    // For [#"quoted key" Table], the literal dictionary key (used
    // instead of leadingExprSource so the key is passed through to
    // the evaluator verbatim, no expression evaluation).
    let pickLiteralKey: string | undefined;
    // Try {…} first
    if (rest.startsWith("{")) {
        const braceMatch = matchLeadingBrace(rest);
        if (braceMatch) {
            // Only consume if followed by whitespace (means it's reps, not the table name)
            // Edge case: [@{1d6} weapons] — yes consume.
            // Edge case: [@{$tablename}] — no consume, that's the table itself.
            const after = rest.slice(braceMatch.length);
            if (/^\s+/.test(after) && after.trim().length > 0) {
                // Keep the surrounding braces in the source so both
                // paths can resolve correctly: `evalRollExpression`
                // handles `{1d6}` and `evalRawText` (used for dict
                // keys) renders `{var}` via variable substitution.
                // Stripping the braces here would lose the variable-
                // reference signal — `evalRawText("class")` produces
                // literal "class" instead of the variable's value.
                leadingExprSource = braceMatch;
                rest = after.replace(/^\s+/, "");
            }
        }
    } else if (kind === "subtable_pick") {
        // For `[#<key> <table>]`, the key can be either a number
        // (lookup-roll-style pick) or an identifier (dictionary
        // key). Accept the first whitespace-delimited token as the
        // index if a second token exists; if there's only one
        // token, it's the table name (`[#tableName]` = current-
        // index pick).
        //
        // For dictionary keys with spaces or other characters that
        // whitespace-split would mishandle, quote the key:
        //   [#"Knight Bachelor" Occupation]
        //   [#"key, with: punctuation" Table]
        // Quoted keys capture everything up to the closing quote
        // (with backslash escape for embedded "). Unquoted keys
        // remain whitespace-delimited for back-compat — every
        // hyphen/underscore/dotted key that worked before still
        // works.
        //
        // The evaluator decides what to do based on table type at
        // run time: numeric token + lookup table → range match;
        // numeric token + weighted → positional; string token +
        // dictionary → key lookup. Quoted keys are passed as
        // literalKey on the AST node so the evaluator skips
        // expression evaluation on the key entirely.
        if (rest.startsWith('"')) {
            // Walk until the matching unescaped closing quote.
            let end = -1;
            for (let i = 1; i < rest.length; i++) {
                if (rest[i] === "\\" && i + 1 < rest.length) {
                    i++; // skip escaped char
                    continue;
                }
                if (rest[i] === '"') {
                    end = i;
                    break;
                }
            }
            if (end > 0) {
                // Unescape \" inside the captured key.
                pickLiteralKey = rest.slice(1, end).replace(/\\"/g, '"');
                rest = rest.slice(end + 1).replace(/^\s+/, "");
            }
        } else {
            const splitMatch = rest.match(/^(\S+)\s+(\S.*)$/);
            if (splitMatch) {
                leadingExprSource = splitMatch[1];
                rest = splitMatch[2];
            }
        }
    } else {
        // For [@…] and [!…], the leading token (if any) is reps,
        // which is a number or {expression}. Bare identifiers
        // aren't accepted here — those are part of the table name.
        const numMatch = rest.match(/^(\d+)\s+(\S.*)$/);
        if (numMatch) {
            leadingExprSource = numMatch[1];
            rest = numMatch[2];
        }
    }

    // 3. Check for `with` clause — split at " with " (case-insensitive, top-level)
    let withParams: string[] = [];
    const withSplit = splitAtTopLevelWith(rest);
    if (withSplit) {
        rest = withSplit.before;
        withParams = withSplit.params;
    }

    // What's left is the table name source.
    const tableSource = rest.trim();

    if (kind === "subtable_pick") {
        return {
            type: "subtable_pick",
            indexSource: leadingExprSource,
            literalKey: pickLiteralKey,
            tableSource,
            withParams,
            filters,
            assignVar,
            assignQuiet
        };
    } else {
        return {
            type: kind,
            repsSource: leadingExprSource,
            tableSource,
            withParams,
            filters,
            assignVar,
            assignQuiet
        };
    }
}

/** Match a leading {…} (possibly nested), return the full match including braces. */
function matchLeadingBrace(s: string): string | null {
    if (s[0] !== "{") return null;
    let depth = 1;
    let i = 1;
    while (i < s.length && depth > 0) {
        if (s[i] === "\\" && i + 1 < s.length) { i += 2; continue; }
        if (s[i] === "{") depth++;
        else if (s[i] === "}") depth--;
        i++;
    }
    if (depth !== 0) return null;
    return s.slice(0, i);
}

/**
 * Split a call body at the top-level " with " keyword (case-insensitive).
 * Returns null if no `with` is present.
 */
function splitAtTopLevelWith(s: string): { before: string; params: string[] } | null {
    // Search for " with " at depth 0
    const lower = s.toLowerCase();
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let i = 0; i < s.length - 5; i++) {
        const ch = s[i];
        if (ch === "\\" && i + 1 < s.length) { i++; continue; }
        if (ch === "[") bracketDepth++;
        else if (ch === "]") bracketDepth--;
        else if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        else if (
            bracketDepth === 0 &&
            braceDepth === 0 &&
            /\s/.test(ch) &&
            lower.slice(i + 1, i + 5) === "with" &&
            /\s/.test(s[i + 5] ?? "")
        ) {
            const before = s.slice(0, i);
            const paramsRaw = s.slice(i + 5).trim();
            const params = splitParams(paramsRaw);
            return { before, params };
        }
    }
    return null;
}

/** Split `with` parameters on top-level commas. */
function splitParams(src: string): string[] {
    const params: string[] = [];
    let buf = "";
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (ch === "\\" && i + 1 < src.length) { buf += ch + src[i + 1]; i++; continue; }
        if (ch === "[") bracketDepth++;
        else if (ch === "]") bracketDepth--;
        else if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        if (ch === "," && bracketDepth === 0 && braceDepth === 0) {
            params.push(buf.trim());
            buf = "";
            continue;
        }
        buf += ch;
    }
    if (buf.length > 0) params.push(buf.trim());
    return params;
}
