/**
 * Expression evaluator for IPP3 {...} expressions.
 *
 * Supports:
 *   - Numbers (integer and decimal)
 *   - String literals: 'text'
 *   - Variable references: identifiers
 *   - Dice rolls: NdN, with optional modifier
 *   - Arithmetic: + - * / ^ (and parens)
 *   - Comparison: = < > <= >= <>
 *   - Function calls: if(), max(), min(), sqrt(), abs(), round(), floor(),
 *                     ceil(), sign(), length(), trim(), substr()
 *   - Assignment: var = expr (output the value), var == expr (quiet)
 *   - Embedded table calls: [@…], [#…], [!…], [|…]  — yes, these are valid inside
 *     expressions and are evaluated to text/number before use.
 *
 * Embedded calls and conditional handling are passed in via a callback from
 * the main evaluator, since they require access to the table registry and
 * variable scope.
 *
 * The expression evaluator returns a Value (number or string), and is given
 * an EvalContext that exposes variables and the ability to call sub-tables.
 */

import { RNG } from "./rng";

export type Value = number | string;

export interface ExprContext {
    /** Get the current value of a variable. Returns "" if undefined. */
    getVar(name: string): Value;
    /** Set a variable value. */
    setVar(name: string, value: Value): void;
    /** Evaluate an embedded table call (raw source between [ and ]) — returns the rendered text. */
    evalEmbeddedCall(rawBracketBody: string): string;
    /** RNG for dice */
    rng: RNG;
}

export class ExpressionError extends Error {
    constructor(message: string) {
        super(`Expression error: ${message}`);
        this.name = "ExpressionError";
    }
}

/**
 * Evaluate an expression and return its value.
 * If isAssignment returns non-null, the assignment was the top-level form;
 * the caller can decide whether to output the value (quiet=false) or not.
 */
export function evaluateExpression(
    source: string,
    ctx: ExprContext
): { value: Value; assignedVarName?: string; quiet: boolean } {
    // Detect top-level assignment: "name = expr" or "name == expr"
    // Use a careful scan, not a regex, because "=" appears in comparisons.
    const trimmed = source.trim();
    const assignMatch = matchAssignment(trimmed);
    if (assignMatch) {
        const { name, quiet, rhs } = assignMatch;
        const parser = new ExprParser(rhs, ctx);
        const v = parser.parseAndFinish();
        ctx.setVar(name, v);
        return { value: v, assignedVarName: name, quiet };
    }
    const parser = new ExprParser(trimmed, ctx);
    const v = parser.parseAndFinish();
    return { value: v, quiet: false };
}

/**
 * Scan for top-level `name = expr` or `name == expr` form.
 * Returns null if the expression doesn't start with an assignment pattern.
 */
function matchAssignment(s: string): { name: string; quiet: boolean; rhs: string } | null {
    // Identifier
    const idMatch = s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*/);
    if (!idMatch) return null;
    const name = idMatch[1];
    let pos = idMatch[0].length;
    if (pos >= s.length) return null;
    if (s[pos] !== "=") return null;
    pos++;
    // Check for == (quiet)
    let quiet = false;
    if (pos < s.length && s[pos] === "=") {
        // == is quiet ONLY if not followed by another = (which would be ===)
        // Otherwise == is comparison.
        if (pos + 1 < s.length && s[pos + 1] === "=") {
            // === - bizarre, treat as no-assignment
            return null;
        }
        // Could be "a == b" comparison or "a == expr" quiet assignment.
        // The grammar is ambiguous here — IPP3 spec example "myvar==1+2+3" implies
        // quiet assignment. So we treat == at start as quiet assignment.
        quiet = true;
        pos++;
    }
    return { name, quiet, rhs: s.slice(pos) };
}

// ─────────────────────── Recursive-descent parser ───────────────────────
/*
 * Grammar:
 *   expr      → comparison
 *   comparison→ additive ( (= | < | > | <= | >= | <>) additive )*
 *   additive  → multiplicative ( (+|-) multiplicative )*
 *   multiplicative → power ( (*|/) power )*
 *   power     → unary ( ^ unary )*
 *   unary     → -unary | primary
 *   primary   → NUMBER | STRING | dice | call | '(' expr ')' | embedded_bracket
 */

class ExprParser {
    private pos = 0;

    constructor(private source: string, private ctx: ExprContext) {}

