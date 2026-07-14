/**
 * AST for an IPP3 generator file.
 *
 * A GeneratorFile is the top-level container. It holds:
 *   - top-level commands (Use, Set, Define, Prompt, Header, Footer, MaxReps, Formatting, Title)
 *   - tables (the actual generators)
 *
 * Each Table has metadata (type, roll, default, shuffle list) and a list of items.
 * Each Item has a weight or lookup-range and content.
 * Content is a sequence of Nodes — literal text, escapes, tags, expressions.
 */

export type GeneratorFile = {
    uses: string[];                       // Use: paths in declaration order
    topLevelSets: Assignment[];           // Set:/Define: declared outside any Table
    prompts: PromptDecl[];                // Prompt: declarations in order
    header?: string;                      // Header: raw text
    footer?: string;                      // Footer: raw text
    title?: string;                       // Title: raw text
    maxReps?: number;                     // MaxReps: clamp
    formatting?: "html" | "text";         // Formatting:
    tables: TableDecl[];                  // Tables in declaration order; first is the "main" table
};

export type Assignment = {
    kind: "set" | "define";               // Set = eager eval, Define = lazy
    name: string;
    valueSource: string;                  // Raw RHS source — re-parsed at evaluation time
};

export type PromptDecl = {
    label: string;
    options: string[];                    // Empty list = free-text prompt
    defaultValue: string;
};

export type TableDecl = {
    name: string;
    type: "weighted" | "lookup" | "dictionary";
    rollExpr?: string;                    // Lookup tables: raw roll source, e.g. "1d10"
    defaultValue?: string;                // Default: line; raw source
    shuffleTargets: string[];             // Names of tables to shuffle before rolling
    inTableSets: Assignment[];            // Set:/Define: that live inside this table
    items: TableItem[];
    /** `Deck: persistent` — deck-pick state survives across runs
     * (host-backed; see EvaluatorOptions.deckHost). */
    deckPersistent?: boolean;
    /** `Flip: N%` — deck picks set {$facing} to reversed N% of the
     * time, upright otherwise. Undefined = no orientation. */
    flipChance?: number;
};

export type TableItem = {
    // For weighted tables: weight (default 1)
    weight?: number;
    // For lookup tables: numeric range [low, high] inclusive, or a single value [n, n]
    lookupRange?: [number, number];
    // For dictionary tables: the string key
    dictKey?: string;
    // Raw item source (post line-continuation join, pre-node parsing).
    // The evaluator parses this into Nodes lazily — keeping it as a string here
    // means parser stays simple and we can reparse if needed.
    rawContent: string;
};

// ───────────────────── Content nodes ─────────────────────
// Once a TableItem's rawContent is parsed into nodes, it becomes a Node[].
// Nodes are what the evaluator walks to produce output.

export type Node =
    | TextNode
    | EscapeNode
    | ExpressionNode
    | DiceNode                 // Convenience: {3d6} is technically an expression, but we tag separately for speed/clarity
    | VariableNode             // {name} or {$name}
    | SubtableRollNode         // [@…]
    | SubtablePickNode         // [#…]
    | DeckPickNode             // [!…]
    | InlineTableNode          // [|a|b|c]
    | LiteralBracketNode       // [literal text >> filter]
    | ConditionalNode;         // [when]…[do]…[else]…[end] and [when not]…

export type TextNode = { type: "text"; value: string };

export type EscapeNode = {
    type: "escape";
    // The escape character after the backslash
    // n=newline, t=tab, _=space, z=empty, a=a/an, \ = literal backslash
    // Other escapes pass through as literal next-char.
    kind: "n" | "t" | "_" | "z" | "a" | "literal";
    // For "literal": the actual character that was escaped
    literal?: string;
};

export type ExpressionNode = {
    type: "expression";
    // Raw expression source (between the {} delimiters, without the leading ! for legacy {!math})
    source: string;
    // Quiet assignment (==) suppresses output. Detected at parse time but evaluator decides.
    // Quiet flag here is for {var==…} legacy form; the new {var=…} vs {var==…} is detected via source.
};

export type DiceNode = {
    type: "dice";
    source: string;            // raw, e.g. "3d6+2"
};

export type VariableNode = {
    type: "variable";
    name: string;              // {name} → "name"; {$name} → "name"
};

// Common fields for all sub-table-style calls
type CallCommon = {
    // Repetitions: number, dice expression, or variable. Null = single roll.
    repsSource?: string;
    // For inline assignment in call: [@var=table] or [@var==table]
    assignVar?: string;
    assignQuiet?: boolean;     // true = ==, false = =
    // Table name as raw source (may contain {var} interpolations like [@{$tableName}])
    tableSource: string;
    // Parameters from "with" clause — raw, comma-split lazily by evaluator
    withParams: string[];
    // Filter chain — each filter has a name and optional argument source
    filters: FilterCall[];
};

export type SubtableRollNode = CallCommon & { type: "subtable_roll" };
export type SubtablePickNode = CallCommon & {
    type: "subtable_pick";
    // [#n table] — index source; if missing, evaluator uses "current row index"
    indexSource?: string;
    // [#"key with spaces" table] — literal dictionary key, used
    // instead of indexSource when the key was quoted. Whitespace,
    // hyphens, punctuation are preserved verbatim. The evaluator
    // takes this as a literal key for dictionary lookup (no
    // expression evaluation, no whitespace splitting).
    literalKey?: string;
};
export type DeckPickNode = CallCommon & { type: "deck_pick" };

export type InlineTableNode = {
    type: "inline_table";
    options: string[];         // Each option's raw source — re-parsed on selection
    filters: FilterCall[];     // Inline tables can also be filtered
};

export type LiteralBracketNode = {
    type: "literal_bracket";
    // [some literal text >> filter]
    // No table call inside, just text being piped through filters
    text: string;
    filters: FilterCall[];
};

export type ConditionalNode = {
    type: "conditional";
    negated: boolean;          // [when not] vs [when]
    // Condition source — raw text between [when]/[when not] and [do]
    conditionSource: string;
    // Body source between [do] and [else]/[end]
    thenSource: string;
    // Optional else body source between [else] and [end]
    elseSource?: string;
};

export type FilterCall = {
    name: string;              // e.g. "upper", "implode", "replace".
    // Some filters take args inline after their name (Substr 5 3, replace /a/b/, implode <sep>, etc.)
    // Stored as raw source — filter implementations parse their own args.
    args: string;
};
