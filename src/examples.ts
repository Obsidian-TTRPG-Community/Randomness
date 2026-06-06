/**
 * Bundled example generators.
 *
 * These files demonstrate the plugin's features and are written
 * out to the user's vault when they choose to seed the Generator
 * Root with examples (from the settings tab). Each file is heavily
 * commented and progressively introduces more features so a user
 * can read them in order and learn the syntax.
 *
 * The files are stored as string constants here (not as files in
 * the repo's `examples/` folder loaded at runtime) because:
 *   - Plugins don't have a portable way to read their own bundled
 *     assets at runtime — only what's in `main.js` is reachable.
 *   - It keeps everything in one place, reviewable, version-
 *     controlled, and impossible to lose during install.
 *   - The file count is small and the content rarely changes.
 *
 * When adding new examples, keep them small, comment heavily, and
 * make them runnable on their own (no `Use:` chains across files
 * unless explicitly demonstrating that feature).
 */

export interface ExampleFile {
    /** Filename relative to the Generator Root (e.g. "01-greetings.ipt") */
    filename: string;
    /** File contents */
    content: string;
    /** Short description for UI / log output */
    description: string;
}

const GREETINGS = `\
// 01-greetings.ipt
// =================================================================
// The simplest possible generator: one table, a handful of items.
// Roll this file and you'll get one of the listed greetings.
//
// Try it:  add a randomness codeblock to any note with the line
//          [@Greeting]  and click to roll it.
// =================================================================

// "Table:" declares a named table. Every line after it (until the
// next Table: or end of file) is an item that can be picked.
// By default all items are equally weighted.
Table: Greeting
Hello there!
Well met, traveller.
What news?
Mind yourself.
A fine day to you.

// You can add a second table in the same file. The FIRST table
// in a file is the "main table" — the one rolled by default if
// you call the file with no specific table name.
Table: Farewell
Safe travels.
Until next we meet.
Don't be a stranger.
May the wind be at your back.
`;

const TAVERN = `\
// 02-tavern.ipt
// =================================================================
// Tables can call other tables. This is the most important pattern
// in the language — small tables compose into rich output.
//
// The [@TableName] syntax rolls another table and inserts the result.
// You can chain them, mix with literal text, and nest as deep as
// you like.
//
// Try it:  [@TavernName]  in a codeblock.
// =================================================================

Table: TavernName
The [@Adjective] [@Noun]

// Notice how the main table above contains literal text ("The ")
// plus two sub-table calls. The output will be e.g.
//   "The Crooked Goblin"
//   "The Silver Drake"

Table: Adjective
Crooked
Silver
Sleeping
Drunken
Roaring
Wandering
Golden
Black
Lonely
Merry

Table: Noun
Goblin
Drake
Lion
Stag
Knight
Boar
Mermaid
Anchor
Crown
Crow
`;

const MONSTER = `\
// 03-monster.ipt
// =================================================================
// Variables, prompts, dice, and inline tables.
//
// This file picks a monster, gives it a name, and describes its
// disposition. It demonstrates four new things:
//
//   1. Prompt: — adds an input control to the codeblock UI
//   2. {1d6}    — rolls dice and inserts the number
//   3. [|a|b|c] — inline table, picks one option randomly
//   4. Set:     — assigns a variable, then references it elsewhere
//
// Try it:  [@MonsterEncounter]  — note the dropdown that appears.
// =================================================================

// Prompt: declares an input that appears in the UI. The user picks
// one of the options; their choice is available as {$Prompt1}.
// Syntax: Prompt: <label> {<option>|<option>|…} <default>
Prompt: Difficulty {Easy|Medium|Hard} Medium

Table: MonsterEncounter
// Pick a name and store it in {$name}. We use Set: (not [@name=…])
// because Set: is quiet — it doesn't insert the rolled name here.
// We'll insert it ourselves below using {$name}.
Set: name=[@MonsterName]
You encounter a [|small|medium|large|massive] {$name}. & 
It looks [|hungry|wounded|curious|hostile|indifferent] and is carrying {1d6} gold pieces. & 
Difficulty: {$Prompt1}.

// The & at the end of a line joins it with the next line. Use this
// to break long item text into readable chunks.

Table: MonsterName
goblin
orc
kobold
bugbear
ogre
troll
hobgoblin
gnoll
`;

const SHOP = `\
// 04-shop.ipt
// =================================================================
// Lookup tables, conditionals, and repetitions.
//
// Lookup tables roll dice and pick the item whose range covers the
// result. This is the d% (percentile) table idiom — much more
// natural than weighted lists for rarity-based picks.
//
// This file generates a shop's stock with rarity bias and a name
// that depends on the shop type.
//
// Try it:  [@Shop]
// =================================================================

Table: Shop
// The & at the end of each line joins it with the next, so the
// whole shop description is ONE item — not four separate items.
// Without &, the main table would pick just one of these lines.
[@ShopName]&
\\nStock:&
\\n  [@ShopItem]&
\\n  [@ShopItem]&
\\n  [@ShopItem]&
\\n  [@ShopItem]

// \\n is a newline escape — without it, items would run together.

Table: ShopName
The [@ShopAdjective] [@ShopNoun]

Table: ShopAdjective
Dusty
Bronze
Crooked
Silver
Forgotten

Table: ShopNoun
Lantern
Anvil
Pouch
Quill
Crown

Table: ShopItem
// Lookup tables roll dice (Roll: directive, or inferred from the
// max range) and pick the item whose lookupRange contains the roll.
Type: Lookup
Roll: 1d100
01-50: a [@CommonItem]
51-85: a [@UncommonItem]
86-98: a [@RareItem]
99-100: a [@LegendaryItem]

Table: CommonItem
candle
rope (50ft)
torch
flint and steel
waterskin
sack
chalk
ration

Table: UncommonItem
lantern
spyglass
grappling hook
silvered dagger
crowbar
healing potion
caltrops

Table: RareItem
+1 weapon
ring of protection
elven cloak
boots of striding
wand with 1d6+1 charges

Table: LegendaryItem
artifact-grade weapon (DM choice)
ring of three wishes (1 wish remaining)
deck of many things
`;

