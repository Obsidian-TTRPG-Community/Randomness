/**
 * Filter implementations.
 *
 * Filters operate on the result of a table call (or literal text). Some
 * filters take arguments (substr, replace, implode with separator, each,
 * eachchar). Some operate per-item on multi-result inputs (sort, implode),
 * others operate on the whole text.
 *
 * Multi-result inputs: when a table is called with reps > 1 (or via deck pick
 * with multiple), the engine has a choice — concat results with "" or pass a
 * list. Per the spec, filters like sort, implode, each operate on lists, and
 * default behaviour for multiple results is concatenation. So filters get a
 * special "multi-result" value type.
 *
 * MultiResult is just a string[] for filters that care; otherwise filters
 * operate on a coalesced string.
 */

import { FilterCall, Node } from "./ast";
import { parseContent } from "./contentParser";
import { ExprContext, evaluateExpression } from "./expressions";

export type FilterValue = string | string[];

export interface FilterContext extends ExprContext {
    /** Run an inner table call (used by Each / EachChar filters). */
    evalTable(tableName: string, params: string[]): string;
    /** Formatting mode for bold/italic/underline. */
    formatting: "html" | "text";
}

/**
 * Evaluate a filter argument string by rendering any embedded {var} or
 * [expr] inside it. Used by filters whose arguments may contain
 * interpolated content (substr length, implode separator, etc.).
 *
 * We need this because filter args are stored as raw source by the parser —
 * filter implementations have to resolve them.
 */
function renderArgs(args: string, ctx: FilterContext): string {
    const nodes: Node[] = parseContent(args);
    let out = "";
    for (const n of nodes) {
        switch (n.type) {
            case "text": out += n.value; break;
            case "escape":
                if (n.kind === "n") out += "\n";
                else if (n.kind === "t") out += "\t";
                else if (n.kind === "_") out += " ";
                else if (n.kind === "z") out += "";
                else if (n.kind === "literal") out += n.literal ?? "";
                else out += "";
                break;
            case "variable": out += String(ctx.getVar(n.name)); break;
            case "dice": {
                // simple dice render
                const m = n.source.match(/^(\d+)\s*[dD]\s*(\d+)$/);
                if (m) {
                    let total = 0;
                    for (let i = 0; i < parseInt(m[1], 10); i++) {
                        total += ctx.rng.intInclusive(1, parseInt(m[2], 10));
                    }
                    out += String(total);
                } else {
                    out += n.source;
                }
                break;
            }
            case "expression": {
                // We don't have access to the full evaluator here, only ctx —
                // try a minimal expression eval using ctx
                // (Caller's full evaluator already handles the common case;
                // this path is only hit when filters embed expressions.)
                const r = evaluateExpression(n.source, ctx);
                if (!(r.assignedVarName !== undefined && r.quiet)) {
                    out += String(r.value);
                }
                break;
            }
            case "subtable_roll":
            case "subtable_pick":
            case "deck_pick":
            case "inline_table":
            case "literal_bracket":
                // Re-serialise to source and let evalEmbeddedCall handle it
                out += ctx.evalEmbeddedCall(args.slice(0));
                break;
            default: break;
        }
    }
    return out;
}

/**
 * Apply a chain of filters to a value, returning the final string.
 */
export function applyFilters(
    value: FilterValue,
    filters: FilterCall[],
    ctx: FilterContext
): string {
    let current: FilterValue = value;
    for (const f of filters) {
        current = applyFilter(current, f, ctx);
    }
    // Coalesce array to string at the end (default separator: empty)
    if (Array.isArray(current)) return current.join("");
    return current;
}

