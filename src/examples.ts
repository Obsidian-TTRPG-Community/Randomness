/**
 * Bundled examples.
 *
 * These files demonstrate the plugin's features and are written into
 * their own sub-folder ("Randomness Examples") under the user's
 * Generator Root when they click "Add examples" in the settings tab.
 *
 * The set teaches the FOUR ways Randomness content lives in a vault,
 * so a brand-new user sees every shape in one place:
 *
 *   1. Inline in a note      — `rdm:[@Table]` sprinkled through prose.
 *      → "Way 1 - Inline in a note.md"
 *   2. A codeblock in a note  — a fenced ```randomness block.
 *      → "Way 2 - A codeblock in a note.md"
 *   3. Standalone .rdm files  — reusable generator files.
 *      → "01-greetings.rdm" … "05-treasure-dictionary.rdm"
 *   4. A .rdm file referenced — a note that pulls in a .rdm file with
 *      from a note               `Use:` (or by auto-discovery).
 *      → "Way 3 - Using your .rdm files in a note.md"
 *
 * Everything shares one fantasy theme (greetings, taverns, monsters,
 * shops, treasure) so the pieces tie together, and every file is
 * heavily commented in plain language — the goal is that a curious
 * ten-year-old can read any file top-to-bottom and understand it.
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
 * make `.rdm` generators runnable on their own (no `Use:` chains
 * across files unless explicitly demonstrating that feature).
 */

/**
 * The examples install into their OWN sub-folder under the user's
 * Generator Root (e.g. "Generators/Randomness Examples"). Keeping them
 * grouped means a curious user can read the whole tutorial set in one
 * place, and delete the single folder when they're done — without
 * touching their own generators that live alongside it in the root.
 */
export const EXAMPLES_SUBFOLDER = "Randomness Examples";

export interface ExampleFile {
    /**
     * Filename relative to the examples sub-folder. May be a `.rdm`
     * generator ("01-greetings.rdm") or a `.md` walkthrough note
     * ("Way 1 - Inline in a note.md").
     */
    filename: string;
    /** File contents */
    content: string;
    /** Short description for UI / log output */
    description: string;
}

const GREETINGS = `\
// 01-greetings.rdm
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
// 02-tavern.rdm
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
// 03-monster.rdm
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
// 04-shop.rdm
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
// 05-treasure-dictionary.rdm
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

// ─────────────────────────────────────────────────────────────────────
// Markdown walkthrough notes. These show the THREE ways to use the
// language from inside a note (inline, codeblock, and pulling in a
// .rdm file). They share the .rdm files' fantasy theme so the whole
// set reads as one tutorial. Written for an absolute beginner.
// ─────────────────────────────────────────────────────────────────────

const WAY1_INLINE = `\
# Way 1 — Inline in a note

> [!tip] Switch to Reading view first!
> Inline rolls only come alive in **Reading view**. Press
> **Ctrl/Cmd-E** (or click the open-book icon in the top-right of this
> tab) to switch. In editing view you'll just see the plain text —
> that's normal.

The trick: write a tiny code-span that starts with **rdm:** — like
\`rdm:[@Greeting]\` — right inside a sentence, and Randomness swaps in
a random result.

The little tables that power this note live in the grey box at the
very bottom. Don't delete it — these sentences need it!

## Try these

The hero walked into the town of \`rdm:[@Town]\` at sunset.

A stranger named \`rdm:[@Person]\` waved and called out.

> Hover over a result. The 🎲 button rolls it again. The 🔒 button
> **locks** the result so it stays the same forever (it quietly writes
> the answer into your note).

## Same roll, different answers

These three are the exact same code, but each gets its own answer:

- \`rdm:[@Person]\`
- \`rdm:[@Person]\`
- \`rdm:[@Person]\`

## Make a result fancy (filters)

Add \`>> upper\` to make it UPPERCASE, or \`>> proper\` for Proper Case:

- normal: \`rdm:[@Town]\`
- shouting: \`rdm:[@Town >> upper]\`
- tidy: \`rdm:[@Town >> proper]\`

---

This is the powering codeblock — the engine room of this note. The
sentences above borrow these tables:

\`\`\`randomness
Table: Town
Stonewatch
Riverbend
Greenhollow
Ashpoint
Thornhaven

Table: Person
Old Brannic
Mira Thornhaven
Pip Ferrowclaw
Selene Coalheart

Table: Greeting
Well met, traveller!
What news from the road?
Mind yourself out there.
A fine day to you.
\`\`\`
`;

const WAY2_CODEBLOCK = `\
# Way 2 — A codeblock in a note

A **codeblock** is a grey box in a note that you click to roll. Unlike
inline rolls (Way 1), a codeblock works in **both** editing and
Reading view.

To make one, type three backticks, then the word \`randomness\`, then
your roll, then three backticks to close it — like the box below. 👇

The handy part: you can put the tables **right inside the same box**,
so this one note is complete all by itself and needs no other file.

## Roll a quest

Click this box to send your heroes on an adventure:

\`\`\`randomness
// The first table in the box is the one that rolls. Here it's "Quest".
Table: Quest
Someone in [@Town] needs help: [@Problem]

Table: Town
Stonewatch
Riverbend
Greenhollow
Thornhaven

Table: Problem
a goblin stole the baker's pies!
the well has gone dry and nobody knows why.
a dragon was spotted on the north road.
the mayor's cat is missing (again).
strange lights glow in the old ruins at night.
\`\`\`

## Your turn

Edit the box above. Add a new line to the **Problem** table — maybe
"a ghost keeps rearranging the library." Save the note, then click the
box again. Your new problem can now show up. No reload needed!
`;

