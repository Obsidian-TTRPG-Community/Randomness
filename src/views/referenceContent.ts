/**
 * In-app reference content.
 *
 * Stored as a single string constant so:
 *   - It bundles into main.js — no extra file to ship or load.
 *   - It's version-controlled alongside the code it documents.
 *   - It's testable (length / required-sections smoke tests).
 *
 * Rendered through Obsidian's own `MarkdownRenderer.render`, so it
 * looks native and benefits from any future Obsidian rendering
 * improvements. The reference deliberately uses fenced code blocks
 * with the language tag `text` (not `randomness`) for syntax
 * examples — that prevents the example fragments from being
 * rolled by the post-processor when the reference is open in a
 * pane.
 *
 * Style: explanatory prose with concrete examples. Aimed at a
 * tabletop GM who knows markdown and has used wiki-syntax before
 * but has never seen IPP3 / Random Pad before.
 */

export const REFERENCE_MARKDOWN = `# Randomness — Reference

A quick reference for building random tables. For the full design
rationale and history, see the project README on GitHub.

## File structure

Generators live in \`.ipt\` files (or fenced \`\`\`randomness\`\`\`
codeblocks inside notes). Each file starts with optional
directives, then one or more tables.

\`\`\`text
Title: My Generator
Formatting: html

Table: greeting
Hello
Hi there
Well met

Table: farewell
Goodbye
Farewell
See you soon
\`\`\`

Directives recognised:

- **Title:** display name used in the browser pane and tabs.
- **Formatting:** \`html\` (default) lets filters emit \`<b>\`,
  \`<i>\` etc. \`text\` makes them use plain-text equivalents.
- **MaxReps:** default repetition count when the caller doesn't
  specify (see "Repetitions" below).
- **Use:** import another \`.ipt\` file's tables into this one's
  scope. Path is resolved relative to this file's folder, then
  to the configured Generator Root, then as a vault-absolute
  path.

## Tables and items

A table is \`Table: name\` followed by one item per line until
the next \`Table:\` or end of file. The first table in a file is
the **main table** — the one rolled when the file itself is
called without a specific table name.

\`\`\`text
Table: weather
Clear skies, no clouds
Light rain
Heavy storm with thunder
Bitter wind from the north
\`\`\`

Items are sampled uniformly at random. Blank lines and lines
starting with \`//\` are comments and ignored.

## Calling tables

The basic syntax is \`[table_name]\`:

\`\`\`text
Table: encounter
The party meets [creature] in [location].

Table: creature
a goblin scout
a wandering merchant
a wild boar

Table: location
a sunlit clearing
the ruins of an old chapel
a creaking wooden bridge
\`\`\`

Rolling \`encounter\` once might give:
*"The party meets a wandering merchant in a sunlit clearing."*

### Variations

- \`[@table]\` — roll the table. Same as \`[table]\` but explicit.
- \`[#n table]\` — pick item number \`n\` from the table (lookup).
- \`[#<key> table]\` — dictionary-style lookup by item prefix.
- \`[!table]\` — deck pick (don't repeat items until exhausted).
- \`[|a|b|c]\` — inline table; pick one of \`a\`, \`b\`, \`c\`.

## Dice

\`{NdN}\` rolls dice. \`{2d6}\` rolls two six-siders and sums them.
Modifiers: \`{1d20+5}\`, \`{3d6-2}\`.

\`\`\`text
Table: damage
The sword deals {1d8+2} damage.

Table: stats
STR {3d6}, DEX {3d6}, CON {3d6}, INT {3d6}, WIS {3d6}, CHA {3d6}
\`\`\`

## Variables

\`{var}\` references a variable previously set with \`!set\`:

\`\`\`text
Table: introduction
!set name=[first_name]
!set class=[class]
{name} the {class} steps forward.
"I am {name}!" they declare.
\`\`\`

\`{$var}\` is the legacy form, equivalent to \`{var}\`.

## Filters

\`>>\` applies a filter to the result of a call:

\`\`\`text
[creature >> upper]            // shouts the creature name
[name >> proper]               // Title-cases the name
[items >> sort >> implode , ]  // sort, then join with ", "
\`\`\`

Common filters:

- **upper / lower** — case conversion
- **proper** — Title Case
- **bold / italic / underline** — wrap in \`<b>\`/\`<i>\`/\`<u>\`
- **sort** — sort alphabetically (multi-rep results)
- **implode <glue>** — join multi-rep results with the glue string
- **replace <from>/<to>** — substring replace
- **trim** — strip leading and trailing whitespace
- **left N / right N / mid N M** — substring extraction
- **eachchar <filter>** — apply a filter to each character
- **a** — prefix "a" or "an" based on what follows

## Repetitions

\`N[table]\` rolls the table \`N\` times. Results are joined by
blank lines (the default visual separator). Use \`implode\` to
override the separator:

\`\`\`text
[3@treasure]                       // three treasures, blank-separated
[5@spell >> implode ", "]          // five spells, comma-separated
[1d4@goblin]                       // 1-4 goblins
\`\`\`

The file's \`MaxReps:\` directive caps the repetition count,
useful when authors want to allow variable reps but prevent a
runaway \`[100@expensive_table]\`.

## Conditionals

\`[when expr][do …][else …][end]\` — run the \`do\` branch if
\`expr\` is truthy, otherwise the \`else\` branch. Variables and
dice work inside the condition.

\`\`\`text
!set roll={1d6}
[when {roll}>3][do A high roll!][else A low roll.][end]
\`\`\`

## Obsidian wiki-syntax — images and links

(Added in v0.4.0.)

Items can contain Obsidian wiki-syntax for images and links.
They render the way Obsidian renders them natively — embedded
image for \`![[image.png]]\`, clickable link for \`[[note]]\`.

\`\`\`text
Table: portrait
![[images/goblin-warrior.svg]]
![[images/dwarf-cleric.svg]]
![[images/elf-ranger.svg]]

Table: location_link
The party arrives at [[Locations/Coppertown]].
The road leads to [[Locations/Blackwood Forest]].
\`\`\`

Supported variants:

- \`![[image.png]]\` — embed image
- \`![[image.png|200]]\` — embed with pixel width
- \`![[image.png|alt text]]\` — embed with alt text
- \`[[Note]]\` — internal link
- \`[[Note#Heading]]\` — link to a heading
- \`[[Note|display text]]\` — link with custom display text

Variables work inside the brackets, so you can build dynamic
embeds:

\`\`\`text
!set monster=goblin
![[images/{monster}.png]]
\`\`\`

If the file doesn't exist in the vault, the link renders as a
muted dashed-underline span (matching Obsidian's own unresolved-
link affordance) — it doesn't crash.

## Calling from notes

Two ways to use a generator from a regular markdown note.

### Embedded codeblock

\`\`\`text
\\\`\\\`\\\`randomness
Use: my-generator.ipt
[@encounter]
\\\`\\\`\\\`
\`\`\`

The codeblock both rolls AND brings \`my-generator.ipt\` into
the note's scope so inline calls below can reference its tables.

### Inline calls

Once at least one codeblock has imported a file, inline calls
work anywhere in the note:

\`\`\`text
You meet \\\`rdm:[@creature]\\\` on the road.
\`\`\`

Inline calls get **reroll** (🎲) and **lock** (🔒) buttons. Lock
commits the result into the source text so it survives reloads;
reroll on a locked call strips the lock.

> Inline calls don't accept their own \`Use:\` directive — the
> syntax inside the brackets is the expression body only. Use a
> \`\`\`randomness\`\`\` codeblock in the same note to bring files
> into scope.

## Escaping

Use \`\\\\\` to escape special characters:

- \`\\\\[\` — literal \`[\` (not a table call)
- \`\\\\{\` — literal \`{\` (not an expression)
- \`\\\\n\` — newline
- \`\\\\t\` — tab
- \`\\\\_\` — space (useful for visible leading/trailing spaces)

## Browser pane

The right-sidebar browser shows every \`.ipt\` file under the
configured Generator Root (or the whole vault if no root is set).
Click **Roll** next to any table to see its output in the result
panel; click 📋 to copy the inline \`rdm:\` syntax for pasting
into a note; click 📍 to pin a table to the Favourites section
at the top of the tree.

## Table-name autocomplete

(Added in v0.4.2; expanded in v0.4.3 and v0.4.4.)

When you type \`rdm:[@\`, \`rdm:[#\`, or \`rdm:[!\` inside an
inline code span, a popup appears listing every table available
in your vault. Type more characters to filter — the match is
case-insensitive substring, so typing \`name\` matches both
\`FirstName\` and \`LastName\`. Pick one with arrow keys + Enter
(or click) and the table name is inserted, the closing \`]\`
added if needed, and the cursor lands past it.

The popup shows the source file for each table as a muted
subtitle so identically-named tables from different files are
distinguishable. The file's main table (the one called by
default if you roll the file directly) is flagged with a small
\`★\`.

### In-scope vs out-of-scope suggestions

Two groups appear in the popup:

- **In-scope tables** (top of the list, normal styling) — tables
  defined in this note's \`\`\`randomness\`\`\` codeblocks plus
  tables imported via their \`Use:\` directives. These insert
  cleanly and roll immediately.

- **Out-of-scope tables** (below, muted italic styling, marked
  "(not imported)") — every other table the plugin found in your
  vault. You can pick one, and the plugin will **automatically
  add a \`Use:\` line** so it works.

### Auto-import on out-of-scope pick

When you pick an out-of-scope table, the plugin makes the
minimal edit needed to bring it into scope:

- **If your note already has a \`\`\`randomness\`\`\` codeblock,**
  the \`Use:\` line is added to the first codeblock (after any
  existing \`Use:\` lines, before any expressions). No new
  codeblock is created.

- **If your note has no \`\`\`randomness\`\`\` codeblock,**
  a new one is created at the top of the note (after frontmatter
  if present), containing just \`Use: <path>\`. This codeblock
  renders as a small empty box — it's serving as a scope
  declaration for inline calls throughout the note.

The edit goes through the editor, so it's part of the same undo
group as your inline call: one \`Ctrl-Z\` undoes both the
inserted table name AND the auto-added \`Use:\` line if you
change your mind.

If the \`Use:\` line is already present (e.g. the cache was
stale and the table was actually in scope), the operation is a
no-op — no duplicate lines.

## Referencing generators by name

(Added in v0.6.0.)

You don't have to manage full paths. Randomness keeps an index of
every \`.ipt\` file in your vault (or under the Generator Root, if
set), so you can reference generators two ways:

- **By bare filename in a \`Use:\` line.** Write \`Use: Names.ipt\`
  (no folder path) and Randomness finds that file wherever it
  lives. Explicit paths still work and always take precedence — the
  bare-filename lookup is only a fallback when a path isn't given.
- **By table name when rolling.** \`rollUnscoped("TableName")\` (and
  the sidebar) find the defining file for you.

If two files share a name, Randomness prefers one in the same
folder as the file referencing it, otherwise picks the first
alphabetically and logs a one-time console note. To force a
specific file, use its full path.

The index refreshes automatically when you add, rename, move, or
edit \`.ipt\` files. If it ever seems out of date (e.g. after a sync
dropped files in while Obsidian was closed), run the **"Rebuild
generator index"** command.

## Scripting API

(Added in v0.5.0.)

Other plugins, Templater scripts, and DataviewJS can roll tables
programmatically through a public API at:

\`\`\`text
app.plugins.plugins["randomness"].api
\`\`\`

This is handy for generating notes from templates: roll values
in the template script and write the *results* into the note, so
the finished note contains plain text with no live \`rdm:\`
references that would re-roll every time it's opened.

**Templater example** — roll an NPC into a new note:

\`\`\`text
<%*
const api = app.plugins.plugins["randomness"].api;
const name = await api.rollUnscoped("ShopkeeperNPC");
const shop = await api.rollUnscoped("ShopName");
tR += \`# \${shop.result}\\n\\nProprietor: \${name.result}\`;
%>
\`\`\`

Because Templater writes the rolled strings into the file, the
saved note is static — nothing re-rolls on reopen. \`rollUnscoped\`
is used here (rather than \`roll\`) because a note being created
from a template has no scope yet — \`rollUnscoped\` finds the
generator anywhere in your vault without needing a \`Use:\` line.

**Methods:**

- \`roll(tableName, opts?)\` — roll a named table. Returns a
  result object with \`.result\` (the text), \`.table\`,
  \`.expression\`, \`.source\`, \`.timestamp\`, and \`.rollId\`.
  Resolves the table from the calling note's scope (set via
  \`opts.callerNotePath\`), so the note must define or \`Use:\`
  the table.
- \`rollUnscoped(tableName, opts?)\` — roll a named table found
  ANYWHERE in the vault, ignoring note scope. Searches every
  \`.ipt\` file (under the generator root if set), loads the
  defining file plus its \`Use:\` graph, and rolls. Best for
  scripting and template-generated notes, where you want to roll
  a generator without first wiring up a note's scope. Pass
  \`opts.filePath\` to disambiguate when two files share a table
  name.
- \`rollExpression(expr, opts?)\` — roll an arbitrary expression
  like \`"[@Names] of [@Origin]"\`.
- \`tables(callerNotePath?)\` — list table names visible from a
  note, deduped and sorted.
- \`tablesWithSources(callerNotePath?)\` — list tables with their
  source files; in-scope tables first, then the rest of the vault.
- \`onRoll(callback)\` — subscribe to every roll (success and
  failure). Returns an unsubscribe function.

**Options** (\`opts\`): \`callerNotePath\` sets the scope (which
\`Use:\` imports and same-note tables are visible; defaults to the
active note); \`seed\` makes the roll deterministic (same seed →
same result); \`promptValues\` supplies values for prompts by
label.

The API version is at \`api.version\` and follows semver
independently of the plugin version, so consumers can check it
and branch on the surface they need.

## Settings reference

- **Generator Root** — folder where shared generators live.
  \`Use:\` paths fall back to this when not found relative to
  the current note.
- **Default Formatting** — \`html\` or \`text\`. Files can override
  with their own \`Formatting:\` directive.
- **Stable Codeblock Seeds** — when on, codeblocks use a seed
  derived from their position so re-rendering the same note
  doesn't shuffle results. Useful for "this codeblock should
  stay consistent until I edit it".

## More

- Project: [github.com/obsidian-ttrpg-community/randomness](https://github.com/obsidian-ttrpg-community/randomness)
- The full IPP3 spec (the syntax this engine implements): NBOS
  Software's \`Inspiration Pad Pro 3\` help file.
- File a bug: open an issue on the GitHub repo with a minimal
  reproducing \`.ipt\` file if you can.
`;
