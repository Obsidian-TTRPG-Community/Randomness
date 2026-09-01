# Changelog

All notable changes to the Randomness plugin.

## 1.24.0

### Added
- **Hover previews in the sidebar** (asked on Discord): links in
  the sidebar's result panel and deck cards, and in the .ipt
  reader, now open Obsidian's Page preview popover on hover, the
  same as links in a note. Page preview only watches its own
  Markdown views, so the plugin's views now raise the `hover-link`
  event themselves and register as a source — a **Randomness**
  toggle appears under Settings → Core plugins → Page preview,
  where you can choose whether hovering needs Ctrl/Cmd (the
  default, matching notes) or fires on its own. Links rendered
  inside notes are untouched; the Markdown view already previews
  those.

## 1.23.0

### Added
- **Dungeon grids** — roll a whole map from a deck of dungeon
  cards: `deck:Dungeon|2x2` (or `3x2|150` for 3×2 at 150 px tiles)
  in a ```randomness codeblock deals W×H tiles laid out as a grid,
  each turned its own way per the deck's Turn settings (`quarter`
  decks land any of four directions with equal odds, `half` decks
  upright/upside-down, Turn chance 0 keeps tiles upright — the
  chance is an on/off switch for grids). **🎲 Roll** returns the
  current tiles to the deck at random positions before dealing, so
  rerolling never eats the deck; hovering a tile offers a per-tile
  reroll (🎲) and a manual turn (↻); **📋 Copy grid** copies the
  map as rows of image embeds.
- **Guide chapter 10 — Portraits** (issue #12, from a contribution
  by immortel32): the portrait feature's own guide chapter — setup,
  blocks, inline spans, seeds, packs, a full parameter reference,
  the recipe JSON shape, and troubleshooting with the real error
  messages. Fact-checked against the code before adoption: the
  contributed draft's per-card 🎲/📌 controls don't exist (blocks
  have one grid-level ⟳ Reroll plus per-tile lock and PNG icons;
  layer-by-layer tweaks are the Builder tab), and PNG *replaces*
  the block with an `![[image]]` embed — the chapter now says so.
  Chapter 09 and Start Here link to it.

## 1.22.1

### Fixed
- **Graphical dice now roll for aliases** (issue #9, from TGSlasher).
  `dice:ability|render` and an alias typed into the Dice Tray's
  formula box skipped the 3D dice and fell back to a plain roll,
  because the animation eligibility check looked at the raw text
  ("ability") instead of the formula the alias stands for — only the
  Saved buttons, which pass the formula directly, animated. Both
  paths now resolve aliases first (a `|render` or `|norender` saved
  inside the alias's own value is honoured too), and the roll
  breakdown shows the real formula. Also fixes multi-flag spans like
  `dice:2d6|form|render`, where only the last flag was stripped
  before the eligibility check.

### Added
- **Community generator: D&D spellbooks & scrolls (SRD 5.2)** by
  Brinx-git (issue #7) — weighted wizard/cleric/bard/druid spell
  tables in `community-generators/dnd-srd52-spells/`, with a CI
  test guarding the file against parse-breaking edits. Alphabetized
  books were already covered by the built-in `>> sort` filter:
  `` `rdm:[@8 Spellbook >> sort >> implode \n]` ``.

## 1.22.0

### Added
- **Deal multiple cards, straight into the note** (issue #8, from
  GilgameshofUT). Every deck call now takes an optional count and
  embed width: `` `deck:Poker|5` `` shows a Deal button that draws
  five at once (thumbnails inline, names for text-only cards) plus
  a 📌 that replaces the span with the hand as ordinary markdown —
  `![[card.png|200]]` embeds for cards with art (facing kept as
  trailing text), `**Name (facing)** — meaning` for text cards.
  `` `deck-mod:Poker|5|200` `` is the dice-mod of decks: the first
  render deals once and bakes the hand in the same act, and the
  deck only advances if the note rewrite succeeds. The codeblock
  form takes the same count — `deck:Poker|5` deals five per click,
  shows them as a row of cards, and its **📋 Copy hand** button
  copies the hand as markdown for pasting in Live Preview. Deck
  state tracking is unchanged throughout: one save and one change
  notification per deal, partial deals notice when the deck runs
  short, and rendering still never draws (the self-destructing
  `deck-mod:` span being the one deliberate, dice-mod-matching
  exception).

## 1.21.0

### Added
- **Quarter-turn decks.** A deck can now turn its cards any of
  four ways, for square cards with a reading on each edge (Story
  Engine) or random map tiles. In the Decks tab, **Turns** picks
  `half` (upright/reversed, as before) or `quarter`, and the old
  **Reversed chance %** field is now **Turn chance %** — the odds a
  draw is turned at all; a quarter-turned card lands on `right`,
  `reversed` or `left` with equal odds and its image rotates to
  match. In `.rdm` files, `Turn: quarter` (optionally `Turn: quarter
  25%`) does the same for in-generator decks and seeds a folder
  deck's defaults; `Flip:` still works and means `Turn: half`.
  Card text can branch on `{$facing}` (`upright` / `right` /
  `reversed` / `left`) or the new `{$turn}` (0–3 quarter turns
  clockwise). Existing `deck.json` files need no change.

## 1.20.1

### Fixed (review compliance)
- **In-note controls take `user-select: none` from the stylesheet.**
  `makeEditorSafe()` — the helper that keeps a roll's 🎲 / 🔒 / 📌,
  a codeblock's Reroll and a deck's Draw clickable in Live Preview —
  set that property from JavaScript, which Obsidian's automated
  plugin review flags. It now adds a `randomness-no-select` class
  defined in `styles.css`. A class survives `cloneNode` exactly as
  the inline style did, so the guard still holds when Obsidian
  copies rendered DOM into a widget of its own, and whole rendered
  results stay selectable so they can still be copied.
- **Timers belong to the window the view lives in.** Deck-state
  saves and the Decks tab's scroll restore called the bare global
  `setTimeout` / `clearTimeout` / `requestAnimationFrame`; in a
  popped-out window those belong to a different window than the one
  showing the view. They now go through `window.*` explicitly.
- **`@codemirror/state` and `@codemirror/view` are declared
  dependencies.** The Live Preview extension added in 1.19.0 imports
  them, but they were only present transitively. Both remain
  `external` in the build — Obsidian provides CodeMirror at runtime
  — so `main.js` is unaffected.
- **Tidying with no behaviour attached:** four type assertions that
  did not change a type, an unused import, a redundant escape inside
  a regex character class, a `const service = this` alias, and an
  untyped `new Array()` whose `.fill()` therefore passed an unsafe
  argument. Nothing in this release changes what the plugin does;
  all 1,610 tests pass unchanged.

## 1.20.0

### Added
- **`Hidden:` keeps helper tables out of the browser.** A generator's
  entry table usually calls others that exist only to serve it, and
  the browser listed all of them — so the one table you actually
  wanted to roll sat buried among its own plumbing. Put `Hidden:`
  under a table and it drops out of that list:

  ```text
  Table: Hoard
  [@Coins] and [@Gems]

  Table: Coins
  Hidden:
  a purse of silver
  ```

  It changes nothing else. The table still rolls, still answers to
  its name, still autocompletes, and the scripting API still sees it
  — this tidies a list, it does not make a table less usable.
  `Hidden: no` un-hides one without deleting the line.

  Hiding the first table doesn't change which table the file rolls;
  that is still the first one declared. And a file whose tables are
  all hidden says so, rather than claiming to be empty. Requested by
  SerhiiDeianov in issue #6.

## 1.19.0

### Added
- **Inline rolls now work in Live Preview.** They never have. A
  `` `rdm:[@Loot]` `` or `` `dice: 1d20` `` sat in the editor as the
  raw text you typed, and clicking it just put your cursor in it and
  showed the backticks — which is what people have been reporting as
  "clicking flips me back to source mode". Only Reading view ever
  rendered them.

  The reason is that Obsidian offers plugins the *block* elements of a
  note — which is why ```randomness codeblocks have always rolled in
  the editor — but draws inline code spans itself and never offers
  those. Randomness now renders them through the editor directly, so
  a roll looks and behaves the same in both views: same result, same
  🎲 / 🔒 / 📌 buttons, doing the same things. A roll you have already
  seen keeps its value when you switch views rather than re-rolling.

  Put your cursor in a roll and you get your expression back, so they
  are still editable. Rolls inside fenced code blocks stay as text —
  a `` ```text `` block showing example syntax is not meant to roll at
  the reader.

### Fixed
- **Buttons rendered into a note no longer move the editor's cursor.**
  Clicking a codeblock's Reroll, a deck's Draw or a portrait's Reroll
  counted as a click into the document, which in Live Preview can
  unrender whatever the cursor lands in. They are now sealed off from
  the editor. This was shipped in 1.17.1 as a fix for the inline
  problem above; it was not that fix, but it is a real one for the
  surfaces it covers.

## 1.18.0

### Fixed
- **A `randomness` block can now use tables from the rest of its own
  note.** A block calling `[@Party]` could not reach a `Table: Party`
  defined in the block directly below it — the same note, visible on
  screen, and the roll failed with "Unknown table: Party". Inline
  `` `rdm:` `` calls had always been able to see the whole note; only
  codeblocks were sealed off, for no reason anyone would recognise
  as intentional. They now see the note's other blocks and its
  `^block-id` markdown tables, in either direction: a block at the
  top can call a table defined at the bottom.

  Tables are shared; directives are not. A `Prompt:`, `MaxReps:` or
  `Set:` still belongs to the block that declares it, so no block can
  quietly change how another renders. On a name clash the block's own
  table wins, then anything it `Use:`s, then the rest of the note.
  Reported by huffn in issue #5.

- **A table chosen by a prompt can live in another file.**
  `[@{$Prompt1}]` builds its table name while rolling, so there was
  no name for Randomness to go looking for beforehand, and the roll
  failed even with the file sitting in the generator root. A block
  that picks a table this way now treats each of its `Prompt:`
  options as a name worth finding. The same report; it was the
  detail that a `[when]…[@Party]` workaround DID work from the
  generator root, while the prompt version didn't, that separated
  the two causes.

## 1.17.1

### Fixed
- **Clicking a button in Live Preview no longer throws you back to
  raw source.** Live Preview is a text editor with rendered markdown
  drawn into it, so a click on one of our buttons was also a click
  into the document: the cursor moved there, and Live Preview did
  what it always does when the cursor lands inside something — it
  showed you the source. The button worked, but your roll turned
  back into `` `rdm:[@thing]` `` under the cursor every single time,
  which made the whole plugin awkward to use in the mode most people
  write in.

  The cursor moves on mouse-down, before any click handler runs, so
  the controls now stop those events outright and mark themselves as
  somewhere a cursor can't go. This covers every button we draw into
  a note: an inline roll's 🎲 / 🔒 / 📌, a codeblock's Reroll, a
  deck's Draw, and a portrait's Reroll.

  The result *text* is deliberately left alone — clicking it is
  still how you put the cursor into a roll to edit or delete it.

- **Keeping a result as plain text no longer disturbs the rest of
  the note.** The edit replaced the whole document, which cost Live
  Preview its scroll position, folded sections and selection. It now
  rewrites only the roll itself.

## 1.17.0

### Added
- **Keep a result as plain text.** Inline rolls now have a third
  button, **📌**, next to re-roll and lock. It replaces the whole
  call with what it rolled — backticks, prefix and expression all
  gone — so the result becomes ordinary prose you can write around.
  Roll as many times as you like first; 📌 keeps whichever result
  you are looking at, including the formula when `|form` is on.

  Lock and 📌 answer different questions. Lock says "this result is
  the answer, but keep the machine". 📌 says "this is now just words
  in my note". Ctrl+Z undoes a 📌 while the note is open; after that
  the expression is gone, which is the point. Requested by Nedreow
  in issue #3.

### Changed
- **`dice-mod:` leaves plain text behind, the way it used to in Dice
  Roller.** It rolled once and then locked itself, which left a
  `` `dice-mod:1d20|form⟹7` `` span sitting in the note wearing an
  unlock button that could not work: unlocking stripped the lock,
  the note re-rendered, and the span immediately committed itself
  again. Now it bakes on first render — `` `dice-mod:1d20|form` ``
  becomes the words `1d20 → 7` and there is nothing left to click.

  Spans locked by older versions are left exactly as they are;
  upgrading rewrites nothing. Unlocking one turns it into an
  ordinary `dice:` call instead of handing it straight back to the
  bake, so it becomes a roll you can actually play with.

## 1.16.0

### Fixed
- **The reference and the guide now say what the engine actually
  does.** Every example in both was executed against the engine
  rather than read, and about sixty of them were wrong. The
  documentation had been describing features that were never
  implemented: the filter list advertised `a` and `mid`, neither of
  which exists, and gave the wrong argument shapes for `replace` and
  `eachchar` — all four failed silently, because an unrecognised
  filter returns your text unchanged with no error. `MaxReps:` was
  described as capping `[@100 expensive_table]`; it does not, and
  nothing does. `|sep:` was offered for `[@N table]`, which ignores
  it — use `>> implode` there. An embed example used a `!set`
  directive that has never existed, so it rendered a broken link.

  The **Settings reference** had been truncated mid-sentence and
  shipped that way: three settings of eight, no defaults, and three
  labels that don't match what Obsidian shows you. It now lists all
  eight with their real labels and defaults, plus the buttons.
  Dice Roller compatibility is documented properly as automatic —
  on whenever the Dice Roller plugin is disabled — rather than "off
  by default", which it never was.

  Also corrected: several dice modifiers do less than their names
  suggest (`s`/`sd` only reorder the displayed dice, `u` is skipped
  entirely when you ask for more dice than faces), a `-=` condition
  in `cs` is tested first and wins, keep/drop always applies last
  whatever order you write the suffixes in, and `dice: 1ds` quietly
  rolls a d100 instead of a Genesys setback die.

- **`\a` picked the wrong article in front of a rolled value.**
  `\a [@creature]` was always "an", whatever the table returned,
  because the lookahead read the unevaluated call rather than its
  result. It now decides from the rendered text, and works across a
  table boundary — an item that is just `\a` can take its noun from
  the caller.

### Changed
- **The beginner's guide is rewritten for someone new to all of
  this.** The old version explained `^` as "a block id" and `prop:`
  as "a template" — swapping one unknown word for another. Terms
  are now defined the first time they appear, in plain language,
  and the concepts that used to arrive undefined (block ids,
  frontmatter properties, codeblocks, variables, conditionals) are
  introduced before they get used. Chapter 1 warns you to turn Dice
  Roller off before its settings will do anything, and chapter 8
  tells you the one thing that does not migrate by itself: saved
  formulas need pasting into **Dice formula aliases**.

### Added
- **The documentation now runs in CI.** Every generator example in
  the docs is executed on each build, and every filter and directive
  the docs name is checked against what the engine implements —
  reading both lists out of the source, so they cannot drift. A
  wrong example is no longer invisible to the test suite.

## 1.15.1

### Fixed
- **Tag rolls on a big tag no longer only pick A-names.** The vault
  lookup returns matching notes sorted by path, and the roll took the
  first 50 of that list before the engine picked one — so a tag with
  1500 notes could only ever return notes from the top of the
  alphabet. `|link`, `|linkpath` and `prop:` rolls now consider every
  matching note: they build their result from the note's path and its
  frontmatter, so there is no file I/O to cap. Block rolls (`rdm:#tag`
  with no mode) read each candidate note off disk, so they keep a
  50-note ceiling, but it is now a random sample of the matches rather
  than the alphabetically-first 50. Seeded rolls stay reproducible —
  the sample is drawn from the roll's own seeded RNG. Reported by
  Gizmo734.