const WAY3_REFERENCE = `\
# Way 3 — Using your .rdm files in a note

The \`.rdm\` files in this folder (like **02-tavern.rdm**) are little
recipe books full of tables. The best part: you can use those tables
from **any note**, so you never have to copy them.

There are two ways to do it.

## A) Name the file with \`Use:\` (this always works)

Add a \`Use:\` line that names the file, then roll any table inside it.
This works no matter where this note lives, because Randomness looks
for the file sitting right next to this note. Click the box to roll
**TavernName** from **02-tavern.rdm**:

\`\`\`randomness
Use: 02-tavern.rdm
[@TavernName]
\`\`\`

## B) The shortcut — let Randomness find it for you

If your generators live inside your **Generator Root** folder, you can
skip the \`Use:\` line and just name the table. Randomness searches your
generator files and finds it:

\`\`\`randomness
[@TavernName]
\`\`\`

> [!note] Seeing "Unknown table: TavernName"?
> That just means this folder isn't inside your Generator Root yet, so
> the shortcut can't see the file. Two easy fixes: move this folder
> into your Generator Root (Settings → Randomness → Generator root), or
> simply use the \`Use:\` line from method A — that one always works.

## It works inline too

Just like Way 1, an inline roll can borrow from your \`.rdm\` files
(switch to **Reading view** to see it):

You arrive at \`rdm:[@TavernName]\` and decide to stay the night.

## Why this is great

Write a table once in a \`.rdm\` file, then use it in a hundred notes.
Fix a typo in the file and **every** note updates at once. That's the
whole reason to keep generators in their own files.
`;

export const EXAMPLE_FILES: ExampleFile[] = [
    {
        filename: "01-greetings.rdm",
        content: GREETINGS,
        description: "The absolute basics: one table, multiple items.",
    },
    {
        filename: "02-tavern.rdm",
        content: TAVERN,
        description: "Tables calling other tables — compose small parts into rich output.",
    },
    {
        filename: "03-monster.rdm",
        content: MONSTER,
        description: "Variables, prompts, dice rolls, and inline tables.",
    },
    {
        filename: "04-shop.rdm",
        content: SHOP,
        description: "Lookup tables (d% rarity), repetitions, and shop composition.",
    },
    {
        filename: "05-treasure-dictionary.rdm",
        content: TREASURE,
        description: "Dictionary tables, [#key Table] lookups, and bracket-wrapped conditionals.",
    },
    {
        filename: "Way 1 - Inline in a note.md",
        content: WAY1_INLINE,
        description: "Way 1: rolling random results inline, in the middle of a sentence.",
    },
    {
        filename: "Way 2 - A codeblock in a note.md",
        content: WAY2_CODEBLOCK,
        description: "Way 2: a self-contained randomness codeblock with its tables inside it.",
    },
    {
        filename: "Way 3 - Using your .rdm files in a note.md",
        content: WAY3_REFERENCE,
        description: "Way 3: pulling tables from a .rdm file into a note (auto-discovery and Use:).",
    },
];

/**
 * The "Start Here" note written into the examples folder alongside
 * everything else. It's the friendly front door: it explains the four
 * ways to use Randomness and points at the file that demonstrates
 * each, in a suggested reading order. Written for an absolute
 * beginner. (Settings writes this out as "Start Here.md".)
 */
export const EXAMPLES_README = `# 👋 Start here — Randomness examples

Welcome! This folder was made for you by the **Randomness** plugin.
Every file in here is a small, friendly lesson. Read them in order and
you'll learn to build your own random generators — like rolling dice,
but for words.

## The four ways to use Randomness

Your random stuff can live in four kinds of places. This folder has an
example of each:

1. **Inline in a note** — drop a roll right into a sentence.
   👉 open **"Way 1 - Inline in a note"**
2. **In a codeblock** — a grey box in a note that you click to roll.
   👉 open **"Way 2 - A codeblock in a note"**
3. **In a \`.rdm\` file** — a reusable "recipe book" full of tables.
   👉 open any file ending in **.rdm** (start with **01-greetings.rdm**)
4. **Using a \`.rdm\` file from a note** — borrow a recipe book inside a
   note. 👉 open **"Way 3 - Using your .rdm files in a note"**

## The \`.rdm\` files (your recipe books)

These are plain text files full of **tables**. A table is just a list
of things to pick from. Read them in this order — each one teaches
something new:

| File | What it teaches |
| --- | --- |
| 01-greetings.rdm | The basics: one table, a list of items |
| 02-tavern.rdm | Tables that call other tables |
| 03-monster.rdm | Dice, questions (prompts), and quick lists |
| 04-shop.rdm | "Roll a d100" rarity tables |
| 05-treasure-dictionary.rdm | Look-up-by-name (dictionary) tables |

## How do I roll something?

Make a grey codeblock in any note like this:

\`\`\`\`text
\`\`\`randomness
[@Greeting]
\`\`\`
\`\`\`\`

Then click it. Randomness finds the table called **Greeting** inside
**01-greetings.rdm** for you — you don't even have to say which file
it's in. ✨

## Changing things

Every file here is plain text. Open one, change it, and save — your
changes work straight away, no reload needed. If you ever break a
file, the box that uses it shows a little error message; fix the file
and the error goes away on the next roll.

## All done?

When you've learned what you need, just delete this whole
**Randomness Examples** folder. Any generators of your own live
*outside* this folder, so they won't be touched.
`;