    parseAndFinish(): Value {
        this.skipWs();
        const v = this.parseExpr();
        this.skipWs();
        if (this.pos < this.source.length) {
            throw new ExpressionError(
                `unexpected content at position ${this.pos}: '${this.source.slice(this.pos)}'`
            );
        }
        return v;
    }

    private skipWs() {
        while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) this.pos++;
    }

    private peek(): string {
        return this.source[this.pos] ?? "";
    }

    private match(s: string): boolean {
        if (this.source.startsWith(s, this.pos)) {
            this.pos += s.length;
            return true;
        }
        return false;
    }

    private parseExpr(): Value {
        return this.parseComparison();
    }

    private parseComparison(): Value {
        let left = this.parseAdditive();
        this.skipWs();
        // Comparison operators: <=, >=, <>, =, <, >
        while (true) {
            this.skipWs();
            let op: string | null = null;
            if (this.match("<=")) op = "<=";
            else if (this.match(">=")) op = ">=";
            else if (this.match("<>")) op = "<>";
            else if (this.match("=")) op = "=";
            else if (this.match("<")) op = "<";
            else if (this.match(">")) op = ">";
            if (!op) break;
            const right = this.parseAdditive();
            left = compareValues(left, right, op);
        }
        return left;
    }

    private parseAdditive(): Value {
        let left = this.parseMultiplicative();
        while (true) {
            this.skipWs();
            const ch = this.peek();
            if (ch === "+") {
                this.pos++;
                const right = this.parseMultiplicative();
                left = addValues(left, right);
            } else if (ch === "-") {
                this.pos++;
                const right = this.parseMultiplicative();
                left = subValues(left, right);
            } else break;
        }
        return left;
    }

    private parseMultiplicative(): Value {
        let left = this.parsePower();
        while (true) {
            this.skipWs();
            const ch = this.peek();
            if (ch === "*") {
                this.pos++;
                const right = this.parsePower();
                left = mulValues(left, right);
            } else if (ch === "/") {
                this.pos++;
                const right = this.parsePower();
                left = divValues(left, right);
            } else break;
        }
        return left;
    }

    private parsePower(): Value {
        let left = this.parseUnary();
        this.skipWs();
        if (this.peek() === "^") {
            this.pos++;
            // Right-associative
            const right = this.parsePower();
            left = Math.pow(toNum(left), toNum(right));
        }
        return left;
    }

    private parseUnary(): Value {
        this.skipWs();
        if (this.peek() === "-") {
            this.pos++;
            return -toNum(this.parseUnary());
        }
        if (this.peek() === "+") {
            this.pos++;
            return this.parseUnary();
        }
        return this.parsePrimary();
    }

    private parsePrimary(): Value {
        this.skipWs();
        const ch = this.peek();

        // Parenthesised
        if (ch === "(") {
            this.pos++;
            const v = this.parseExpr();
            this.skipWs();
            if (this.peek() !== ")") throw new ExpressionError("missing ')'");
            this.pos++;
            return v;
        }

        // String literal
        if (ch === "'" || ch === '"') {
            return this.parseString(ch);
        }

        // Embedded bracket [...]
        if (ch === "[") {
            return this.parseEmbeddedBracket();
        }

        // Number — possibly leading into a dice roll
        if (/[0-9.]/.test(ch)) {
            return this.parseNumberOrDice();
        }

        // Identifier — variable or function call.  Also handle legacy $name form.
        if (/[A-Za-z_$]/.test(ch)) {
            return this.parseIdentifierOrCall();
        }

        // Embedded brace expression — {expr} inside an expression
        if (ch === "{") {
            this.pos++;
            // Read until matching }
            let depth = 1;
            const start = this.pos;
            while (this.pos < this.source.length && depth > 0) {
                if (this.source[this.pos] === "{") depth++;
                else if (this.source[this.pos] === "}") depth--;
                if (depth > 0) this.pos++;
            }
            const inner = this.source.slice(start, this.pos);
            this.pos++; // consume closing }
            return evaluateExpression(inner, this.ctx).value;
        }

        throw new ExpressionError(`unexpected character '${ch}' at position ${this.pos}`);
    }

    private parseString(quote: string): string {
        this.pos++; // opening quote
        let buf = "";
        while (this.pos < this.source.length && this.source[this.pos] !== quote) {
            if (this.source[this.pos] === "\\" && this.pos + 1 < this.source.length) {
                buf += this.source[this.pos + 1];
                this.pos += 2;
                continue;
            }
            buf += this.source[this.pos];
            this.pos++;
        }
        if (this.pos >= this.source.length) throw new ExpressionError(`unterminated string`);
        this.pos++; // closing quote
        return buf;
    }

    private parseEmbeddedBracket(): Value {
        // Read balanced bracket content, pass to evaluator callback
        this.pos++; // [
        let depth = 1;
        let braceDepth = 0;
        const start = this.pos;
        while (this.pos < this.source.length && depth > 0) {
            const c = this.source[this.pos];
            if (c === "\\" && this.pos + 1 < this.source.length) { this.pos += 2; continue; }
            if (c === "{") braceDepth++;
            else if (c === "}") braceDepth--;
            else if (braceDepth === 0 && c === "[") depth++;
            else if (braceDepth === 0 && c === "]") {
                depth--;
                if (depth === 0) break;
            }
            this.pos++;
        }
        const inner = this.source.slice(start, this.pos);
        if (this.peek() !== "]") throw new ExpressionError(`unclosed '[' in expression`);
        this.pos++; // ]
        const text = this.ctx.evalEmbeddedCall(inner);
        // Try to coerce to number if it looks like one
        const trimmed = text.trim();
        if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
            return Number(trimmed);
        }
        return text;
    }

    private parseNumberOrDice(): Value {
        // Read digits (and dot for decimals)
        let numStr = "";
        while (this.pos < this.source.length && /[0-9.]/.test(this.source[this.pos])) {
            numStr += this.source[this.pos];
            this.pos++;
        }
        const n = parseFloat(numStr);
        // Check for dice continuation: NdN — but also allow the
        // sides to come from an embedded sub-expression like
        // `1d[@dietype]` (sub-table call returning a number) or
        // `1d{1d4+4}` (nested dice/math expression returning a
        // number). IPP3 calls this "nesting" and it's a documented
        // pattern.
        if (this.peek() === "d" || this.peek() === "D") {
            this.pos++;
            let sides: number;
            const next = this.peek();
            if (next === "[") {
                // Sub-table call — evaluate as a value, expect numeric
                const v = this.parseEmbeddedBracket();
                sides = Math.floor(Number(v));
                if (Number.isNaN(sides)) {
                    throw new ExpressionError(
                        "embedded expression for dice sides did not yield a number"
                    );
                }
            } else if (next === "{") {
                // Nested {...} expression
                const v = this.parsePrimary(); // handles { case at line ~268
                sides = Math.floor(Number(v));
                if (Number.isNaN(sides)) {
                    throw new ExpressionError(
                        "nested expression for dice sides did not yield a number"
                    );
                }
            } else {
                // Numeric sides (the common case)
                let sidesStr = "";
                while (
                    this.pos < this.source.length &&
                    /[0-9]/.test(this.source[this.pos])
                ) {
                    sidesStr += this.source[this.pos];
                    this.pos++;
                }
                if (sidesStr === "")
                    throw new ExpressionError(
                        "expected dice sides after 'd'"
                    );
                sides = parseInt(sidesStr, 10);
            }
            return this.ctx.rng.rollDice(n, sides);
        }
        return n;
    }

    private parseIdentifierOrCall(): Value {
        let id = "";
        // Consume optional $ prefix (legacy variable reference)
        if (this.source[this.pos] === "$") {
            this.pos++;
            // After `$`, the variable name can be an embedded
            // sub-expression: `{$[@table]}` looks up a variable
            // whose name is the result of rolling on `table`.
            // IPP3 calls this "variable variables" (see the
            // Nesting docs). Same goes for `{$ {name} }` — a
            // nested expression resolving to the variable name —
            // though that form is rarer.
            if (this.peek() === "[") {
                const nameValue = this.parseEmbeddedBracket();
                return this.ctx.getVar(String(nameValue).trim());
            }
            if (this.peek() === "{") {
                // Nested {...} returning the variable name
                const nameValue = this.parsePrimary();
                return this.ctx.getVar(String(nameValue).trim());
            }
        }
        while (this.pos < this.source.length && /[A-Za-z0-9_]/.test(this.source[this.pos])) {
            id += this.source[this.pos];
            this.pos++;
        }
        this.skipWs();
        // Function call?
        if (this.peek() === "(") {
            this.pos++;
            const args: Value[] = [];
            this.skipWs();
            if (this.peek() !== ")") {
                args.push(this.parseExpr());
                this.skipWs();
                while (this.peek() === ",") {
                    this.pos++;
                    args.push(this.parseExpr());
                    this.skipWs();
                }
            }
            if (this.peek() !== ")") throw new ExpressionError("missing ')' in function call");
            this.pos++;
            return callFunction(id.toLowerCase(), args);
        }
        // Variable reference
        return this.ctx.getVar(id);
    }
}