## 1.15.0

### Added
- **`|sep:` — choose what goes between multiple results.** A roll that
  returns several things has always joined them with `, `, which is
  right inside a sentence and wrong everywhere else. `|sep:` sets the
  glue: `` `rdm:3#monster|sep:<br>|link` `` puts one monster per line,
  `` `rdm:3#monster|sep:<br>• |link` `` bullets them, and
  `` `rdm:3[[Rumours|line]]|sep: /\_` `` runs them together with
  slashes. It works on every multi-result inline roll — tag rolls,
  table rolls, line and block rolls — and under the `dice:` prefix.

  Everything after `sep:` is the separator, spaces and HTML included.
  Escapes cover what the surrounding syntax would eat: `\n` newline,
  `\t` tab, `\_` space (needed at the end of a glue, since an inline
  span reaches the parser trimmed — `sep: / ` joins with `" /"`, and
  `sep: /\_` is the one that gives ` / `), `\\` backslash. On a wikilink roll
  `sep:` goes outside the brackets — inside them a pipe already means
  "column pick" — and on a tag roll it is a segment like `unique`, so
  it comes before `prop:`, which still swallows the rest of the line.
  Separator text is never evaluated, so a glue containing `[@table]`
  prints as itself. Thanks to Gizmo734 for the request.

### Fixed
- **`dice:*|folder=…` rolls instead of silently doing nothing useful.**
  The tagless `*` source — "any note matching these properties", with
  no tag constraint — never reached the tag-roll branch under the
  `dice:` prefix. It fell through to the formula translator and came
  out as the nonsense expression `{*|folder=Bestiary|link}`: no error,
  no roll, nothing to indicate the syntax was fine and the plumbing
  wasn't. The reference has claimed since these filters landed that
  they work under the compatibility prefix, so this was a documented
  feature that had never run. `*` now dispatches exactly like `#tag`,
  including the repetition prefix, `|unique`, and `prop:` templates,
  and a test pins the two prefixes to the same note on the same seed.

- **Documentation: `[@N table]` was described as joining results with
  blank lines.** It doesn't, and shouldn't — a repeated sub-table call
  runs its results straight together, because it is nearly always
  embedded in a sentence (`The party of [@4 hero] sets out.`) where an
  injected blank line would be wrong. The separator is the author's
  call, via `>> implode`: bare for `, `, or `\n` / `\n\n` / `<br>` /
  `;\_` for anything else. The reference's "Call variations",
  "Filters" and "Repetitions" sections now say so, with a new note on
  the one place separation *is* automatic — a whole-file `MaxReps:`
  roll, whose reps are standalone blocks and so are blank-line
  separated. Behaviour is unchanged; the corpus tests now pin every
  one of these joins so the docs can't drift again.

  Two smaller errors went with it: a filter's glue is **trimmed** and
  never quoted, so the documented `implode ", "` would have put the
  quote marks in the result and `implode , ` loses its trailing space.
  Both examples are corrected, and `\_` is documented as the way to
  end a glue with a space. Thanks to claudermilk for the report.

