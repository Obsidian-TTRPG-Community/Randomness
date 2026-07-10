# Changelog

All notable changes to the Randomness plugin.

## Unreleased

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

### Fixed
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
  `rollUnscoped`. Invalidates on vault create/delete/rename/modify.
- **"Rebuild generator index" command** — manual rescan of the
  generator library, as an escape hatch if the index looks stale.
- **Ambiguity warning** — when `rollUnscoped` finds multiple files
  defining the same table name, it logs a one-time console warning
  naming the colliding files and the one chosen, and points to the
  `filePath` option.
- **`promptValues` and `seed` wired through** the public roll methods to
  the engine (real prompt overrides and deterministic rolls, not no-ops).
- **`API.md`** — full reference for the public API: every method, the
  `RollResult`/`TableSource` shapes, scoped vs. unscoped guidance,
  prompts, collision handling, and recipes.

### Notes
- The public API surface version is `1.0.0`. The plugin version (this
  `1.0.0`) and the API version are tracked separately; read `api.version`
  for the latter.

### Fixed
- CSS lint: the broken-link style now uses a dashed `border-bottom`
  instead of an underline decoration, clearing the community-plugin
  linter's "partially supported on minAppVersion" warning. Identical
  visual result.

## 0.6.0
- Vault index for basename and table-name lookup.

## 0.5.x
- Public JS API introduced (`roll`, `rollExpression`, `tables`,
  `tablesWithSources`, `onRoll`, `version`), then `rollUnscoped` added.

## 0.4.4
- Community-plugin review fixes: replaced `builtin-modules` dependency
  with Node's `module.builtinModules`; CSS `text-decoration` shorthand
  split into longhand for Electron compatibility.