const TREASURE = `\
// 05-treasure-dictionary.ipt
// =================================================================
// Dictionary tables and the [#key Table] pick syntax.
//
// Dictionary tables map non-numeric KEYS to values. They aren't
// rolled randomly — you pick a specific entry by name. This is
// great for "give me the X version of Y" patterns: stats by class,
// loot by tier, dialogue by faction.
//
// This file generates treasure scaled to a "tier" you pick at runtime
// or one that's rolled from a separate lookup.
//
// Try it:  [@TreasureHoard]
// =================================================================

Prompt: Tier {Roll|Low|Mid|High|Legendary} Roll

Table: TreasureHoard
// If the user picked "Roll", roll for a tier; otherwise use what
// they picked. This is the canonical bracket-wrapped conditional
// pattern.
Set: tier=[[when]{$Prompt1}=Roll[do][@TierRoll][else]{$Prompt1}[end]]
// The & joins each line into ONE multi-line item. Without &, the
// main table would pick one of these lines randomly.
Tier: {$tier}&
\\nCoins: [#{$tier} Coins]&
\\nGems: [#{$tier} Gems]&
\\nMagic items: [#{$tier} Magic]

Table: TierRoll
Type: Lookup
01-50: Low
51-85: Mid
86-98: High
99-100: Legendary

// Dictionary tables. The "Type: Dictionary" directive marks this
// as keyed; each item's "key:value" form maps directly.
Table: Coins
Type: Dictionary
Low: {3d6} silver
Mid: {2d6}x10 silver
High: {2d6}x100 silver
Legendary: {1d6}x1000 gold

Table: Gems
Type: Dictionary
Low: {1d4-1} (avg. 10gp each)
Mid: {1d6} (avg. 50gp each)
High: {1d4+1} (avg. 500gp each)
Legendary: {2d6} (avg. 5000gp each)

Table: Magic
Type: Dictionary
Low: usually none
Mid: 1 minor (potion or scroll)
High: 1 major + 1 minor
Legendary: 2 major + 1 artifact (subject to GM approval)
`;

export const EXAMPLE_FILES: ExampleFile[] = [
    {
        filename: "01-greetings.ipt",
        content: GREETINGS,
        description: "The absolute basics: one table, multiple items.",
    },
    {
        filename: "02-tavern.ipt",
        content: TAVERN,
        description: "Tables calling other tables — compose small parts into rich output.",
    },
    {
        filename: "03-monster.ipt",
        content: MONSTER,
        description: "Variables, prompts, dice rolls, and inline tables.",
    },
    {
        filename: "04-shop.ipt",
        content: SHOP,
        description: "Lookup tables (d% rarity), repetitions, and shop composition.",
    },
    {
        filename: "05-treasure-dictionary.ipt",
        content: TREASURE,
        description: "Dictionary tables, [#key Table] lookups, and bracket-wrapped conditionals.",
    },
];

/**
 * README that gets written into the examples folder alongside the
 * .ipt files. Explains what the files demonstrate so a user
 * browsing the folder can decide where to start.
 */
export const EXAMPLES_README = `# Randomness — example generators

This folder was seeded by the Randomness plugin. Each \`.ipt\` file
demonstrates a feature or pattern; the numbered prefix is a
suggested reading order.

| File | What it covers |
| --- | --- |
| 01-greetings.ipt | The basics: one table, multiple items |
| 02-tavern.ipt | Tables calling other tables |
| 03-monster.ipt | Variables, prompts, dice, inline tables |
| 04-shop.ipt | Lookup tables (d%), repetitions |
| 05-treasure-dictionary.ipt | Dictionary tables, conditionals |

## How to run them

In any note, add a fenced \`randomness\` codeblock and roll a
table by name:

\`\`\`text
\`\`\`randomness
[@TavernName]
\`\`\`
\`\`\`

Click the codeblock to roll. The plugin will find the file
containing the table automatically — you don't need to specify
which file the table lives in.

You can also reference a specific file with \`Use:\`:

\`\`\`text
\`\`\`randomness
Use: 02-tavern.ipt
[@TavernName]
\`\`\`
\`\`\`

## Editing the files

These are plain text files. Open them in any editor (Obsidian
itself works) and modify them. Changes take effect immediately;
no reload needed. If you break a file, the codeblock that uses
it will show an error message — fix the file and the error
clears on the next render.

## Removing the examples

Delete the files (or this whole folder) when you don't need them
any more. The plugin won't recreate them; they're a one-shot
seeding for new users.
`;