## 1.14.0

### Changed
- **A bare dice formula in an `rdm:` span now rolls.** `` `rdm:2d10` ``
  used to render the literal text "2d10" — no roll, no error, nothing
  to suggest anything was wrong. It was the trap waiting for anyone
  converting `dice:` spans, where the formula *is* the whole
  expression. An inline call that is nothing but a dice formula is now
  treated as `` `rdm:{2d10}` ``, and an omitted die count is filled in
  (`` `rdm:d20` ``) for the same reason.

  The test is deliberately narrow: the whole expression must be a
  formula, so `` `rdm:you take 2d6` `` is still literal text, and no
  expression containing generator syntax (`[@table]`, `{…}`, `#tag`,
  `|`) can match. Bracing is native, so `` `rdm:3d6>=10` `` means what
  `` `rdm:{3d6>=10}` `` means — 1 when the total reaches 10 — rather
  than the success-counting a `dice:` span would read it as. Thanks to
  Anna_B_Meyer for walking into it.

## 1.13.0

### Added
- **A "Show dice formula" setting.** Inline rolls can now show what
  was rolled next to the result — `2d6+3 → 11` instead of a bare `11`
  — without adding a flag to every call. Settings → Randomness → Show
  dice formula, off by default. It covers both prefixes, so
  `` `rdm:{2d6+3}` `` and `` `dice:2d6+3` `` read the same (the `{…}`
  wrapper is dropped from the display), and it only touches rolls that
  actually rolled dice, so `` `rdm:[@Weather]` `` is unaffected. A
  `dice:` span still overrides it per roll: `|form` shows the formula
  with the setting off, `|noform` hides it with the setting on, and
  `|text(label)` wins over both. The formula is display only — locking
  a roll commits the result, as before. `|noform` had been accepted
  and ignored until now. Thanks to Anna_B_Meyer for the request.

## 1.12.0

### Added
- **Roll more than one note at a time.** Tag and folder rolls take the
  same repetition prefix the `[[Note|line]]` rolls have always had —
  `` `rdm:3#monster|link` `` or `` `rdm:{1d4}#rumour` `` — and the new
  `|unique` segment draws them as a deck so no note comes up twice:
  `` `rdm:3#monster|unique|link` `` is three *different* monsters.
  Comma-joined, works with `prop:` templates
  (`` `rdm:3*|folder=Bestiary|unique|prop:{{name}} (CR {{cr}})` ``), and
  passes through the `dice:` prefix. `|unique` has to come before
  `prop:`, which swallows the rest of the line. Asking a unique roll for
  more notes than match gives you all of them rather than an error.
  Thanks to Gizmo734 for the suggestion.

## 1.11.0

### Added
- **`api.rollFormula()` and `api.formulas()` — saved dice formulas are
  now reachable from scripts.** Formula aliases (Settings → Randomness
  → Dice formula aliases, and the dice tray's ★ button) resolved only
  for inline `dice:` spans and the tray, so a Templater / Meta Bind /
  QuickAdd script had no way to invoke one — the reported case was an
  initiative button that rolls exploding step dice and writes the
  result to a monster note's frontmatter. `api.rollFormula("sneak")`
  now rolls the saved alias (matched trimmed and case-insensitively,
  exactly as inline), and any unmatched string is rolled as a raw
  formula in the full Dice Roller grammar — modifiers, special dice,
  `[[Note^id]]` table rolls, `#tag` rolls. `api.formulas()` lists the
  saved aliases. `roll()`, `rollUnscoped()` and `rollExpression()` are
  unchanged: they still do not resolve aliases, so an expression
  sharing a name with one keeps its existing meaning. API version
  1.2.0 → 1.3.0 (additive).
- **Print a rolled note's properties, not just a link to it.** Tag and
  folder rolls could always *filter* on frontmatter
  (`rdm:*|folder=Bestiary|cr=3|link`); now they can output it. End the
  call with `prop:` and the rest is a template:
  `` `rdm:*|folder=Bestiary|prop:{{link}} — CR {{cr}}, {{hp}} HP` `` →
  *[[Bestiary/Bog Hag|Bog Hag]] — CR 3, 45 HP*. One note is rolled and
  the whole template is filled from it, so the values can never belong
  to different monsters the way two separate `` `rdm:` `` spans would.
  `prop:cr` is shorthand for `prop:{{cr}}`. `{{link}}`, `{{linkpath}}`,
  `{{path}}` and `{{name}}` describe the note itself; every other
  placeholder is a frontmatter key, and naming one also requires it, so
  a note missing that property is never picked. Works under the `dice:`
  prefix too.
- **`api.randomNote()` now returns the note's `frontmatter`**, so
  Templater and dataviewjs callers don't need a second `metadataCache`
  lookup. API version 1.3.0 → 1.4.0 (additive).

## 1.10.0

### Added
- **`count(Table)` inside `{...}` — how many items a table has.**
  Mostly useful for rolling an index that stays valid as a table
  grows: `{1d{count(npcs)}}` instead of hard-coding `1d3` and
  forgetting to update it when you add a row. The argument is a table
  *name* rather than a value, so dotted column names
  (`count(npcs.Job)`), quoted names with spaces, and interpolated
  names (`count({$whichTable})`) all work. It counts items, so a
  lookup table with two range rows counts 2, not the span of its dice
  formula; counting a table that doesn't exist is an error, the same
  as rolling one.

### Documentation
- **How to pull several columns from the *same* rolled row.** Each
  column of a markdown table is its own rollable table, so
  `[@npcs.Job]` and `[@npcs.Name]` land on different people — which
  looks like a bug the first time you write a sentence with two of
  them in it. The fix is to roll the row number once and pick by
  index: `The [#{row=1d{count(npcs)}} npcs.Job] was [#{$row}
  npcs.Secret]`. Written up in the reference (*Rolling on note
  content → One row, several columns*) and in guide note 02, along
  with the reason it can't be split across two `` `rdm:` `` spans:
  every inline span is evaluated on its own, so variables don't carry
  from one to the next.
- The `[#table]` current-index form — pick the item at the position
  of the item currently being rendered, for cross-indexing parallel
  tables — is now in the call-variations table, and the function list
  (`if`, `max`, `min`, `round`, `substr`, …) is documented at all.

## 1.9.2

### Fixed
- **The dice animation now shows the total when a roll has a
  modifier.** The graphical dice overlay only drew its `= total` line
  when a roll had more than one die, so a single die plus a modifier —
  `1d20 + 5`, `1d6 - 3` — animated the die and showed nothing else.
  The die face was the only number on screen, which read as "the
  modifier was ignored"; the roll itself was always correct, and the
  dice tray's result panel had the right number the whole time. The
  total is now shown whenever it says something the faces don't: more
  than one die, or a flat modifier or dropped die that makes the total
  differ from the dice on screen. A plain `1d20` still animates
  without a redundant total. Thanks to Anna_B_Meyer for the report.

## 1.9.1

### Added
- **`names.rdm` in the Fantasy Hub bundle — a much larger NPC name
  pool.** Dictionary tables keyed by `race_gender`
  (`[#elf_female TF-PersonName]`, or `rollUnscoped("TF-PersonName",
  { dictKey: "elf_female" })`), plus `TF-FirstName` and `TF-Surname`
  for the halves. Surnames blend a curated list with a
  prefix + suffix compound table, giving roughly 16,000–47,000 full
  names per race/gender bucket instead of a few hundred. Covers human,
  elf, half-elf, half-orc, gnome and goblin; half-elves draw from both
  parent cultures. Town Forge's place templates use it to keep every
  NPC in a settlement distinct.

### Changed
- **Bigger built-in portrait name tables.** The names behind
  `api.portraits.roll()` came from lists of 9–15 entries per race, so
  a town full of NPCs would occasionally hand out the same name twice
  (human males had only 210 possible full names). Each list is now
  32–48 entries — human is 48 × 48 — cutting the chance of a repeat
  across a 40-NPC town from roughly 36% to 4%. This is the fallback
  path now that the Fantasy Hub ships `names.rdm`.
- **Fantasy Hub `Personality` grown from 21 to 61 beats**, so
  characters stop sharing a personality line two or three times per
  generated town.

## 1.9.0

### Added
- **Reroll button on `randomness` codeblocks.** Fenced ```` ```randomness ````
  rollers now render a Reroll button beside their prompt controls, so
  an NPC or table roller embedded in a note can be re-rolled in place —
  the same affordance the `.rdm` file view and inline calls already
  had. Prompt selections are preserved across rerolls, and the button
  forces a fresh roll even when **Stable codeblock seeds** is on (the
  new result then persists across passive re-renders until the next
  reroll).

## 1.8.0

### Changed
- **Tag and property `|link` rolls now show the note's name, not its
  full path.** `` `rdm:#tag|link` `` and property/folder variants like
  `` `rdm:*|spelllevel=1st|link` `` render the wikilink as the note's
  name — `Burning Hands` rather than `Spells/Level 1/Burning Hands` —
  while still linking to the correct note wherever it lives in the
  vault. This is the new default for every `|link` roll.

### Added
- **`|linkpath` flag** for link rolls that keeps the full vault path
  visible, for anyone who preferred the previous display. Works under
  the `dice:` compatibility prefix too (`` `dice:#tag|linkpath` ``).

## 1.7.0

### Fixed
- **Copy button on Android pasted a `tempNNNN.html` attachment link
  instead of the result.** The sidebar's Copy button used to put an
  HTML flavour on the clipboard and let Obsidian convert it to
  markdown on paste. Android's WebView hands that flavour back as a
  file, so Obsidian saved it into the attachment folder and linked to
  it. Copy now converts to markdown itself and writes plain text only
  — formatting is preserved on every platform, and there's no HTML
  flavour left to be mishandled.

### Added
- **Folder filters on tag rolls.** `folder=` is a reserved filter
  segment restricting candidates to notes under a folder (recursive;
  comma for OR) — combine with tag and property filters:
  `` `rdm:*|folder=Bestiary|cr=3|link` `` rolls a random CR 3 monster
  note, ready to drop into an `encounter:` line.
- **Visible re-roll die on API-shim rollers.** Encounter counts
  rendered through the `window.DiceRoller` shim (Initiative Tracker's
  `1d6: [[Monster]]`) now show a small die icon; clicking the count
  re-rolls it.

## 1.6.0

### Added
- **Dice breakdown — see what each die rolled.** The engine now reports
  every die's face alongside the sum (Ironsworn challenge dice, stat
  arrays, …):
  - **Hover any inline roll** for the per-die breakdown
    (`4d6dl1 → 5, 3, (1), 6` — dropped dice in parens, explosions `!`,
    re-rolls `r`). Always on; works for `rdm:` and `dice:` spans alike,
    including dice inside table results.
  - **Settings → Randomness → Show dice breakdown** appends the faces to
    the visible result — `13 (7, 6)` instead of just `13`. Individual
    `dice:` spans can opt in with the new `|dice` flag instead.
  - **Locks commit the faces when they're visible**, so the record
    survives in the note.
  - **Dice tray history** shows the breakdown under each roll, and the
    big result's tooltip carries it too.
  - For scripts: `EvaluatorOptions.onDice` receives each dice term's
    notation, per-die detail, and total during evaluation.