// ─────────────────────── Helpers ───────────────────────

function toNum(v: Value): number {
    if (typeof v === "number") return v;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
}

function toStr(v: Value): string {
    return typeof v === "string" ? v : String(v);
}

function addValues(a: Value, b: Value): Value {
    if (typeof a === "string" || typeof b === "string") {
        // String concatenation when either is non-numeric
        if (typeof a === "number" && typeof b === "string" && !Number.isNaN(Number(b))) {
            return a + Number(b);
        }
        if (typeof b === "number" && typeof a === "string" && !Number.isNaN(Number(a))) {
            return Number(a) + b;
        }
        return toStr(a) + toStr(b);
    }
    return a + b;
}
function subValues(a: Value, b: Value): number { return toNum(a) - toNum(b); }
function mulValues(a: Value, b: Value): number { return toNum(a) * toNum(b); }
function divValues(a: Value, b: Value): number {
    const d = toNum(b);
    return d === 0 ? 0 : toNum(a) / d;
}

function compareValues(a: Value, b: Value, op: string): number {
    // Numeric compare if both look like numbers; else string compare.
    const aNum = typeof a === "number" ? a : (Number.isNaN(Number(a)) ? null : Number(a));
    const bNum = typeof b === "number" ? b : (Number.isNaN(Number(b)) ? null : Number(b));
    let result: boolean;
    if (aNum !== null && bNum !== null) {
        switch (op) {
            case "=": result = aNum === bNum; break;
            case "<>": result = aNum !== bNum; break;
            case "<": result = aNum < bNum; break;
            case ">": result = aNum > bNum; break;
            case "<=": result = aNum <= bNum; break;
            case ">=": result = aNum >= bNum; break;
            default: result = false;
        }
    } else {
        const aS = toStr(a);
        const bS = toStr(b);
        switch (op) {
            case "=": result = aS === bS; break;
            case "<>": result = aS !== bS; break;
            case "<": result = aS < bS; break;
            case ">": result = aS > bS; break;
            case "<=": result = aS <= bS; break;
            case ">=": result = aS >= bS; break;
            default: result = false;
        }
    }
    // Return 1/0 numerically — IPP3 booleans aren't a distinct type
    return result ? 1 : 0;
}