function applyFilter(value: FilterValue, f: FilterCall, ctx: FilterContext): FilterValue {
    switch (f.name) {
        case "upper": return mapText(value, s => s.toUpperCase());
        case "lower": return mapText(value, s => s.toLowerCase());
        case "proper": return mapText(value, properCase);
        case "trim": return mapText(value, s => s.trim());
        case "ltrim": return mapText(value, s => s.replace(/^\s+/, ""));
        case "rtrim": return mapText(value, s => s.replace(/\s+$/, ""));
        case "reverse": return mapText(value, s => s.split("").reverse().join(""));
        case "length": return String(asString(value).trim().length);
        case "left": {
            const argText = renderArgs(f.args, ctx);
            const n = argText ? parseInt(argText, 10) : 1;
            return mapText(value, s => s.slice(0, n));
        }
        case "right": {
            const argText = renderArgs(f.args, ctx);
            const n = argText ? parseInt(argText, 10) : 1;
            return mapText(value, s => s.slice(-n));
        }
        case "substr": {
            // Args: "start [length]" — 1-indexed.
            // IPP3 behaviour: with only a start, returns 1 character (per
            // corpus usage). With explicit length 0, returns rest from start.
            const argText = renderArgs(f.args, ctx);
            const parts = argText.trim().split(/\s+/).filter(Boolean);
            const start = parts.length >= 1 ? parseInt(parts[0], 10) - 1 : 0;
            if (parts.length >= 2) {
                const length = parseInt(parts[1], 10);
                if (length === 0) {
                    return mapText(value, s => s.slice(start));
                }
                return mapText(value, s => s.slice(start, start + length));
            }
            // No length given — return single character
            return mapText(value, s => s.slice(start, start + 1));
        }
        case "at": {
            // Output position (1-indexed) of substring in text; 0 if not found
            const needle = renderArgs(f.args, ctx).trim();
            const hay = asString(value).trim();
            const idx = hay.indexOf(needle);
            return idx === -1 ? "0" : String(idx + 1);
        }
        case "replace": {
            // Args: "/find/replace/" — first / is delimiter (forward-slash, possibly escaped)
            // IPP3 docs say `replace /a/b/`. Find and replace are arbitrary text;
            // forward slashes inside them must be escaped with \.
            const replaceArgs = parseReplaceArgs(f.args);
            return mapText(value, s =>
                s.split(replaceArgs.find).join(replaceArgs.repl)
            );
        }
        case "sort": {
            if (!Array.isArray(value)) return value;
            return [...value].sort((a, b) => a.localeCompare(b));
        }
        case "implode": {
            const sep = f.args === "" ? ", " : renderArgs(f.args, ctx);
            const arr = Array.isArray(value) ? value : [value];
            return arr.join(sep);
        }
        case "bold":
            return mapText(value, s =>
                ctx.formatting === "html" ? `<b>${s}</b>` : s.toUpperCase()
            );
        case "italic":
            return mapText(value, s =>
                ctx.formatting === "html" ? `<i>${s}</i>` : `*${s}*`
            );
        case "underline":
            return mapText(value, s =>
                ctx.formatting === "html" ? `<u>${s}</u>` : `"${s}"`
            );
        case "+-":
        case "plusminus": {
            return mapText(value, s => {
                const n = parseFloat(s);
                if (Number.isNaN(n)) return s;
                return n >= 0 ? `+${n}` : `${n}`;
            });
        }
        case "each": {
            // Pass each result through another table as parameter $1
            const tableName = f.args.trim();
            const arr = Array.isArray(value) ? value : [asString(value)];
            return arr.map(item => ctx.evalTable(tableName, [item]));
        }
        case "eachchar": {
            const tableName = f.args.trim();
            const s = asString(value);
            const out: string[] = [];
            for (const ch of s) {
                out.push(ctx.evalTable(tableName, [ch]));
            }
            return out.join("");
        }
        default:
            // Unknown filter — pass through unchanged with a console warning
            // (production-friendly; debugging-friendly through warnings)
            return value;
    }
}

function mapText(v: FilterValue, fn: (s: string) => string): FilterValue {
    if (Array.isArray(v)) return v.map(fn);
    return fn(v);
}

function asString(v: FilterValue): string {
    return Array.isArray(v) ? v.join("") : v;
}

function properCase(s: string): string {
    return s.replace(/\b\w/g, c => c.toUpperCase());
}

function parseReplaceArgs(args: string): { find: string; repl: string } {
    // Format: /find/replace/  — delimiter is /, can be escaped with \/
    if (!args.startsWith("/")) return { find: "", repl: "" };
    let i = 1;
    let find = "";
    let repl = "";
    while (i < args.length && args[i] !== "/") {
        if (args[i] === "\\" && args[i + 1] === "/") {
            find += "/";
            i += 2;
        } else {
            find += args[i];
            i++;
        }
    }
    if (i >= args.length) return { find, repl: "" };
    i++; // skip /
    while (i < args.length && args[i] !== "/") {
        if (args[i] === "\\" && args[i + 1] === "/") {
            repl += "/";
            i += 2;
        } else {
            repl += args[i];
            i++;
        }
    }
    return { find, repl };
}