- **Deck display blocks.** A ```` ```randomness ```` codeblock whose
  whole body is `deck:Name` renders the deck's last-drawn card at full
  card size with a 🎴 Draw button and remaining count — the big-card
  companion to the compact inline span. Rendering never draws.
- **Card copy buttons.** Hovering a drawn card (Decks tab or deck
  block) shows portrait-style icon buttons: copy the card image as an
  `![[embed]]`, copy a ready-to-paste deck block, copy the card as
  text, or copy the inline `deck:` span.
- **Weather example deck.** Ten illustrated cards for day-by-day
  weather: upright passes by nightfall, reversed settles in until the
  next card (reversal chance preset to 40%). Downloadable from
  settings alongside the playing cards and tarot decks, which now
  share one compact "Example decks" row.

### Fixed
- **Initiative Tracker / Fantasy Statblocks encounter counts.**
  `encounter: 1d6: [[Monster]]` no longer collapses to a flat 1 when
  Dice Roller is disabled mid-session: the `window.DiceRoller` shim
  now takes over live when Dice Roller unloads (and when the compat
  toggle flips), and its rollers gained the `isStatic` /
  `containerEl` surface the encounter line renders — including
  click-to-re-roll counts.
- **Decks tab quality of life.** Decks collapse to their title row
  (click the title; persisted, with Collapse all/Expand all), the tab
  no longer resets its scroll position on every draw, and drawn cards
  no longer flash their text while the image loads.

## 1.5.0

### Added
- **Tag rolls can filter by tags AND/OR frontmatter properties.** Extra
  pipe segments narrow the candidate notes — ideal for multi-universe
  vaults:
  - `` `rdm:#npc|universe=Eldara|link` `` — only notes whose `universe`
    property is Eldara.
  - `` `rdm:#npc|#merchant` `` — both tags required; `#npc,#monster` —
    either tag.
  - `` `rdm:#npc|universe=Eldara,Vex` `` — property is Eldara OR Vex;
    `universe=*` — property exists with any value.
  - `` `rdm:*|universe=Eldara` `` — filter by property alone, no tag.
  - Matching is case-insensitive; list-valued properties match if any
    entry hits; wikilink values (`universe: "[[Worlds/Eldara]]"`) match
    their target's name or alias. Works under the `dice:` compatibility
    prefix too. Still metadata-cache only — no Dataview required.

## 1.4.0