function callFunction(name: string, args: Value[]): Value {
    switch (name) {
        case "if": {
            if (args.length < 3) throw new ExpressionError("if() requires 3 arguments");
            const cond = toNum(args[0]);
            return cond ? args[1] : args[2];
        }
        case "max": {
            if (args.length === 0) return 0;
            return args.reduce((a, b) => toNum(a) > toNum(b) ? a : b);
        }
        case "min": {
            if (args.length === 0) return 0;
            return args.reduce((a, b) => toNum(a) < toNum(b) ? a : b);
        }
        case "sqrt": return Math.sqrt(toNum(args[0]));
        case "abs": return Math.abs(toNum(args[0]));
        case "round": return Math.round(toNum(args[0]));
        case "floor": return Math.floor(toNum(args[0]));
        case "ceil": return Math.ceil(toNum(args[0]));
        case "sign": {
            const n = toNum(args[0]);
            return n < 0 ? -1 : n > 0 ? 1 : 0;
        }
        case "length": return toStr(args[0]).trim().length;
        case "trim": return toStr(args[0]).trim();
        case "substr": {
            const s = toStr(args[0]);
            const start = toNum(args[1]) - 1; // IPP3 uses 1-indexed
            const len = args.length >= 3 ? toNum(args[2]) : 0;
            if (len === 0) return s.slice(start);
            return s.slice(start, start + len);
        }
        default:
            throw new ExpressionError(`unknown function '${name}'`);
    }
}