### Added
- **Persistent decks.** Deck state can now survive across rolls, notes, and
  restarts (design: `docs/persistent-decks-design.md`):
  - **Folder decks** — each folder under `<Generator Root>/Decks/<Name>/` is a
    deck. One image = one card; an optional `.rdm` file (`Type: Dictionary`
    recommended) adds card text, paired to images by filename ↔ key
    (`the-tower.png` ↔ `The Tower`). A `_back.*` image is the card back.
    Settings + state live in `deck.json` inside the folder, so a deck travels
    (and syncs) with its state.
  - **`[!deck:Name]`** draws from a folder deck inside any generator; the
    `deck:` prefix keeps decks out of the table namespace. `Shuffle: deck:Name`
    resets one.
  - **`deck:Name` inline spans** in notes render the last drawn card with a
    🎴 Draw button. Rendering never draws — only the explicit click does, so
    scrolling a note can't burn cards. The same rule applies everywhere:
    passive codeblock re-renders draw from a throwaway copy; explicit actions
    (browser Roll, inline re-roll, Decks tab, commands) commit.
  - **`Deck: persistent`** table directive — an in-generator table's deck-pick
    state persists (stored in the plugin folder's `deck-state.json`).
  - **`Flip: N%`** table/deck orientation — each draw sets `{$facing}` to
    `upright`/`reversed` so card text can branch (tarot-style), and reversed
    card images render rotated.
  - **Decks tab** in the browser pane: per-deck Draw / Peek / Draw & bury /
    Undo / Shuffle, remaining count, reversal-chance setting, and draw history.
  - **Commands**: "Draw a card from a deck" and "Shuffle (reset) a deck".
  - **Example decks in settings** — downloadable on demand (never bundled, to
    keep the plugin small): a standard 54-card playing deck and the
    public-domain Rider–Waite–Smith tarot with Waite's 1911 upright/reversed
    meanings, reversal preset to 50%.

## 1.3.4

### Fixed
- **Oracle/lookup tables work with a plain die header — no `dice:` syntax
  needed.** A two-column table headed `d6`, `D6`, `d100`, or `d%` (not just the
  explicit `` `dice: 1d20` `` form) is now rolled correctly: the header is
  normalised to a formula the engine can actually roll (`d6` → `1d6`), so the
  lookup returns the matching row instead of silently coming back empty. The
  lookup is only built when the header normalises to a real die, so a plain
  label header stays an ordinary table rather than a broken lookup.

## 1.3.3

### Fixed
- **Dice Roller `|form` and `|text` flags now survive a re-roll.** The formula
  (`|form`) or label (`|text(…)`) was only applied on first render; clicking
  🎲 re-roll collapsed the span to the bare rolled number. Both display flags
  are now re-applied on every roll.
- **The `|form` flag no longer leaks into the shown formula.** A `2d6+3|form`
  roll now displays `2d6+3 → 11` instead of `2d6+3|form → 11`.

## 1.3.2

### Fixed
- **A broken `Use:` no longer breaks every inline roll in a note.** A single
  unresolvable `Use:` in one `randomness` codeblock used to make *every* inline
  `rdm:` call in the same note render a "target not found" error. Now a plain
  `rdm:[@table]` call ignores an unrelated broken import and still rolls; only
  explicit `rdm:[[Note]]` and `#tag` calls report a genuinely missing target.
- **Documentation examples stay inert.** A `randomness` codeblock shown inside a
  larger display fence (e.g. a ````text wrapper) is no longer extracted and run,
  and inline `rdm:`/`dice:` spans inside fenced code blocks are no longer
  evaluated — so guide and reference examples display instead of executing.

## 1.3.1

### Fixed
- **Installing Fantasy Hub content no longer sets off Templater prompts.** The
  templates destination is now added to Templater's excluded-folders list before
  the bundle is written, so Templater's "trigger on new file creation" no longer
  executes the templates as they land — which was prompting for town/size and
  could overwrite the templates.
- The Fantasy Hub *Start Here* note rolled `[@FantasyShop]`, a table that does
  not exist — corrected to `[@TF-Shop]`, clearing the "Unknown table:
  FantasyShop" render error.

## 1.3.0

The Dice Roller merge, complete (phases 1–7) (see
`docs/dice-roller-merge-plan.md`). Dice mechanics and syntax ported
from @javalent/dice-roller (MIT, © Jeremy Valentine).

### Added
- **Fantasy Statblocks support.** Randomness now provides the
  `window.DiceRoller` API surface that Fantasy Statblocks (and other
  Dice Roller API consumers) integrate with — `registerSource`,
  `getRollerString`, `getRollerSync`/`getRoller`, `parseDice`, and
  the `dice-roller:loaded` event. Statblock attack and damage dice
  keep rolling after Dice Roller is disabled. The shim never installs
  while the standalone plugin is enabled.
- **Dice modifiers** on any `{NdN}` term: keep/drop (`k`, `kh2`, `kl2`,
  `dl1`, `dh1`), exploding dice (`!`, `!!`, `!3`, `!i`), re-rolls (`r`,
  `r3`, `ri`), sort (`s`, `sd`), unique (`u`), and success counting
  (`cs>=5`, with `-=N` scoring −1). Explode and re-roll accept optional
  conditions (`{1d6!i=!3}`, `{1d4r<3}`); conditions chain and are OR'd.
  `{4d6dl1}` and `{2d20kh}+5` finally work everywhere the engine rolls —
  codeblocks, inline `rdm:`, and the JS API.
- **Special dice:** percentile `{1d%}`, digit dice `{1d66%}` (Traveller
  d66), Fudge/Fate `{4dF}`, and custom face ranges `{1d[3,5]}`.
- **Roll on markdown tables and lists.** Any table or list in a note
  with an Obsidian `^block-id` is now a rollable table. Inline:
  `` `rdm:[[Note^taverns]]` `` (with lock/re-roll buttons); from
  codeblocks and generators: `Use: [[Note]]` then `[@taverns]` with
  reps, filters, and deck picks. Multi-column tables expose
  `[@id.Header]` per column and `[@id.xy]` for a random cell (inline:
  `|Header` / `|xy`). Two-column tables with a dice-formula header
  (`dice: 1d20`) act as lookup tables, ranges like `1-2`, `11`, and
  `13,14` included. Cells are raw generator syntax, so `{2d6}` and
  `[@OtherTable]` inside a cell just work.
- **Dice Roller compatibility (`dice:` inline rolls).** A new
  settings toggle routes inline `dice:` code spans —
  plus `dice+:`, `dice-:`, and `dice-mod:` — through the Randomness
  engine with Dice Roller's own syntax: bare success conditions
  (`3d6>=5` counts successes, as Dice Roller defined it), omitted
  values (`d20`, `3d` → d100s), all modifiers and special dice, and
  table rolls `3[[Note^id]]` / `1d4+1[[Note^id]]` / `|Header` / `|xy`.
  Every `dice:` span gets Randomness lock/re-roll buttons — locks
  replace Dice Roller's fragile result saving and `dice-mod:`.
  `|text(label)` shows the label with the rolled value in a tooltip,
  `|form` shows the formula with the result, and `dice-mod:` spans
  write their roll into the note on first render (as a lock — the
  durable form of Dice Roller's note-modifying roll). `|render` plays
  the graphical dice animation; the remaining display flags
  (`|nodice`, `|avg`, `|none`, `|noform`) are accepted and
  currently inert. Formula aliases from
  settings work too: define `sneak = 4d6dl1` under Settings →
  Randomness → Dice formula aliases and `dice: sneak` rolls it. Not
  yet supported (clear errors): stunt and Genesys narrative dice. The toggle defaults to ON when the Dice
  Roller plugin isn't enabled and OFF while it is (an explicit choice
  always wins); enabling it alongside an active Dice Roller shows a
  warning — one plugin at a time should own the spans. Flipping the
  toggle re-renders open notes immediately.
- **Dice tray.** A right-sidebar tray (dices ribbon icon, or the
  "Open dice tray" command) replacing Dice Roller's Dice View: tap
  d4–d100 buttons to build a pool (right-click removes), toggle
  advantage/disadvantage (each d20 becomes `2d20kh`/`2d20kl`), step a
  flat modifier, and Roll. A formula box takes the full Dice Roller
  syntax — modifiers, `[[Note^id]]` table rolls, `#tag`, aliases —
  scoped to the active note so `[@Table]` works too. Formulas saved
  from the tray land in the same store as the "Dice formula aliases"
  setting, so a tray-saved `sneak` also rolls as `dice: sneak` in
  notes. Click a history row to re-roll it; click the result to copy.
- **Graphical dice.** Rolls can animate: a tumbling 3D cube for
  d6s, spinning polyhedra with a slot-machine number cycle for the
  rest, settling on the rolled faces (dropped keep/drop dice shown
  dimmed, total badge for multi-die rolls). Plays in the dice tray
  and for inline rolls with the `|render` flag; click to dismiss.
  Purely decorative by design — the engine rolls first and the
  animation replays those exact values, so seeds and locks are
  unaffected, and there are zero new dependencies (the three.js
  physics port was rejected: Obsidian plugins can't lazy-load
  chunks, so it would have permanently ~5×'d the bundle for an
  animation). Toggle under Settings → Randomness → Graphical dice.
- **Beginner's guide (installable).** Settings → Randomness →
  "Install the guide" writes a "Randomness Guide" folder of ten
  short notes — one per feature, kid-friendly, every example live
  and rollable — from "roll a die" through generator files.
  Re-running refreshes the notes. Sourced from docs/guide/
  (npm run embed-guide).
- **"Create new generator file" command.** A .rdm file is just a
  text file, but Obsidian can't create one and manual renames trip
  over hidden Windows extensions — this command creates a starter
  generator (in the Generator root when set), uniquely named, and
  opens it for editing.
- **README rewritten** for the merged plugin: 30-second tour,
  dice/tables/locks/compat up front, learning path, migration
  pointer.
- **Migration guide & retirement kit.** docs/migrating-from-dice-roller.md
  walks Dice Roller users through the (three-step) switch, and
  docs/retirement/ holds the ready-to-paste README banner, final
  release notes, and deprecation-notice patch for winding down the
  dice-roller repository.
- **Roll random lines, blocks, and tagged notes (no Dataview
  needed).** `rdm:[[Note|line]]` rolls a random line from a note,
  `rdm:[[Note|block]]` a random block (paragraph, heading, fenced
  code…); repetitions work (`rdm:3[[Note|line]]`). `rdm:#tag` rolls a
  random block from a random note carrying that tag (frontmatter and
  inline tags, nested tags included), and `rdm:#tag|link` inserts a
  link to a random tagged note — all backed by Obsidian's own metadata
  cache. Tag picks happen inside the engine, so seeded rolls stay
  deterministic and re-rolls re-pick the note. In `dice:` compat,
  `[[Note]]`, `[[Note]]|line`, `#tag`, `#tag|-`, and `#tag|link` now
  work (block-type filters like `|paragraph` approximate to the block
  roll; the every-file `#tag|+` mode errors clearly).
- **Wikilinks resolve like Obsidian links.** `Use: [[Note]]`,
  `rdm:[[Note^id]]`, and codeblock imports now fall back to
  `metadataCache.getFirstLinkpathDest`, so a shortest-path link finds
  the note anywhere in the vault — not just relative to the calling
  note or the Generator root.
- **Repetitions on inline wikilink rolls.** `rdm:3[[Note^id]]` and
  `rdm:{1d4+1}[[Note^id]]` roll multiple results, joined with ", ".
- **Wikilink `Use:` targets.** `Use: [[Note]]` / `Use: [[Note^id]]`
  resolve like Obsidian links written as paths — relative to the
  calling note's folder, then the Generator root, then vault-rooted.

### Performance
- **Large notes render far faster.** Every inline `dice:`/`rdm:` span
  rebuilds its scope by parsing the whole note, so a big sheet
  (2,000+ lines, hundreds of spans) re-parsed itself once per span —
  several seconds of stalls on load. The note-table extraction and
  codeblock scan are now memoised by content, so the note is parsed
  once per render instead of once per span (measured ~68x faster on a
  740-span note: 3.5 s of parsing down to ~50 ms). Results are
  unchanged; an edit is a natural cache miss.
- **Table auto-discovery no longer re-scans the whole note per span.**
  Resolving `[@table]` references parsed every table cell in scope on
  every span; the per-table reference set is now cached by table
  identity (another ~12x on the same note). 
- **A block's rollers fill together.** Inline spans in a block are now
  evaluated concurrently instead of one after another, so a big table
  populates in one paint rather than visibly ticking down row by row.
  The vault index dedupes concurrent warm-ups so the parallelism
  doesn't trigger redundant rescans.

### Fixed
- **Padded lookup tables no longer leak their range keys.** Sheets
  that pad every row with a trailing empty column
  (`| 01-30 | Creature, resident |     |`) failed lookup detection
  (which required exactly two columns) and fell through to the
  multi-column path, which joined the key cell into the result — a
  roll showed "01-30, Creature, resident" and self-referential reroll
  tables stacked keys ("35-36, 01-30, Creature, resident"). Trailing
  columns that are empty in the header and every row are now trimmed
  before the table shape is decided.
- **Lookup headers written as code spans now parse.** Real sheets
  write the dice header as `` `dice:1d100` ``; the backticks were fed
  straight into the engine, erroring x150 with "unexpected character
  '`' at position 0". Code wrapping is now stripped before the roll
  expression is read.
- **Paragraph blocks with a `^block-id` are rollable one-item tables.**
  Dice Roller rolled any block, and real sheets use small paragraph
  blocks as aliases (`^encounter-underworld-lawful-day` whose only
  content is another roll). Such blocks now resolve instead of being
  skipped.
- **Embedded rollers that point back at their own note roll.** A
  `` `dice:[[This Note#^id]]` `` span inside a cell now translates to a
  direct engine call (`[@id]`, reps and column picks included) so
  nested rollers actually roll. The self-note match is
  case-insensitive, matching Obsidian's link resolution
  (`[[encounter tables]]` finds "Encounter Tables").
- **Untranslatable embedded rollers degrade instead of erroring.**
  Cross-note `` `dice:[[Other^id]]` `` spans and unsupported syntax
  keep their literal text but lose the backticks, so the engine's
  content parser shows the span verbatim rather than erroring the
  whole cell.
- **Unlock now works on duplicated expressions in Live Preview.**
  Live Preview renders each row/widget separately (with no section
  info), and a locked span could pair with its first UNFILLED twin
  in the source — so clicking unlock targeted the wrong occurrence
  and did nothing. Pairing now requires the locked value to match.
- Locked spans now show an unlock icon instead of the dice icon —
  clicking it strips the lock and rolls a fresh preview, same
  behaviour, honest icon. Same button slot, so no mouse-chasing.
- Markdown backslash escapes in results render correctly: `\*`
  shows a literal `*` (footnote markers like "5 sp \**") instead of
  a visible backslash. Escapes inside code spans stay byte-literal.
- **Identical expressions repeated the same result across a note.**
  The engine's default RNG seed was `Date.now()` — a note render
  evaluates every span in the same millisecond, so time-identical
  seeds made every copy of an expression land on the same pick
  (eight "Grinning Oak" taverns). Unseeded evaluations now draw
  their seed from `Math.random()`; explicit seeds are unchanged.
- "Lock all" now commits each occurrence's own on-screen value
  instead of copying occurrence #1's result to every duplicate.
- **Cross-note rolls now prefetch their target.** `dice: [[Note^id]]`
  injects its `Use:` line at bundle-build time — after the async
  prefetch had already run — so the target note never entered the
  resolver snapshot and every cross-note lookup failed with "Use:
  target not found". The prefetcher now walks direct-wikilink targets
  (and their own `Use:` graphs) explicitly.
- `dice:` spans embedded in table cell text roll as part of the
  result ("Bustling `dice:1d8+5` x # Inn Rooms") — Dice Roller
  revived them via MarkdownRenderer; we translate pure formulas into
  engine dice at extraction time.
- Lookup tables with **bolded keys** (`| **1** | Braised beef |`) are
  recognised — authors habitually bold the dice column, and Dice
  Roller tolerated it. Emphasis/code wrapping is stripped from key
  cells before range parsing.
- **Dice Roller compatibility is now truly automatic.** 1.3.0 draft
  builds computed the compat default once at load and then saved it,
  so disabling Dice Roller later did nothing and `dice:` spans
  rendered as plain code. The decision is now evaluated live on
  every render: no explicit choice → compat is on exactly when the
  Dice Roller plugin is disabled. The settings toggle now writes an
  explicit choice (new `diceRollerCompatChoice` key; the baked
  legacy key is dropped on load).
- All Dice Roller display flags are tolerated: `|paren`, `|noparen`,
  `|round`, `|floor`, `|ceil`, `|noround`, and `|signed` no longer
  error (they strip cleanly; rounding/sign display remain inert).
  This is also what Fantasy Statblocks appends to every roll.
- README/CHANGELOG shipped with trailing NUL bytes in 1.3.0 draft
  builds; scrubbed.

### Changed
- **Self-imports are now a silent no-op.** `Use:` pointing at the file
  (or note) that contains it previously threw "Use: cycle detected" —
  and once notes hold rollable tables, `Use: [[This Very Note]]` is an
  easy thing to write. A file's own tables are already loaded, so the
  self-import just resolves to nothing. True multi-file cycles still
  error.
- **A note's own markdown tables are in scope for its inline calls.**
  `rdm:[@taverns]` works in the note that defines `^taverns` with no
  `Use:` line, mirroring how same-note codeblock tables behave.

### Compatibility
- Bare comparisons keep their IPP3 meaning: `{3d6>=10}` still compares
  the *sum*. Success counting requires the explicit `cs` marker. Every
  new suffix was previously a parse error, an unmodified `NdN` consumes
  the RNG stream identically to before (seeded generators reproduce
  exactly), and `1d[@table]` nesting is unchanged. The full `.ipt`
  corpus passes untouched.
- Markdown-content tables are additive: blocks without a `^block-id`
  are ignored, and a plain `rdm:[[Note]]` (no block id) still renders
  as an ordinary wikilink.

## 1.2.0

Feature release: reference tables across files without `Use:`, plus a
revamped, beginner-friendly example tutorial.

### Added
- **Auto-discovery by table name.** A `randomness` codeblock or an inline
  `rdm:` call can now reference a table by name (`[@TavernName]`) with no
  `Use:` line — the plugin finds the generator file that defines it
  anywhere under your Generator root and pulls it in automatically,
  following that file's own `Use:` graph transitively. It is
  lowest-priority and purely additive: anything you define locally or
  import with `Use:` always wins, so discovery can never shadow your own
  tables. Previously this resolved only via the JS API.
- **Example tutorial covering all four usage styles.** The "Add examples"
  button now ships a guided, heavily-commented set — inline in a note, a
  self-contained codeblock, standalone `.rdm` generators, and referencing
  a `.rdm` file from a note — plus a plain-language "Start Here" note.

### Changed
- **"Add examples" installs into its own `Randomness Examples`
  sub-folder** under the Generator root, so the tutorial stays grouped and
  is easy to remove in one move.

### Fixed
- **Error messages are readable in every theme.** Codeblock and inline
  error boxes used a red-on-red colour pairing that was unreadable in many
  dark themes; they now use a neutral panel background with a red accent.

### Tests
- New `autoDiscover` suite (discovery, transitive discovery, the
  no-shadow guarantee, and dynamic/unknown references) plus updated
  bundled-examples coverage.

## 1.1.1

Maintenance release. No user-facing changes.

### Security
- Bumped esbuild to 0.28.1 to clear advisory GHSA-gv7w-rqvm-qjhr
  (dev-time only; the shipped plugin code is unaffected).

## 1.0.18

Bug fix release. Codeblocks that use \`Use:\` to import another
generator and then call a table directly no longer render silently
empty.

### Fixed
- **Codeblocks with \`Use:\` but no explicit \`Table:\` no longer
  silently produce empty output.** The most common shape of a
  codeblock — \`Use: foo.ipt\` followed by one or more bare
  \`[@SomeTable]\` calls — was being parsed as zero tables, and
  the evaluator returned an empty string with no error.
  Authoring around this required adding \`Table: Main\` on the
  line above the call, which was a hidden requirement nowhere
  in the docs.

  The fix: when the parser encounters orphan items (lines that
  aren't directives, before any explicit \`Table:\`), it now
  synthesises an implicit \`__main__\` table to hold them. The
  evaluator picks this up as the file's main entry and rolls
  it normally.

  Files that already declare their main table explicitly see no
  change. The fix is purely additive — it makes previously-broken
  codeblocks Just Work without affecting anything that was working.

### Tests
- 5 new parser tests covering the orphan-items cases (bare-after-Use,
  multiple-orphans, orphans-before-explicit, regression guard for
  files starting with Table:, degenerate Use:-only file).
- 4 new integration tests exercising the codeblock-with-Use scenario
  end-to-end through the evaluator. Total: 984 tests, all green.

## 1.0.17

Follow-up to 1.0.16, clearing the last two warnings from the
automated review. No behaviour change.

### Fixed
- **`vault.modify` no longer needs an `as any` cast.** The
  `seedExampleGenerators` flow narrowed a `TAbstractFile | null`
  to a `TFile` via duck-typing (`"stat" in existing`), which
  TypeScript can't follow — so the call site cast through `any`.
  Switched to `instanceof TFile`, which TypeScript's flow analysis
  recognises and narrows correctly. Same runtime behaviour;
  removes both the "unexpected any" and "unsafe argument"
  warnings.

## 1.0.16

Cleanup release addressing the warnings flagged by the Obsidian
community plugin automated review of 1.0.15. No errors flagged in
that review (1.0.15 fixed all blocking issues); this release clears
the warning backlog so future submissions stay clean.

No user-visible behaviour changes — all fixes are lint compliance,
type tightening, and dead-code removal.

### Changed
- **`document` / `window` → `activeDocument` / `activeWindow`** in 47
  sites across nine view files. Obsidian's `activeDocument` /
  `activeWindow` globals correctly resolve to the popout window's
  document when one is focused; bare `document` always returns the
  main window. Behaviour is identical when no popout is open
  (which is the common case), but plugin UI created in a popout
  now wires up to the right document.
- **`globalThis` → `window`** for browser-API feature detection
  (`crypto.randomUUID`, `ClipboardItem`). These checks aren't
  popout-sensitive, so `window` is the right primitive.
- **`require()` → static `import`** in `filters.ts`. The lazy
  require was originally added to break a circular dependency
  with `contentParser` that no longer exists. Switching to static
  imports also eliminates the unsafe-`any` cascade that came from
  `require()` returning `any` — about 15 lint warnings cleared in
  one change.
- **`catch (e: any)` → `catch (e: unknown)`** with a small
  `errorMessage(e)` helper. Same Notice text reaches the user;
  the type is now correct.
- **Unnecessary type assertions removed** in three sites
  (`as HTMLElement | null` after `querySelector` — fixed by using
  `querySelector<HTMLElement>`).
- **Promise handling in event listeners** — `addEventListener`
  handlers that did async work used to be declared `async`, which
  returns a promise the listener API silently drops. Replaced with
  synchronous handlers that `void` the inner async call, making
  fire-and-forget intent explicit.
- **`Plugin.onunload`** is no longer `async` (body had no async
  work; matches the base-class signature).

### Removed
- Unused imports: `FilterCall`, `FilterValue` from `evaluator.ts`;
  `PreviewRegistry` from `inlineProcessor.ts`.
- Unused helper `folderOf` from `vaultIndex.ts`.
- Unused local `lineCount` in `tableAutocomplete.ts`.
- Stale `eslint-disable` comments that are no longer reachable
  after the `require()` → `import` change.

### Fixed
- Unnecessary escape characters in three regexes (`\/`, `\&`) and
  one markdown table (`\|` inside backtick code spans, where GFM
  treats inline code as opaque).

### Tests
- New `jest.setup.ts` polyfills `activeDocument` / `activeWindow`
  for jsdom-based view tests. Obsidian provides these globals at
  runtime; jsdom doesn't, and view code now touches them at module
  init. The setup file aliases them to regular `document` / `window`
  under jsdom, which matches Obsidian's behaviour when no popout
  is open. All 975 existing tests pass unchanged.

## 1.0.15

Compliance release addressing all errors flagged by the Obsidian
community plugin automated review of 1.0.14. The plugin was
delisted pending a passing review; this release fixes each error
individually. Warnings from the same review are left for a follow-
up release that doesn't block listing.

### Fixed (review compliance)
- **`revealLeaf` calls are now awaited.** `Workspace.revealLeaf`
  returns a `Promise<void>` in current Obsidian; we were calling
  it without `await`, which both triggered the unawaited-promise
  rule and meant code after the call could execute before the
  leaf was actually revealed. Now properly awaited in both
  `browserView` and `referenceView`.
- **Bumped minAppVersion from 1.4.0 to 1.7.2.** The async
  signature for `revealLeaf` requires the newer API; the lint
  rule was correctly flagging that our declared compatibility
  was older than what we actually use.
- **Replaced `innerHTML` parsing with `DOMParser`.** Two sites —
  `sanitiser.sanitiseHtmlToFragment` (HTML cleaning entrypoint)
  and `browserView.htmlToPlainText` (clipboard conversion). Both
  were already safe (detached documents, sanitised inputs), but
  `DOMParser` is the recommended pattern and doesn't trip the
  no-unsafe-innerHTML rule.
- **Replaced inline style with a CSS class.** The browser pane's
  click-to-copy cursor was set via `body.style.cursor = "pointer"`;
  now uses a new \`.randomness-clickable\` class in `styles.css`.
  Matches Obsidian's plugin guideline that styling lives in
  stylesheets, not JS.
- **eslint-disable directives now include justification text.**
  The single `eslint-disable-next-line` in `filters.ts` (lazy
  require to break a circular dep with `contentParser`) now
  explains why it's there. The `no-console` disable in
  `settings.ts` was removed entirely — the example-seeding
  diagnostics now surface in the user-facing Notice instead of
  the developer console.

### Note on warnings
The same review flagged ~80 warnings (unsafe-any in filters,
`globalThis` instead of `window`/`activeWindow`, `document`
instead of `activeDocument`, some unused imports). These don't
block listing but are real cleanup work; addressing them in a
follow-up release lets this compliance release ship quickly.

## 1.0.14

This is a substantial release covering real-world IPP3 compatibility,
better first-run setup, and a thorough reference-guide rewrite. Most
community generators that previously rendered empty or crashed should
now render correctly, and new users can get from "just installed" to
"rolling a working generator" in two clicks.

### Fixed (IPP3 compatibility)
Six independent fixes uncovered while loading real community
generators (`Dungeon_Room_Description.ipt` and
`Ultimate_Powers_Character_Generator.ipt`).

- **Variable names are now case-insensitive.** `{$Prompt1}`,
  `{$prompt1}`, and `{$PROMPT1}` all refer to the same value. IPP3
  is case-insensitive for variable names; we were storing prompts
  as lowercase and accidentally treating mixed-case references as
  unset (empty string). Affects user `Set:` variables too — `Set:
  Foo=x` followed by `{$foo}` now works.

- **Lookup tables without explicit `Roll:` now auto-infer.** IPP3
  authors commonly omit the `Roll:` directive on lookup tables;
  the engine is supposed to infer `1d<max-range>` from the items.
  We required explicit `Roll:` and returned empty otherwise.

- **`[[when]…[end]]` (outer-bracket-wrapped conditional) now
  evaluates.** When an IPP3 conditional is wrapped in an outer
  `[…]` (a common idiom in `Set:` values), the engine could
  either infinite-loop or render empty. The content parser now
  detects whether `[[…]]` is an Obsidian wiki-link or an IPP3
  wrapped expression by looking for structural markers (`[when]`,
  `[do]`, `[else]`, `[end]`, `[@`, `[#`, `[$`) inside the bracket
  pair. Wiki-links continue to pass through unchanged.

- **`&` line continuation now respects directive boundaries.** Per
  the IPP3 manual, `&` continuation is for *table item* lines.
  Some community files put `&` after a `Set:` directive too, which
  caused the engine to suck following body content into the Set's
  value and emit nothing. `Set:`, `Define:`, `Roll:`, `Type:`,
  `Table:`, `Use:`, `Prompt:`, and other directives now terminate
  at end-of-line; only item lines continue across `&`.

- **Arithmetic on variables now adds numerically.** When two
  variables hold numeric strings (the form `Set: A=5` produces),
  expressions like `{{$A}+{$B}}` now compute `8` rather than
  concatenating to `"53"`. Explicit string literals like `'5'+'3'`
  still concatenate, preserving documented behaviour.

- **Marker-form literal_bracket no longer infinite-recurses.**
  A defensive guard in the `literal_bracket` render path that
  previously triggered on any text starting with `[` now checks
  for exact marker text (`[when]`, `[when not]`, `[do]`, `[else]`,
  `[end]`), so genuine wrapped expressions re-parse correctly
  while stray markers emit as literal text.

### Fixed (UX)
- **Error messages in `.ipt` views are now readable.** The error
  bar was painted with red text on a red background, making the
  message invisible. The bar now uses the normal text colour
  against a muted background; the red is preserved on the left
  border and heading so it still reads as an error at a glance.

- **Missing-`Use:` errors are actionable.** Files that depend on
  `.ipt` files not in the vault now display a hint suggesting the
  user download the referenced file from the community pack, and
  noting that Randomness finds files by name anywhere in the
  vault.

- **The "red error" in the in-app reference guide is gone.**
  Five places in the reference used inline triple-backticks to
  represent a `randomness` codeblock visually. Obsidian's reader
  sometimes parsed those as actual fenced codeblocks with
  `randomness` as the language, which then triggered the
  plugin's codeblock processor to render an error *inside* the
  reference view. All five rewritten to use single-backtick
  inline code.

- **Reference guide syntax examples corrected throughout.**
  Several examples used outdated or wrong syntax: `[table]` for
  table calls (should be `[@table]`), `!set name=...` for
  variables (should be `Set: name=...`), `N[table]` for
  repetition (should be `[@N table]`), and
  `[when expr][do …][else …][end]` for conditionals (should be
  `[when]expr[do]…[else]…[end]`). All rewritten to match what
  the parser actually accepts.

### Added
- **Generator-root folder helpers in settings.** When the
  Generator root path is set but the folder doesn't exist yet,
  a **Create folder** button appears under it. Once the folder
  exists, an **Add examples** button writes five bundled
  example `.ipt` files plus a README into it. Makes first-time
  setup a two-click experience instead of "open file explorer,
  create folder, come back, type path".

- **Five bundled example generators** (`01-greetings.ipt` →
  `05-treasure-dictionary.ipt`) demonstrating the language
  features in progressive order — basics, sub-table composition,
  variables/prompts/dice/inline tables, lookup tables, and
  dictionary tables with conditionals. Each is heavily commented;
  they're meant as both runnable examples and a learning
  resource.

- **New reference-guide sections** for **Lookup tables**,
  **Dictionary tables**, **Prompts**, **Variable arithmetic**,
  and **Getting started** — each with multiple worked examples.
  Many additional examples added throughout existing sections.

### Tests
- Added 12 regression tests in
  `__tests__/integration/ipp3-compat.test.ts` covering each IPP3
  compatibility fix, plus 6 in
  `__tests__/integration/bundled-examples.test.ts` verifying every
  shipped example produces output. Total: 975 tests across 39
  suites, all green.

## 1.0.12

### Fixed
- **Dictionary keys with spaces or other punctuation now work in
  `api.roll`/`rollUnscoped` via `dictKey`.** 1.0.11 built
  `[#<key> <Table>]` expressions internally; that form whitespace-
  splits, so a key like `"Knight Bachelor"` was misparsed as key
  `Knight` against a non-existent table `Bachelor <Table>`. The API
  now looks the entry up directly via a new `Evaluator.runByKey`
  method, passing the key verbatim. Hyphenated, punctuated, and
  embedded-quote keys all resolve.

### Added
- **Quoted-key syntax for IPP3 dictionary lookups.** In a `.ipt`
  file, write `[#"key with spaces" Table]` to look up a dictionary
  entry whose key isn't a single bareword. Embedded double-quotes
  can be escaped: `[#"a \"b\" c" Table]`. Unquoted keys
  (`[#Plain Table]`, `[#Master-Adept Table]`, `[#{$var} Table]`)
  continue to work exactly as before — the quoted form is additive,
  not a syntax change. Reported by claudermilk while building an
  NPC generator driven by meta-bind dropdowns.
- **Community generators section in settings.** Two buttons: one
  opens the `community-generators/` folder on GitHub to browse
  contributions; the other opens a pre-filled GitHub issue for
  submitting your own. Contributions are stored in the repo and
  reviewed by maintainers before being added.
- **`API.md` recipe for storing roll results in frontmatter.**
  Documents the dataviewjs feedback loop that happens when render-
  time blocks write back to the same note, and shows two patterns
  to avoid it (seed off a stable value, or move writes out of the
  render path).

## 1.0.11

### Added
- **`dictKey` option for dictionary tables.** `roll()` and `rollUnscoped()`
  now accept a `dictKey` to look up an entry in a `Type: Dictionary`
  table — equivalent to the IPP3 `[#<key> <Table>]` pick syntax.
  Reported: calling `api.roll()` on a dictionary table silently returned
  an empty string because dictionaries aren't rolled randomly and
  `promptValues` doesn't address dictionary keys. The
  `rollExpression("[#<key> <Table>]")` form already worked and
  continues to; `dictKey` is the typed convenience for callers that
  have a key in hand (typically from frontmatter or a meta-bind input).
  Unknown keys return an empty string, matching IPP3's `[#bogus Table]`
  behaviour.

## 1.0.10

### Fixed
- **macOS Unicode (NFD/NFC) filename matching.** macOS filesystems
  store names in Unicode NFD (decomposed); a `Use:` reference typed or
  stored in NFC has different bytes for any accented/combining character
  even though it looks identical. The index and the file-source lookups
  now normalise both sides to NFC before comparing, so a reference
  matches its on-disk file regardless of composition form. (Pure-ASCII
  names are unaffected — NFC is a no-op there.)

## 1.0.9

### Changed
- **"Diagnose generator resolution" now dumps the raw folder listing.**
  The command prints every file in the active note's folder verbatim
  (quoted, so trailing spaces or control characters are visible) and
  unfiltered (so non-`.ipt` names show too), and compares the raw
  adapter listing against what Obsidian's `getFiles()` reports for the
  same folder. This pinpoints cases where a file renders in Obsidian's
  tree/embed but a `Use:` reference can't match it on disk — e.g. a
  hidden double extension (`portraits.ipt.txt`), a trailing space, or an
  odd Unicode form.

## 1.0.8

### Fixed
- **Legacy sub-path `Use:` references now resolve.** Community IPP3
  files (e.g. the NBOS corpora) reference imports with Windows
  backslashes, lowercase, and a folder layout that doesn't match the
  vault — for instance `Use: nbos\names\orc.ipt` when the real file is
  `…/Common/nbos/Names/Orc.ipt`. The index fallback previously fired
  only for bare filenames (no slashes), so these sub-path references
  failed even though the target file was indexed. The fallback now also
  handles slashed references: it matches on the basename and, when
  several files share it, prefers the one whose path ends with the
  reference's suffix (case-insensitively). Positional resolution still
  takes priority, so explicit relative/rooted paths are unaffected.

## 1.0.7

### Fixed
- **Disk-scan fallback now actually runs (root path convention).** The
  fallback that scans the vault on disk for `.ipt` files Obsidian hasn't
  indexed started its recursive walk at `"/"`, but Obsidian's adapter
  uses `""` for the vault root — so `adapter.list("/")` returned nothing
  useful and the whole scan silently found zero files (reported as
  `fromDiskScan: 0`). The walk now starts at `""` and descends properly,
  so a sibling `.ipt` that `getFiles()` omitted (the reported case:
  `portraits.ipt` next to its note, embeddable by Obsidian yet absent
  from the metadata index) is now discovered and indexed.

### Changed
- **"Diagnose generator resolution" now tests the adapter directly.** In
  addition to listing the index, it lists the active note's folder via a
  live `adapter.list` and attempts `adapter.read` on each `.ipt` there —
  so a report shows definitively whether a file is missing from the
  index vs. unreadable by the adapter.

## 1.0.6

### Added
- **"Diagnose generator resolution" command.** Lists every `.ipt` file
  the index currently holds (and the active note's folder-siblings) to
  the developer console, plus a notice with the count. Turns "why won't
  my `Use:` resolve?" from guesswork into a definitive check: if the
  file isn't in the list, it isn't indexed (check the generator-root
  setting and the `.ipt` extension); if it is, resolution should work.

## 1.0.5

### Fixed
- **Inline and codeblock `Use:` now consult the vault index.** Inline
  `rdm:` calls and `randomness` codeblocks resolved their `Use:`
  directives only positionally (caller dir, generator root, vault root)
  via the adapter — they never used the bare-filename index the way the
  public API and "Rebuild generator index" do. So a `Use: portraits.ipt`
  could fail in a note even when the file was a correct sibling and the
  index knew exactly where it was. All three paths (inline, codeblock,
  API) now share the same index-backed resolution, so a bare `Use:`
  resolves consistently everywhere. This was the remaining cause of the
  image-embed demo's "Use: target not found" after 1.0.2–1.0.4.

## 1.0.4

### Added
- **Index rebuild now reports what it found.** Running "Rebuild
  generator index" shows an Obsidian notice summarising the result
  (e.g. "index rebuilt — 23 generator files, 168 tables") and logs full
  detail to the developer console, including a count of files
  discovered only by the on-disk scan — i.e. files Obsidian hadn't
  indexed yet. That count is a quick diagnostic: non-zero means the
  disk-scan fallback (1.0.3) just caught files the metadata index
  missed.

## 1.0.3

### Fixed
- **Generator index now finds files Obsidian hasn't indexed.** The
  bare-filename resolver and the "Rebuild generator index" command both
  built their index purely from Obsidian's metadata index
  (`vault.getFiles()`), which omits `.ipt` files Obsidian hasn't
  registered yet — so a `Use: portraits.ipt` could fail to resolve, and
  rebuilding the index didn't help because it read from the same
  incomplete source. The index now *also* scans the vault on disk via
  the adapter, and reads unindexed files directly, so dropped-in `.ipt`
  files resolve (and "Rebuild generator index" genuinely picks them up).
- Builds on the 1.0.2 file-resolution fallbacks for the same root cause.

## 1.0.2

### Fixed
- **`Use:` target not found for files added outside Obsidian.** A `.ipt`
  file dropped into the vault via Finder/Explorer could fail to resolve
  from a `Use:` directive at every location, because file lookups went
  only through Obsidian's metadata index (`getFiles`), which doesn't
  include files Obsidian hasn't indexed yet. File resolution now falls
  back to a raw `adapter.list()` directory scan that reads the vault
  contents directly, catching unindexed files (and resolving them
  case-insensitively). Reported on macOS with `portraits.ipt`.
- **Clearer "not found" error.** When a `Use:` target can't be resolved,
  the error now points at the most common real cause — an unindexed
  file — and suggests reloading Obsidian or running "Rebuild generator
  index", instead of implying the path is wrong.

## 1.0.0

First stable release. Full implementation and documentation of the
public JavaScript API; the complete API surface (version `1.0.0`) is
implemented, covered by 64 dedicated tests, and documented in
[API.md](API.md). Ships with an expanded PF2e settlement generator
library.

This release marks the plugin as stable for general use. The API
surface is committed: breaking changes to it will bump the major
version.

**Thanks to [@pjjelly17](https://github.com/pjjelly17)**, whose PR #1
proposed the public JS API that this release builds on and documents.

### Added
- **`rollUnscoped(tableName, opts?)`** — roll a table found anywhere in
  the vault, ignoring note scope. Searches every `.ipt` file (under the
  generator root, if configured), loads the defining file plus its full
  `Use:` graph, and rolls. This is the method to use for note generation
  and automation, where no note scope is wired up. Accepts `seed`,
  `promptValues`, and `filePath` (to disambiguate name collisions).
- **Vault index** — basename and table-name index over the generator
  library, powering bare-filename `Use:` resolution and faster
  `rollUnscoped`. Invalidates on vault create/delete/r