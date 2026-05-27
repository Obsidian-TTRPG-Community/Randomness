# Randomness — v0.6.0 Status

## v0.6.0 — Vault index (reference by filename or table name)

Adds a vault-wide index so generators can be referenced by **bare
filename** or **table name** without managing full paths. Two maps,
built on load and kept fresh: `basename → path[]` and
`tableName → path[]`.

### What it enables

1. **Bare-filename `Use:` resolution.** A generator can now say
   `use: Names.ipt` (no path) and the helper is found wherever it
   lives in the vault. Verified end-to-end: a shop file in
   `Generators/shops/` importing `Names.ipt` resolves a helper in
   `Generators/common/`.
2. **Faster `rollUnscoped`.** Table-name lookup now hits the cached
   index instead of re-scanning the vault on every call (falls back
   to a fresh scan if the index is unavailable or stale).

### Scope

Indexes `.ipt` files under the Generator Root if one is set,
otherwise the whole vault — matching `discoverGenerators` and the
"one parent folder, organise freely inside" model.

### Collisions

When a bare name maps to multiple files, resolution:
- prefers a file in/under the caller's folder (so a sibling wins);
- otherwise takes the first by sorted path;
- and emits a **one-time console warning** naming the ambiguity so
  the user can disambiguate with a full path if it matters.

This is the design the user chose ("warn but proceed with first
match") for cases like their two `AdventureHooks.ipt` files.

### Freshness

The index invalidates on vault `create` / `delete` / `rename` /
`modify` of any `.ipt` (rescan deferred to the next lookup — cheap
invalidate, lazy rebuild). A **"Rebuild generator index"** command
is the escape hatch for a rare missed event (e.g. a file dropped in
by sync while Obsidian was closed).

### Additive by design — existing resolution unchanged

The index is a **step-5 fallback** in both `resolveUsePath` (sync)
and the prefetcher's `resolveAsync` (async mirror). It fires ONLY
when:
- the four positional steps (caller dir → root/Common → root → as-is)
  all fail, AND
- the ref is a bare filename (no `/`), AND
- a `basenameResolver` was supplied.

So every existing generator resolves exactly as before; explicit
relative and rooted paths always win over the index. Confirmed by a
test asserting positional resolution beats an index that points
elsewhere.

### Implementation

**New:** `src/resolver/vaultIndex.ts` — the `VaultIndex` class
(scan, two maps, collision rule, invalidate, prewarm, rebuild).
Pure of Obsidian types (takes a minimal `IndexVault`), so it's unit
testable; the plugin supplies a vault-backed adapter.

**Modified:**
- `src/resolver/fileResolver.ts` — `ResolveOptions.basenameResolver`
  (optional callback) + step 5 in `resolveUsePath`. Flows through
  `resolveBundle`'s recursion via `...opts`.
- `src/resolver/asyncPrefetcher.ts` — `PrefetchOptions.basenameResolver`
  + step 5 in `resolveAsync`, so prefetch discovers the same
  bare-filename targets the sync resolver will.
- `src/views/main.ts` — instantiates `VaultIndex` (reads via
  `cachedRead`, scoped by generator root), registers the four vault
  event listeners to invalidate, adds the "Rebuild generator index"
  command.
- `src/api/index.ts` — `rollUnscoped` uses the index for table
  lookup (with discovery fallback) and passes `basenameResolver`
  into prefetch + resolve. `opts.filePath` now used directly as the
  target path.

### Test coverage

**16 new tests:**
- `__tests__/resolver/vaultIndex.test.ts` (14): basename lookup
  (unique, case-insensitive, missing), collisions (nearest-folder
  preference, first-by-path + one-time warning), table lookup
  (unique, ambiguous-sorted, parse-error-still-basename-indexed),
  scope (root-only), invalidation (rebuild picks up new files), and
  the four resolveUsePath step-5 guarantees (fallback only after
  positional fail, positional wins, no-fire-on-slash, verifies
  existence).
- `__tests__/api/bareFilenameUse.test.ts` (2): end-to-end
  bare-filename `use:` across folders, with and without a generator
  root.

### Test count

**853 tests across 30 suites** (+16 since v0.5.1). All green.

### Not done this release (deliberate)

Autocomplete still uses its own out-of-scope discovery cache rather
than the shared index. It already surfaces vault-wide tables, so
this is a consistency/perf consolidation, not a capability gap —
deferred to avoid churning a working feature. Future: point
autocomplete at `vaultIndex` too.

---

# Randomness — v0.5.1 Status

## v0.5.1 — `rollUnscoped` (vault-wide roll)

Adds `api.rollUnscoped(tableName, opts?)` — roll a table found
anywhere in the vault, ignoring note scope.

### Why

v0.5.0's `roll()` resolves tables through the *calling note's
scope* (its codeblocks + `Use:` imports). That's correct for
in-note rolls but fails for the primary scripting use case:
a template generating a note from a shared generator library.
Two compounding reasons it failed:

1. **No scope at creation time.** A note being created by
   Templater doesn't exist on disk yet, so it has no scope —
   `roll("X")` finds nothing.
2. **`roll()` can't read a bare `.ipt` as scope even if pointed
   at one.** The inline-scope path (`buildInlineBundle`) extracts
   tables from markdown ` ```randomness ` codeblocks. A plain
   `.ipt` file has no codeblocks, so its top-level `Table:`
   definitions are invisible to that path. Pointing
   `callerNotePath` at the `.ipt` doesn't help.

A real user hit this immediately: a `.ipt` with
`Table: AdventureHooks` (which calls `[@MasterAdventureHooks]`
via a `use:` line) returned "Unknown table: AdventureHooks" from
`roll()`, because the file's tables never entered scope.

### What rollUnscoped does

Bypasses the inline-scope machinery entirely and uses the real
file resolver:

1. Scans the vault via `discoverGenerators` (respecting generator
   root) to find which `.ipt` defines the requested table. First
   match by path wins; `opts.filePath` pins a specific file when
   names collide.
2. Reads that file, prefetches its `Use:` graph (so master/
   imported files load), and resolves the bundle through
   `resolveBundle` — which parses `.ipt` top-level `Table:`
   definitions AND walks `use:` correctly.
3. Rolls the table by name with `Evaluator.runByName`.

Same `RollResult` shape, same `onRoll` event emission (success
and failure), same `seed`/`promptValues` support as `roll`.

### Recommended usage for template generation

```js
const api = app.plugins.plugins["randomness"].api;
const shop = await api.rollUnscoped("ShopName");
const owner = await api.rollUnscoped("ShopkeeperNPC");
tR += `# ${shop.result}\n\nProprietor: ${owner.result}`;
```

No scope wiring, no `Use:` line in the template, no scope-hub
note. The generator just needs to exist as an `.ipt` somewhere in
the vault (under the generator root if one is configured).

### Implementation

**Modified:** `src/api/index.ts` — added `UnscopedRollOptions`
type, `rollUnscoped` to the interface + implementation, exported
it on the API object. Imports `resolveBundle` + `dirname` from
the file resolver and `Evaluator` from the engine. No changes to
engine, resolver, or other views.

**Disambiguation:** when two files define the same table name,
first-by-path wins unless `opts.filePath` is given. Documented.

### Test coverage

**6 new tests** in the API suite:

- Documents that scoped `roll()` still can't reach a bare `.ipt`
  table (pins the gap rollUnscoped fills).
- Finds a table anywhere in the vault and follows `use:`
  (the user's exact AdventureHooks → MasterAdventureHooks case).
- Rejects a genuinely missing table.
- Seed makes an unscoped roll deterministic.
- `filePath` disambiguates same-named tables across files.
- Fires `onRoll` on unscoped success and failure.

### Test count

**826 tests across 26 suites** (+6 since v0.5.0). All green.

### Reference updated

The "Scripting API" section now documents `rollUnscoped` and the
Templater example uses it (the correct call for template
generation, since a new note has no scope).

---

# Randomness — v0.5.0 Status

## v0.5.0 — Public scripting API

A public JS API at `app.plugins.plugins["randomness"].api` for
other plugins, Templater scripts, and DataviewJS to roll tables
programmatically. The primary motivating use case: generating
notes from templates where the rolled values are written as
static text (so the finished note doesn't re-roll on every open).

### Provenance

The API surface (`roll` / `rollExpression` / `tables` /
`tablesWithSources` / `onRoll`) follows the design proposed by
@pjjelly17 in PR #1. Rather than merge that PR (which had a
build-breaking typecheck error in its test mocks, and left
`seed`/`promptValues` as documented no-ops), the design was taken
as a spec and built directly into core so it composes with the
upcoming bake-to-static feature and wires the options through
properly. Credit to @pjjelly17 for the surface design.

### Surface

Exposed at `app.plugins.plugins["randomness"].api`:

- `roll(tableName, opts?)` → `Promise<RollResult>` — roll a named
  table (wrapped internally as `[@tableName]`).
- `rollExpression(rawExpr, opts?)` → `Promise<RollResult>` — roll
  an arbitrary expression.
- `tables(callerNotePath?)` → `Promise<string[]>` — table names
  visible from a note, deduped + sorted.
- `tablesWithSources(callerNotePath?)` → `Promise<TableSource[]>`
  — tables with source paths, in-scope first then vault-wide.
- `onRoll(cb)` → `() => void` — subscribe to every roll attempt
  (success and failure); returns an unsubscribe function.
- `version` — semver of the API surface (`API_VERSION`),
  independent of the plugin version.

`RollResult` = `{ result, table, expression, source?, error?,
timestamp, rollId }`. On failure the call rejects AND a failure
event is emitted to `onRoll` subscribers (so a subscriber sees
the full stream), with `error` set and `result` carrying a
visible `[ROLL ERROR: ...]` marker.

`RollOptions` = `{ callerNotePath?, seed?, promptValues? }`.

### Differences from PR #1 (improvements)

- **`seed` is wired through, not a no-op.** Added an optional
  `opts` param to `evaluateInlineExpression` that threads `seed`
  and `promptValues` into the Evaluator's options. Same seed +
  same expression + same scope → same result. This is a real
  determinism guarantee, tested.
- **`promptValues` is wired through** the same way (it was
  already a first-class `EvaluatorOptions` field).
- **Build is green.** PR #1's test file had two incomplete mock
  casts that failed `tsc` (and therefore `npm run build`, since
  tsconfig includes the test tree). The core-built version has
  no such issue.
- **`rollId` has a fallback** for runtimes without
  `crypto.randomUUID` (very old environments) — still
  unique-enough for dedup.

### Implementation notes

**New file:** `src/api/index.ts` (~330 lines incl. JSDoc + types).
Thin orchestration layer over existing internals: wraps
`evaluateInlineExpression`, `prefetchUseGraph`, `buildInlineBundle`,
`collectTablesFromBundle`, `discoverGenerators`,
`vaultFileSource`. No new evaluation logic.

**Modified:** `src/views/inlineProcessor.ts` — added optional
`opts?: { seed?, promptValues? }` param to
`evaluateInlineExpression`, threaded into the Evaluator. Backward-
compatible (omitting opts preserves prior random-seed behaviour);
the in-render path passes nothing.

**Modified:** `src/views/main.ts` — `api` field + `this.api =
createApi(this)` in onload (one import, field, one line).

**Scope isolation:** `tablesWithSources` isolates in-scope
resolution from vault-wide discovery — if one throws, the other
still returns, so consumers get a partial-but-useful answer.

### Test coverage

**21 tests** in `__tests__/api/index.test.ts`, run against a real
in-memory vault (real engine + resolver, not mocked internals):

- `version` (2) — API_VERSION exposed + semver shape.
- `roll` (7) — populated result shape, `[@name]` wrapping,
  **seed determinism**, seed influences output, active-note
  fallback, unknown-table rejection, unique rollIds.
- `rollExpression` (2) — arbitrary expression eval, bad-expression
  rejection.
- `tables` (2) — in-scope deduped+sorted, includes out-of-scope.
- `tablesWithSources` (3) — in-scope-first ordering, out-of-scope
  filePath carried, no in-scope/out-of-scope duplication.
- `onRoll` (5) — fires on success, fires on failure with error
  set, unsubscribe stops delivery, multi-listener delivery,
  throwing-listener isolation.

Fewer tests than PR #1's 29 because these exercise real
end-to-end evaluation rather than mocking each internal — broader
actual coverage per test, and they can test seed determinism
(which the mock-based version couldn't).

### Reference updated

New "Scripting API" section in the in-app reference with a
Templater example and the full method/option list. Pinned as a
required section in the reference smoke test.

### Test count

**820 tests across 26 suites** (+21 since v0.4.4). All green.

### Follow-ups queued

- **Bake-to-static** (`api.bakeNote()` + a "Bake all rolls in
  current note" command) — next release. For users hand-authoring
  notes with live refs who want to freeze them. The Templater
  roll-and-splice path above already covers the
  template-generation use case without it.
- **Quick-roll command palette** — offered to @pjjelly17 as a
  follow-up contribution; sits on top of this API.

---

# Randomness — v0.4.4 Status

## v0.4.4 — Auto-add `Use:` on out-of-scope autocomplete pick

v0.4.3's out-of-scope autocomplete was an honest-but-incomplete
fix: the user could find any table in their vault, but picking
one resulted in "Unknown table: X" errors until they manually
added a `Use:` line. The Notice told them what to add; they
still had to do plumbing.

v0.4.4 closes the gap: picking an out-of-scope table auto-adds
the `Use:` line.

### Behaviour

When the user picks an out-of-scope table from the autocomplete:

1. The table name is inserted as before (`rdm:[@TableName]`).
2. The plugin scans the note for an existing `\`\`\`randomness\`\`\``
   codeblock.
3. **If found:** insert `Use: <path>` into that codeblock, right
   after any existing `Use:` lines and before any expressions.
4. **If not found:** create a new codeblock at the top of the
   note (after frontmatter if present), containing just
   `Use: <path>`.
5. Both edits go through `editor.replaceRange` — same undo group
   as the inline insert, so one `Ctrl-Z` reverts everything.
6. Cursor adjusted for any lines added above the inline call's
   position.
7. Per-note table cache invalidated so the next autocomplete
   trigger sees the file as in-scope.

### Why auto-add, reversing the v0.4.3 decision

v0.4.3 chose the conservative path: surface a Notice with the
exact `Use:` line and let the user paste it. The reasoning was
"auto-editing note structure is surprising."

That reasoning was wrong. The plugin is allowed to edit
codeblocks it owns — the user just told it "I want to use this
table" by selecting it from the popup. Adding the line that
makes that selection work is the most direct response to the
action. The alternative (Notice + paste) imposes per-pick
friction for a non-problem.

The edit is bounded, traceable, and undoable. The user always
sees the new line in their note; if it's not what they wanted,
`Ctrl-Z` removes it along with the inline call. There's no
silent magic.

### Edge cases handled

- **Idempotent.** If the `Use:` line is already present (stale
  cache, manual addition, race), the operation is a no-op. No
  duplicate lines.

- **Insertion point in existing codeblocks.** New `Use:` lines
  cluster with existing ones — appended after the last existing
  `Use:` line, before any expressions or other content. Keeps
  the codeblock readable.

- **Frontmatter respected.** When creating a new codeblock,
  it's inserted AFTER the closing `---` of a YAML frontmatter
  block, not before. The note's metadata stays at the top.

- **Cursor position.** If the auto-added codeblock is above the
  inline call, the cursor shifts down by the number of lines
  added (4 for a fresh codeblock: opening fence, `Use:` line,
  closing fence, blank separator). If the codeblock is below
  the cursor (rare — happens only when the cursor is mid-page
  and the existing codeblock is later), no adjustment needed.

- **Empty-output codeblock is acceptable.** A codeblock with
  only `Use:` lines and no expression renders as an empty box.
  Not pretty but not broken — it's serving as a scope
  declaration for the inline calls. Future polish: render a
  placeholder like "(scope import — used by inline rdm: calls)"
  when the codeblock has no expression.

### Test coverage

**12 new tests** total: 5 for the auto-insert behaviour
(creates new codeblock when none exists, adds to existing
codeblock, no-op when already present, no modification on
in-scope pick, ordering of Use: lines within a codeblock),
5 for the new helper `findFirstRandomnessCodeblock`
(handles no-block / non-randomness / simple / multiple-blocks /
trailing-whitespace cases), and 4 for `findFrontmatterEnd`
(none / present / not-at-line-0 / unterminated).

`MockEditor` upgraded: added `lineCount()` method, replaced
single-line `replaceRange` with a generic merge-and-split
implementation that handles multi-line insertions (the new
codeblock case).

### Test count

**799 tests across 25 suites** (+12 since v0.4.3). All green.

### Reference updated

The in-app reference's autocomplete section now describes the
auto-import behaviour instead of the Notice-only behaviour.

---

# Randomness — v0.4.3 Status

## v0.4.3 — Out-of-scope autocomplete suggestions

The v0.4.2 autocomplete only suggested tables in the current
note's runtime scope (the codeblock + its `Use:` imports). This
was correct but unhelpful for users who hadn't yet added a
`Use:` to bring their generators into scope — they'd open a
fresh note, type `\`rdm:[@\`, and see only whatever tables they
had defined in this note's own codeblocks. The plugin's actual
generator library, sitting in their vault, was invisible.

### What changed

The popup now shows two groups:

1. **In-scope tables** — same as before, at the top, normally styled.
2. **Out-of-scope tables** — every other `.ipt` table in the
   vault, rendered with muted italic styling and a "(not
   imported)" prefix on the source subtitle.

Both groups are filterable by the same query. Limit is shared
(default 50 total) with in-scope getting priority — large vaults
with hundreds of out-of-scope matches can't crowd out the
user's actual usable suggestions.

Selecting an out-of-scope table:
- Inserts the table name as usual.
- Surfaces a `Notice` showing the exact `Use: <file>` line the
  user needs to add to a `\`\`\`randomness\`\`\`` codeblock in their
  note.

The plugin doesn't auto-edit the note structure. Considered
"prepend a codeblock automatically" but ruled out — silently
restructuring notes based on autocomplete picks is too
surprising for a passive feature. The Notice gives the user
the exact text to paste, and they choose where it goes.

### Caching strategy

Vault-wide table discovery walks every `.ipt` file in the
configured generator root (or the whole vault). Cached for the
plugin's lifetime in a single slot on the `TableAutocomplete`
instance; invalidated by `clearCache()` alongside the
per-note cache. Tradeoff: if the user adds a new `.ipt` after
the cache is built, it won't appear until clearCache fires.
Acceptable — adding generators is rare; reading every file on
every keystroke is intolerable.

### Visual treatment

CSS adds `.randomness-suggest-out-of-scope` modifier that
mutes the name (italic, muted colour) and the subtitle
(faint colour). The "(not imported)" prefix in the subtitle
makes the gating explicit without requiring a separator row in
the popup.

### Test coverage

**6 new tests:**

- Out-of-scope tables appear AFTER in-scope ones (ordering).
- Out-of-scope suggestions carry the source file path.
- A table that's in-scope doesn't also appear as out-of-scope
  (no duplicates).
- Filter applies to both lists.
- `selectSuggestion` on out-of-scope shows a Notice AND still
  inserts the name.
- `selectSuggestion` on in-scope does NOT show a Notice.

The Notice test uses `jest.spyOn(ac, "showImportHint")` rather
than trying to replace the global `Notice` constructor — the
module-replacement approach was fragile across the
test-module boundary (each module captures its import at load
time, so post-import replacement is too late). Direct method
spying is cleaner.

**787 tests across 25 suites** (+6 since v0.4.2). All green.

### Reference updated

The in-app reference's "Table-name autocomplete" section now
explains the in-scope vs out-of-scope distinction and the
Notice that surfaces on out-of-scope picks.

---

# Randomness — v0.4.2 Status

## v0.4.2 — Table-name autocomplete

Typing \`rdm:[@\`, \`rdm:[#\`, or \`rdm:[!\` inside an inline code
span now opens a native Obsidian suggestion popup listing every
table visible in the current note's scope. The list filters as
the user types — case-insensitive substring match, so \`name\`
finds both \`FirstName\` and \`LastName\`. Picking an entry
inserts the table name, appends \`]\` if there isn't one already,
and moves the cursor past it.

### Design notes

- **Built on Obsidian's `EditorSuggest<T>`** rather than a custom
  popup. Keyboard navigation, theming, mobile, escape-to-dismiss,
  scroll, accessibility — all inherited from the platform. Looks
  and feels identical to the user's other autocompletes (wiki-link,
  tag, slash command, etc.).
- **Triggers on `[@` / `[#` / `[!`** — the three inline call
  shapes that take a table name. Bare `[Table]` is also valid
  IPP3 syntax but collides too easily with literal `[bracket text]`
  to trigger reliably without false positives; users wanting it
  can add the `@` for the same effect.
- **Trigger regex is anchored to the cursor** and bounded by the
  enclosing inline code span (`backticks`). Doesn't fire in plain
  prose that happens to mention the syntax. Doesn't fire if the
  bracket is already closed.
- **Suggestion source = note's actual runtime scope.** Same
  `prefetchUseGraph` → `buildInlineBundle` pipeline as the inline
  processor. Out-of-scope tables in the vault are NOT suggested;
  autocomplete that lied about availability would be worse than
  honest emptiness.
- **Two-row layout per suggestion:** table name (with `★` for
  the file's main table) + muted subtitle showing source file.
  Lets users disambiguate identically-named tables from different
  imports at a glance.
- **Insertion behaviour:** appends `]` only if one isn't already
  there. So re-triggering on an existing call (e.g. selecting
  \`TableName\` in \`rdm:[@TableName]\` to replace) doesn't
  produce \`rdm:[@NewName]]\`.
- **Per-note cache** keyed on FNV-1a of the note source. First
  trigger in a note kicks off the async resolve; subsequent
  triggers reuse the cached list until the note's content changes.
  Cache cleared via `plugin.tableAutocomplete.clearCache()` for
  future settings-change wiring.
- **First-declared wins on name collision.** If two imported
  files both declare a \`names\` table, only the first is
  suggested. Matches the Evaluator's lookup order so the
  autocomplete predicts what the engine will actually roll.

### What it doesn't do (v1 scope)

- **No suggestions inside `randomness` codeblocks.** The editor's
  cursor position doesn't directly expose whether you're inside
  a fenced block; you'd need a document-level scan to find an
  open fence above the cursor. Tractable but deferred.
- **No "show me all generators in the vault" mode.** If the user
  hasn't imported a file via a codeblock `Use:` directive, its
  tables don't appear. This is honest — the engine wouldn't be
  able to roll them either. Future: add an "out of scope, click
  to import" greyed-out section to soften the discovery cliff.

### Test coverage

- **9 trigger-regex tests:** positive cases for `@`/`#`/`!`,
  negatives for missing backtick / closed bracket / closed code
  span / plain prose / end-anchoring.
- **6 bundle-to-suggestions tests:** per-file source labels,
  main-table flag, case-insensitive deduplication, "(this note)"
  labelling for the in-note virtual file, empty extras.
- **3 trigger-detection integration tests:** fires inside `rdm:[@`,
  null outside any span, start position right after the trigger char.
- **6 getSuggestions tests:** in-note codeblock tables + Use:'d
  files both visible, query filtering (case-insensitive), substring
  match (`name` matches both First/LastName), empty-scope case,
  cache hit on repeated calls, clearCache invalidation.
- **3 selectSuggestion tests:** basic insert + bracket append,
  no double-close when `]` already follows the trigger range,
  cursor lands past the closer.

### Mock additions

`__mocks__/obsidian.ts`: `EditorSuggest<T>` abstract base with
`open()` / `close()` no-ops, `EditorSuggestTriggerInfo` and
`EditorSuggestContext` interfaces, `EditorPosition` interface,
abstract `Editor` class declaring the methods our code reads
(`getLine`, `getCursor`, `setCursor`, `replaceRange`), concrete
`MockEditor` subclass for tests that holds an array of lines +
cursor and implements a single-line `replaceRange`,
`registerEditorSuggest` no-op on `Plugin`.

### Reference content updated

The in-app reference (Settings → Open reference) now has a
"Table-name autocomplete" section covering the trigger
patterns, filtering behaviour, and the in-scope-only rule.
Pinned as a required section in the reference smoke test.

### Test count

**781 tests across 25 suites** (+27 since v0.4.1). All green.

---

# Randomness — v0.4.1 Status

## v0.4.1 — In-app reference

A read-only reference pane covering the table-authoring syntax,
accessible from inside the plugin without alt-tabbing to GitHub.

### Access points

Two discoverable ways to open it:

- **Settings tab** has an "Open reference" button at the very top
  — placed first so it's the first thing users see when they go
  looking for help.
- **Command palette** entry: "Randomness: Open reference".

The view opens in a vertical split next to the active editor by
default (the side-by-side layout that's most useful while
authoring a table). Opening it a second time reveals the existing
leaf rather than spawning a duplicate.

### Content

About 250 lines of markdown covering: file structure (Title /
Table / Use directives), table items and how they're sampled,
the bracket-call variants (`[@T]`, `[#n T]`, `[#<key> T]`,
`[!T]`, `[|inline|table]`), dice expressions, variables (`{var}`,
legacy `{$var}`), filters and the `>>` syntax, repetitions and
`MaxReps:`, conditionals (`[when][do][else][end]`), the v0.4.0
Obsidian wiki-syntax for images and links, how inline `rdm:`
calls inherit scope from same-note codeblocks (with the
explicit gotcha that they don't accept their own `Use:`
directive), escaping, the browser pane, and the settings.

### How it's wired

- Content lives as a TypeScript string constant
  (`src/views/referenceContent.ts`) so it bundles into
  `main.js`. No external file to ship, no risk of the help
  text drifting out of sync with the version it was written
  against, easy to test (a smoke test verifies every required
  section heading is still present).
- View extends `ItemView` and renders the content through
  Obsidian's own `MarkdownRenderer.render` — links, code
  blocks, and theme styling all work natively.
- Code examples in the reference use fenced \`\`\`text blocks,
  NOT \`\`\`randomness blocks. If the reference used the latter,
  the codeblock processor would try to ROLL each example,
  which would be confusing at best and crash at worst. A test
  pins this — no \`\`\`randomness fences allowed in the
  reference content.

### Test coverage

- **6 content smoke tests**: non-empty, top-level heading
  present, all major sections present, mentions `rdm:` syntax,
  documents wiki-link rendering, calls out the inline-scope
  gotcha, no `\`\`\`randomness` fences sneak in.
- **5 view tests**: `getViewType` / `getDisplayText` / `getIcon`
  return expected values, view type string is stable
  (changing it would orphan saved leaves), `onOpen` renders
  content into the right DOM element, wraps content in the
  expected wrapper class.
- **2 opener tests**: reuses existing leaf when one is open,
  creates a new leaf when none exists.

### Mock additions

`__mocks__/obsidian.ts`: added `MarkdownRenderer` class with
mock `render` / `renderMarkdown` methods, added
`ButtonComponent` class with `setButtonText` / `setCta` /
`onClick`, added `addButton` to the `Setting` mock.

### Test count

**754 tests across 24 suites** (+13 since v0.4.0). All green.
Build 79KB minified (+10KB from the reference text — most of
the increase is the markdown constant).

---

# Randomness — v0.4.0 Status

## v0.4.0 — Obsidian wiki-syntax rendering

Generators can now emit Obsidian wiki-syntax (`![[image.png]]`,
`[[note name]]`, `[[note#heading|display text]]`) and have it
render natively — as actual images and clickable internal links —
everywhere results appear: codeblock outputs, inline `rdm:` calls,
the `.ipt` file viewer, and the browser pane's roll-result panel.

### Why this is useful

The motivating example: a portraits table.

```
Table: monster_portrait
![[goblin1.png]]
![[goblin2.png]]
![[orc1.png]]
![[orc2.png]]
```

Rolling on that now displays an actual image of the picked
portrait, not the literal text `![[goblin1.png]]`. Similarly
for note links — a treasure table can output
`[[Magical Items#Cursed]]` and clicking it opens the note at
that heading.

### Supported syntax

- `![[image.png]]` — embed an image (extensions: png, jpg, jpeg,
  gif, webp, svg, bmp, avif)
- `![[image.png|200]]` — embed with a pixel width (digits-only
  pipe arg)
- `![[image.png|alt text]]` — embed with alt text (non-numeric
  pipe arg)
- `[[Note]]` — link to a note
- `[[Note#Heading]]` — link to a specific heading
- `[[Note|click here]]` — link with custom display text
- Click opens in the current pane; Ctrl/Cmd-click opens in a new
  pane (standard Obsidian convention)

### What about dynamic content?

The engine still evaluates `{var}` expressions inside wiki-syntax,
so `![[ {filename} ]]` works — the variable resolves first, then
the resulting text gets rewritten into an `<img>`. Same for
`[[ {target_note} ]]`. This means a generator can pick a value
and embed/link based on it without any new syntax.

### Out of scope (deliberately)

- **Note embeds** like `![[Some Note]]` that would inline the
  note's content. Substantial feature, deferred.
- **Audio/video/PDF embeds**. The first non-image embed support
  request will tell us which formats to add.
- **Unresolved links** render as a styled span (muted, dashed
  underline) matching Obsidian's own affordance — they don't
  silently disappear.

### How it works (security-conscious)

Two layers of separation kept the implementation safe:

**Layer 1 — engine pass-through.** A new check at the content
parser's top-level scanner: when it sees `[[`, it emits the
opener as literal text and steps past it instead of recursing
into `parseBracket`. The inner content continues through the
normal parse loop (so `{var}` substitution works) and the
closing `]]` survives because bare `]` outside any bracket
context is already plain text in IPP3. This means engine output
preserves `[[…]]` verbatim — without it, IPP3's `[expr]` bracket
syntax would eat the wiki brackets and turn `![[image.png]]`
into `!image.png`.

**Layer 2 — post-sanitiser interpolation.** A new helper module
`src/views/obsidianLinks.ts` walks the sanitised DocumentFragment,
finds wiki-syntax in text nodes, and splices in freshly-constructed
`<img>` and `<a>` elements at the matched positions. The
sanitiser still strips ALL attributes from every tag — unchanged.
The image and link elements are built programmatically with
attribute values from vault APIs (`vault.getResourcePath(file)`,
`workspace.openLinkText` for click handlers), never from raw
text. There's no path for an attacker-controlled `src="javascript:…"`
or tracking-pixel URL to land in the DOM.

The wiki-syntax interpolator skips `<code>` and `<pre>` subtrees,
so generators that document wiki-syntax in literal code blocks
(e.g. a help-text generator) don't get their examples rewritten.

### Engine semantics worth knowing

The collision with IPP3's `[…]` syntax was the biggest design
question. Before adding the `[[`-pass-through, the engine
mangled `![[dragon.png]]` to `!dragon.png` because it parsed
the outer brackets as a literal-bracket-containing-inner-bracket.
After the fix, `[[` is a recognised opener that produces literal
text — no AST node type changes, no evaluator changes. The IPP3
spec doesn't use `[[` for anything, so the new behaviour is
strictly additive.

### Tests

**735 tests across 22 suites.** +47 since v0.3.1:

- **38 unit tests** in `obsidianLinks.test.ts` — parser variants
  (heading, display, pipe-width, pipe-alt, malformed), extension
  parsing, image-vs-link decision, DOM-level fragment mutation
  (image src/width/alt/default-to-filename, unresolved fallback,
  non-image fallback to link), link behaviour (data-href, is-
  unresolved class, click → openLinkText, Ctrl+click → new
  leaf), multi-pattern interpolation, edge cases (no wiki-syntax
  untouched, code/pre skipped, works inside formatting tags,
  missing metadataCache graceful, malformed `[[]]` literal,
  adjacent embeds).
- **6 engine tests** in `contentParser.test.ts` — `[[note]]`
  passes through as literal, `![[image.png]]` passes through,
  surrounding text preserved, `{var}` inside wiki-syntax still
  evaluates, single-bracket calls unaffected, adjacent embeds
  parse independently.
- **3 integration tests** in `browserView.test.ts` — roll
  result panel renders `![[image.png]]` as `<img>` with the
  correct src, renders `[[Note]]` as a clickable `<a>` that
  fires `openLinkText` with the generator's path as sourcePath,
  preserves wiki-syntax around other content.

**Mock additions** in `__mocks__/obsidian.ts`: `MetadataCache`
class with `getFirstLinkpathDest`, `getResourcePath` method on
`Vault`, `openLinkText` method on `Workspace`, `metadataCache`
field on `App`.

---

# Randomness — v0.3.1 Status

## v0.3.1 — Inline-call identity fix

**Bug** (from user screenshot): three identical inline `rdm:[@T]`
calls displayed in a row. User sets each to a unique value, then
clicks Lock on the bottom one. Result: the TOP call gets the
bottom call's value, the bottom stays unfilled.

**Root cause — two compounding issues:**

1. **DOM-based occurrence counting collapsed to 0 for every call.**
   The old `countPriorOccurrences` walked `body.querySelectorAll("code")`
   to count prior identical calls — but by the time the second call
   was being processed, the first call's `<code>` element had already
   been replaced by a `<span>` (no longer matched by the selector).
   Every call computed occurrence=0 and they all collided on one
   preview cache slot. That's why the three calls all *displayed*
   the same value — they were reading from one shared cache entry.

2. **Lock target was always "first unfilled occurrence".** `lockCall`
   called `findFirstUnfilledOccurrence(source, expr)` which returned
   the top call's position regardless of which Lock button the user
   clicked. So the top got the lock with whatever value was in the
   (single, collapsed) preview cache slot.

**Fix:** the post-processor now reads the note source once per
block, enumerates every `rdm:` call with its source-level occurrence
index via the new `findAllInlineCallPositions` helper, and aligns
each rendered DOM element to its source position by matching
expressions in document order within the block's line range.
`lockCall`, `lockWithResult`, and `rerollCall` all take an
explicit `occurrence` parameter and pass it through to
`applyLockToSource` / `applyUnlockToSource`, which already used
the same occurrence-indexing scheme. The "first unfilled" and
"first locked" search heuristics are removed entirely.

Why source-level rather than DOM-level indexing: source positions
are stable across Obsidian's incremental rendering, the same
numbering scheme is used by `transformNthMatch` for actually
writing the file, and the source is the only place we can
distinguish identical calls reliably (the rendered DOM mutates
during post-processing).

**Trade-off acknowledged:** reading the source on every
post-processor invocation adds one async vault read per rendered
block. Negligible — vault reads are cached by Obsidian — but
non-zero. Worth it for correctness.

### Tests

- 8 new unit tests for `findAllInlineCallPositions`: source-order
  enumeration, per-expression occurrence counting, multi-line
  layouts, mixed locked/unfilled, locked-value preservation,
  non-rdm code spans ignored, empty source, offset placement.
- 5 new integration tests in `inlineProcessor.test.ts`: distinct
  cache entries per occurrence, click Lock on bottom→bottom locked,
  click Lock on middle→middle locked, click Reroll-unlock on
  bottom→bottom unlocked, separate preview values for distinct
  occurrences.

**Test count: 688** (+13 from 0.3.0). All green.

---

# Randomness — v0.3.0 Status

## v0.3.0 — Pinned favourites + visual rep separation

Two user-driven changes shipped:

### Feature — pinned favourites

Tables can be pinned to a "Favourites" section at the top of the
browser pane. Click 📍 next to any table's Roll button to pin it;
the icon flips to 📌 and the table appears in the new section. The
Favourites section sits above the regular folder hierarchy with a
chevron, name, and count badge — same visual treatment as a folder
so it slots cleanly into the tree.

Design choices worth noting:

- **Pin granularity is per-table, not per-file.** Tables are the
  unit of work (you roll a table, not a file). Pinning the
  RANDOM ALTAR GENERATOR table is more useful than pinning the
  whole tDA pg.09 file that contains 13 tables.
- **Order is insertion-order, oldest-first.** Pin something, it
  goes to the bottom of the list. Stable — pinning a new table
  doesn't shuffle the existing ones around. Users pin things to
  find them later; a moving-target list would frustrate that.
- **Source file shown as subtitle in the favourites section.** If
  you pin two `Name` tables from different files, the file title
  appears underneath each so you can tell them apart.
- **Missing-file pins survive.** A pinned table whose file gets
  renamed/moved/deleted is silently skipped from rendering but
  NOT removed from persisted settings. If the file comes back
  (the most common cause is "I temporarily renamed it"), the pin
  reappears. Treating absent pins as transient rather than
  purging preserves the user's intent across vault reorgs.
- **Filter respects pins.** When the filter input has a needle, it
  hides non-matching pins from the Favourites section just like
  it does in the rest of the tree. If all pins are filtered out,
  the section header hides too — no empty section.
- **Sentinel path `__favourites`** stores the section's expanded
  state in `browserExpandedPaths`. The `__` prefix can't collide
  with real vault paths.

New persistent setting: `pinnedTables: string[]`. Each entry is
`{filePath}::{tableName}` — the `::` separator is conspicuous and
effectively impossible to collide with on any platform.

### Fix — visual gap between multi-rep results

Multi-rep generators (anything with `MaxReps > 1` or an explicit
`reps` argument) were rendering all results packed line-to-line.
Technically on separate lines but visually one continuous block —
a five-altar table read as a wall of text instead of five distinct
altars.

Fixed by changing the engine's join between reps from `\n` (single
newline) to `\n\n` (blank line). Combined with the
`engineOutputToHtml` translation (`\n` → `<br>`), this produces a
double `<br>` between reps — visible whitespace that matches the
IPP3 reference layout where each rep is its own visually-bounded
chunk. Header and Footer get the same blank-line treatment so
they're distinct blocks rather than mashing into the first/last
rep.

Single-rep output unchanged; the double newline only appears
*between* reps when there are multiple. Inline `rdm:` calls go
through a different evaluation path and aren't affected.

### Test count

**674 tests, 22 suites, all green.** +30 new from v0.2.1:
- 21 unit tests for the pinnedTables helper (encoding round-trips,
  edge cases, mutation safety, ordering)
- 9 integration tests for the BrowserView wiring (section
  appears/disappears, click toggles, persistence round-trip,
  filter integration, missing-file pins don't crash, source
  subtitle, insertion-order rendering)

The 3 existing rep-join tests were updated to assert the new
`\n\n` contract.

Build: ~65KB minified `main.js`. TypeScript clean.

---

# Randomness — v0.2.0 Status

## v0.2.0 — IPP3 spec audit + correctness pass

**644/644 tests green.** This release is the result of a systematic
page-by-page audit of the IPP3 help file (all 87 CHM pages read).
Sixteen bugs found and fixed. Nothing on the documented spec
surface that's still missing — every page either has a regression
test or has been verified by spec-example probe.

### Bug fixes — silent-corruption (real-world generator output was wrong)

1. **`[#n table]` lookup-table range matching.** Was positional-
   indexing into items array; now correctly range-matches against
   item ranges for lookup tables (positional for weighted). The
   most common IPP3 pattern — `[#{1d6} weapons]` against a
   tier-ranged lookup table — silently produced wrong-tier items.
   Goblins were getting Great Swords. 5 regression tests.

2. **`[#<key> <table>]` dictionary keys.** Parser only accepted
   numeric or `{...}` leading tokens; treated `[#fighter hitdice]`
   as a single table named "fighter hitdice" and threw. Now
   accepts plain identifier keys. 5 regression tests.

3. **Leading space after `:` in item content.** Every lookup,
   weighted, and dictionary item with `key: value` syntax retained
   a leading space in the value (`" hd10"` instead of `"hd10"`).
   Every real-world output had been silently polluted. Now stripped
   per IPP3 convention.

4. **Brace handling in subtable index/reps.** Parser was stripping
   `{...}` from `{class}`, leaving bare `class` which rendered as
   literal text instead of looking up the variable. Now braces
   preserved so `[#{class} hitdice]` works as documented.

5. **Newlines `\n` collapsed in HTML output.** Engine emits `\n`
   between multi-rep results; HTML parser silently collapsed them
   into single spaces. Multi-altar generators rendered as one wall
   of text. Fixed via `engineOutputToHtml` translating `\n` → `<br>`
   at the engine/HTML boundary. Affects display + clipboard copy.
   11 regression tests.

6. **Literal-bracket whitespace pollution.** `[ this is bold >> Bold]`
   produced `<b> this is bold </b>` instead of `<b>this is bold</b>`.
   `[abcdefghij >> Right]` returned a space (grabbed from the
   trailing whitespace, not the actual last character). `eachchar`
   injected spaces between every character. All symptoms of one
   compound bug: literal-bracket content was retaining cosmetic
   whitespace meant to be trimmed before filtering. 11 regression
   tests covering the trim contract.

### Bug fixes — features that errored instead of working

7. **Dice expressions with embedded sides** — `{1d[@dietype]}` and
   `{1d{3+3}}` now work. Was throwing "expected dice sides after
   'd'". Documented IPP3 nesting pattern. 3 regression tests.

8. **Variable variables** — `{$[@var]}` and `${name}` now work.
   The expression parser was choking on `[` after `$`. After
   consuming `$`, the parser now also accepts embedded
   sub-expressions as the variable name source. 3 regression tests.

9. **Inline `//` end-of-line comments** — `the result // comment`
   was kept verbatim instead of stripping the comment. Whole-line
   `#`, `;`, `//` worked but inline didn't. Also caught a related
   bug: `parseItemPrefix` was being called with the un-stripped
   raw line, so even fixing the stripper alone wouldn't have
   worked. Both fixed. Conservative: only strips `//` at top
   level (outside `[...]`) to avoid corrupting filter arguments
   that legitimately use `/`. 2 regression tests.

### Bug fixes — features that were missing entirely

10. **"Current-index pick" `[#sometable]`** — IPP3: "if the 5th
    item is selected, and that item has `[#sometable]`, the 5th
    item in sometable would be picked." Implemented with a
    stack-based current-item-index tracker that runTable pushes
    when an item is picked and pops on completion. Nested calls
    inherit naturally; outer indices restore correctly. 6
    regression tests including a 30-seed multi-item cross-index
    check.

11. **`\a` (a/an) English exceptions.** IPP3 docs explicitly
    promise common exceptions ("an hour", "an honest", "a
    university") plus letter-name-vowel acronyms ("an MBA", "an
    NPC"). Previous implementation was bare vowel-check, producing
    "a hour" and "an university". Now handles silent-H words,
    U-as-/juː/ words, "one"-words, and uppercase acronyms whose
    first letter is in F/H/L/M/N/R/S/X. 12 regression tests.

### Spec coverage now verified

Every IPP3 CHM page either tested directly or covered by an
integration test. The audit traced **all 87 pages**, including
filter spec examples (all 22 pass exactly as documented),
escapes (`\n \t \_ \z \a \[ \{`), comments (`#`, `;`, `//`,
inline `//`), legacy syntax (`{!expr}`, `{$var}`),
built-in variables (`{app}`, `{version}`, `{rep}`, etc.),
prompt commands, `with` parameter passing, conditionals, and
nesting in all documented forms.

### Test count

| Suite | Tests |
|---|---|
| engine/expressions | 87 |
| engine/filters | 53 |
| engine/contentParser | (updated) |
| engine/fileParser | (updated) |
| engine/evaluator | 23 |
| engine/recursionGuard | 7 |
| resolver/* | 95 |
| views/sanitiser | 44 |
| views/* (all) | ~150 |
| integration/corpus | 50 |
| integration/demoNote | 18 |
| **Total** | **644** |

Build: ~64KB minified `main.js`. TypeScript clean. Zero runtime
deps beyond Obsidian's own API + native browser globals.

---

# Randomness — v0.1.0-ready Status (end of session)

## What's done

**Engine + resolver + UI + build chain: feature-complete and tested.** 473/473 tests green. `npm run build` produces a 49KB minified `main.js` ready for BRAT install. All Phase 1–4 items resolved (#15–21 complete).

Pure-TypeScript modules in `src/` (Obsidian imports confined to `src/views/`):

**Engine (`src/engine/`):**

| Module | Purpose | LOC |
|---|---|---|
| `ast.ts` | Node types — contract between parser and evaluator | ~100 |
| `fileParser.ts` | Source → GeneratorFile (table structure, commands, item prefixes) | ~280 |
| `contentParser.ts` | Item content string → Node[] (escapes, brackets, braces, conditionals) | ~400 |
| `expressions.ts` | `{...}` evaluator — math, dice, functions, assignment, embedded calls | ~330 |
| `filters.ts` | All 21 IPP3 filters with arg interpolation | ~220 |
| `rng.ts` | Mulberry32 seedable PRNG | ~50 |
| `evaluator.ts` | Ties everything together — tables, deck state, variable scoping, recursion guard | ~480 |

**Resolver (`src/resolver/`):**

| Module | Purpose | LOC |
|---|---|---|
| `fileResolver.ts` | `Use:` path resolution + recursive bundle assembly; backend-agnostic via `FileSource` | ~310 |
| `mdExtractor.ts` | Pulls ```` ```randomness ```` codeblocks from `.md` files into virtual `.ipt` source | ~110 |
| `scope.ts` | Inline `rdm:` scope assembly — composes mdExtractor + fileResolver into a runnable bundle | ~170 |
| `asyncPrefetcher.ts` | Walks Use: graph async, prepares in-memory FileSource for the sync resolver | ~190 |

**Views (`src/views/`):** — Obsidian imports start here

| Module | Purpose | LOC |
|---|---|---|
| `main.ts` | Plugin entry; settings, codeblock + inline processors, commands, shared `PreviewRegistry` | ~180 |
| `settings.ts` | Settings shape, defaults, settings tab UI, `stableSeedFor` hash helper | ~140 |
| `vaultFileSource.ts` | `AsyncFileSource` impl wrapping Obsidian's `Vault.adapter` | ~50 |
| `codeblockProcessor.ts` | Renders ```randomness blocks — async prefetch → sync resolve → engine → sanitiser → DOM, with Prompt: controls | ~240 |
| `inlineProcessor.ts` | `rdm:` post-processor — walks rendered code spans, evaluates, hooks Lock/Reroll | ~310 |
| `lockingService.ts` | Pure state machine — text transforms for lock/unlock, `PreviewRegistry` in-memory store | ~210 |
| `promptUI.ts` | Renders `Prompt:` declarations as `<input>` / `<select>` controls | ~140 |
| `sanitiser.ts` | HTML whitelist sanitiser — strips disallowed tags, attributes, event handlers before DOM attach | ~140 |
| `iptView.ts` | Custom `TextFileView` for `.ipt` files — renders engine output with Reroll + Open-as-Markdown actions | ~210 |

**Distribution files:**

- `manifest.json` — plugin metadata
- `esbuild.config.mjs` — bundler config (entry `src/views/main.ts`, output `main.js`)
- `styles.css` — minimal styling for inline UI, prompt controls, error blocks
- `README.md` — install (BRAT + manual), usage, attribution, security
- `LICENSE` — MIT

### Inline trigger evolution: `=scry:` → `=rdm:` → `rdm:`

The inline trigger was renamed twice, for different reasons:

1. **`=scry:` → `=rdm:`** at the user's request, for brand consistency
   with the plugin name "Randomness". Pure textual rename, all 425
   tests passed unchanged.

2. **`=rdm:` → `rdm:`** after first real-world test in a user's
   vault. Dataview claims any code span whose content starts with
   `=` as an inline DQL query (its documented syntax is `` `= date(today)` ``).
   With `=rdm:` we got "Dataview (inline field 'rdm:'): Error: PARSING
   FAILED" rendered alongside our correct output. The Randomness
   render itself worked — both renderers ran, but Dataview's error
   block was noisy and confusing.

   Fix: drop the leading `=`. `rdm:` is unambiguous, doesn't collide
   with Dataview's inline-query prefix (needs `=`), and doesn't
   collide with Dataview's inline-field syntax either (needs `::`).
   A regression test in `lockingService.test.ts` enforces that
   `INLINE_PREFIX` doesn't start with `=` to prevent future drift.

`INLINE_PREFIX = "rdm:"` in `lockingService.ts` is the single source
of truth; everything else (display strings, command names, regex
patterns) is derived from it textually.

### Click-handler bug fixes from real-vault testing

Two bugs surfaced when the plugin was tested in a real Obsidian vault
(not just under jest + jsdom):

**Bug A: 🎲 on an unfilled preview did nothing.** The reroll handler
deleted the cached preview but then called `vault.process` looking
for a locked occurrence to strip. For unfilled calls there's no lock,
so `vault.process` returned the source unchanged, Obsidian didn't
re-render, and the displayed result stayed exactly the same as
before. **Fix:** for unfilled calls, evaluate a fresh value in
JavaScript and update the visible span's result text directly. No
vault round-trip needed because the source text doesn't change.

**Bug B: 🔒 sometimes committed a stale value.** The lock handler
captured `result` at render-time and used it as the value to write.
After the user rerolled, the *displayed* value updated but the
captured `result` didn't, so locking wrote the wrong value. **Fix:**
lock reads the current registry value at click time instead of
relying on the captured closure variable.

Both bugs are now covered by regression tests in
`__tests__/views/inlineProcessor.test.ts` under the "inline processor
click handlers" describe block. 5 new tests, all of which would have
failed against the broken version.

### Known: Live Preview limitation

`registerMarkdownPostProcessor` doesn't fire in Live Preview — only in
Reading view. This is a documented Obsidian behaviour
(see [forum thread](https://forum.obsidian.md/t/registermarkdownpostprocessor-callback-not-called-with-live-preview-mode/56049)),
and the Obsidian Tasks plugin has the same constraint.

In Live Preview, inline `rdm:` calls render as plain code spans
(locks still survive in the source, but the 🔒/🎲 buttons don't
appear). The README and demo note flag this prominently. A future
session can add a CM6 ViewPlugin for live-preview support; deferred
for now because it's a substantial chunk of work and Reading view
covers the primary "review-the-result" workflow.

### Bug fixes & feature round (second real-vault test)

Three issues surfaced; all fixed:

**Bug C — `<b>result</b>` displayed as literal text, not bolded.** The
inline processor used `resultSpan.textContent = props.result`, which
renders HTML tags as character data. Engine output for `>> bold`
filter is `<b>X</b>` (real HTML), so the angle brackets appeared
verbatim. **Fix:** route inline result through the existing
`setSanitisedHtml` (same sanitiser used by the codeblock processor).
This applies to both the initial render and the in-place reroll
update. 2 new tests in `inlineProcessor.test.ts` pin both paths.

**Bug D — `MaxReps: N` was treated as a cap, not a default.** The IPP3
spec (verified via NBOS forum + IPP3 user manual) says `MaxReps: N`
means "the file author wants N results". My implementation:
`reps = min(opts.reps ?? 1, maxReps ?? Infinity)` — so `MaxReps: 5`
with the default `opts.reps = 1` produced only 1 result, not 5.
**Fix:** when caller doesn't pass `opts.reps`, default to
`file.maxReps` if declared. Explicit caller `opts.reps` still gets
clamped by `MaxReps`. 7 new tests in `__tests__/engine/evaluator.test.ts`.

**Feature — generator browser pane.** New `BrowserView` in
`src/views/browserView.ts`. A right-sidebar `ItemView` that scans
the configured Generator root (or whole vault if no root set) for
`.ipt` files, lists each file's tables with per-table Roll buttons,
and shows the most recent roll with a Copy button. Click the result
body to copy too. Discovery cached in-memory, refreshed via Reload
button. Accessible via ribbon icon (dice) or command "Open
generator browser". 14 new tests covering discovery, table rolling,
and HTML-to-plain-text for clipboard.

### Bug fix — newlines (`\n`) now survive rendering and copy

Real-world report from a user pasting a multi-rep altar generator
into a note: five altar descriptions ran together into one wall of
text, even though each was meant to be on its own. Same problem in
the result panel itself — multi-line rolls displayed on one line.

**Cause:** the engine emits literal `\n` characters from `\n`
escapes in source content and joins multi-rep results with `\n`
between them. When that string reaches `setSanitisedHtml`, it gets
parsed via `innerHTML`. The HTML parser **collapses whitespace
including newlines into single spaces** unless it's inside a `<pre>`
or styled with `white-space: pre-wrap`. So every line break in the
engine output was silently eaten before reaching the screen.

The clipboard copy hit the same bug from a different angle: the
HTML we put on the clipboard had bare `\n` characters; Obsidian's
HTML-to-markdown converter parses the HTML, collapses the newlines
on parse, and emits flat run-on text.

**Fix:** new helper `engineOutputToHtml(s)` translates `\n` (and
`\r\n`, `\r`) to `<br>` tags. Called from:

  1. `setSanitisedHtml` — so the rendered DOM has `<br>`s where
     the engine had `\n`s. Affects every rendering path:
     codeblock processor, inline processor, iptView, browser
     result panel.
  2. `BrowserView.copyResult` — applied to the HTML format before
     `writeRichClipboard`. So Obsidian's paste-time HTML-to-
     markdown sees `<br>` elements (which it converts to markdown
     line breaks), not collapsed newlines.

The plain-text clipboard format keeps real `\n` characters because
plain-text targets want them.

`<br>` (rather than `</p><p>` or some heuristic about consecutive
newlines) was chosen because:
  - It's simple and predictable;
  - It composes cleanly with Obsidian's markdown converter on
    paste (`<br><br>` → paragraph break);
  - Smarter rules would risk breaking IPP3 corpora that use
    single `\n` deliberately for paragraph-like spacing.

11 new tests at `sanitiser.test.ts` and `browserView.test.ts`:
unit tests for the translation (single newline, multiple
newlines, CRLF, bare CR, no-newline content, empty input), DOM-
level integration (multi-line text renders with `<br>` elements,
mixed bold+newline content keeps both), and end-to-end (a real
roll with `\n` escapes produces both HTML and plain-text
clipboard formats with the line breaks preserved).

### Feature — result panel "Copy" preserves formatting

The Copy button in the result panel (bottom of the browser pane,
where the last roll is shown) now puts BOTH `text/html` and
`text/plain` on the clipboard. Obsidian's editor receives the HTML
on paste and converts it to markdown — so a bold name in the rolled
output becomes `**Name**` in the note; bulleted sub-creatures become
`-` lists; line breaks stay as line breaks. Plain-text targets
(terminals, plain inputs) get the stripped text.

Multi-format clipboard via `navigator.clipboard.write([ClipboardItem(…)])`.
Feature-detected: if the platform lacks `ClipboardItem` (older
Electron, jsdom, some browsers), falls back gracefully to
`writeText(plain)`. Defensive against runtime rejections too —
some platforms advertise `write()` but throw on HTML payloads;
we catch and degrade to plain.

This is specifically for the result-panel Copy (which copies the
*specific roll the user just made*). The per-table 📋 button is
unchanged — it copies a `rdm:` reference that rerolls every render,
so formatting at copy-time would be misleading.

Implementation: new `writeRichClipboard(html, plain)` helper, called
from `copyResult`. Notice updated from "Result copied" to "Result
copied with formatting" so users know they got the rich version.

5 new tests at `browserView.test.ts`: rich path writes both
formats, fallback when `ClipboardItem` missing, fallback when
`clipboard.write` missing, fallback when `clipboard.write` throws,
end-to-end click flow (Roll → result panel → click Copy → both
formats reach the clipboard). The end-to-end uses the canonical
IPP3 filter syntax `[text >> bold]` rather than the `\b{}` form
I'd misremembered.

### Feature — Copy-inline button is now context-aware

The 📋 Copy button in the browser pane now picks between the
inline form and a self-contained codeblock+inline form based on
the active note:

- **If the active note already imports the source generator** (has
  a `randomness` codeblock with a matching `Use:` line), the
  button copies just `` `rdm:[@T]` `` — the terse inline form,
  paste anywhere.
- **Otherwise** (no active note, fresh note, or note with no Use:
  matching this file), the button copies a self-contained snippet:
  a `` ```randomness `` codeblock with the `Use:` directive, a
  blank line, then the inline call. One paste imports the
  generator AND drops an inline call ready to roll.

The Notice that pops up tells the user which form they got and
why, so they're not surprised by paste contents that differ from
what they'd expected.

Implementation pieces:

- `buildSelfContainedSnippet(filePath, tableName)` — pure helper
  that builds the codeblock+inline form. Exported for tests.
- `noteImportsFile(noteSource, filePath)` — pure helper that
  scans a note's markdown source for a `randomness` codeblock
  whose `Use:` line matches the given file. Case-insensitive,
  normalises backslashes to forward slashes, accepts a basename
  match as well (legacy IPP3 generators often use relative
  references). False positives produce a redundant `Use:` line;
  false negatives produce an extra codeblock paste — both are
  benign nuisances, not broken state.
- `BrowserView.readActiveNoteSource()` — reads the workspace's
  active markdown file, defensive against missing APIs (test
  mocks may not implement the full Workspace surface).
- `BrowserView.copyInline()` — composes the three above, chooses
  the form, copies, surfaces the choice via Notice.

13 new tests added (579 total): pure-helper coverage for
`buildSelfContainedSnippet` and `noteImportsFile` (10 tests
covering case-insensitive matching, backslash normalisation,
basename approximation, non-randomness codeblock isolation,
multiple-codeblock handling, empty inputs); 3 integration tests
for the click flow (no active note → codeblock form, active
note with matching Use: → inline form, active note without
matching Use: → codeblock form).

### Bug fix — unknown tables now throw instead of silently rendering empty

Real-vault report: a user pasted `` `rdm:[@OrcHuntingParty]` `` into a
fresh note (no `randomness` codeblocks, no `Use:` imports) and got
an inline call with the standard dice/lock control icons but **no
result text** — visually broken, with no clue what was wrong.

**Cause:** the engine's subtable-rolling code (`runSubtableRollNode`,
`runSubtablePickNode`, `runDeckPickNode`) all had identical
`if (!table) return "";` lines that silently returned an empty
string when a referenced table wasn't in scope. The inline
processor then rendered preview controls around the empty result.
Worse, locking the empty preview into the note's source would have
made the silent failure permanent.

**Fix:** all three call sites now `throw new Error("Unknown table: ${name}")`.
The inline processor's existing error handler catches it and
renders an `[error: Unknown table: X]` span (the standard
`randomness-inline-error` styling). The codeblock processor's
error block surfaces it the same way.

This is a contract change for the engine — previously "missing
table" was a recoverable silent zero-output condition; now it's
an error. Corpus tests that were asserting silent-empty behaviour
for generators with missing Use'd dependencies were updated to
assert the throw instead. The "graceful failure" they were
checking turned out to be the bug.

The new behaviour composes well with the Copy-inline button: the
button's Notice tells the user what Use: line to add; if they
forget, the error span tells them the table that didn't resolve.

2 new regression tests at `inlineProcessor.test.ts` and
`scope.test.ts` pin the new contract; 5 corpus tests rewritten
from "doesn't throw" to "throws meaningfully naming the missing
table"; 1 recursion-guard test reworked to invoke `AddCommas`
directly via `evalRawText` (since the file's main table now
throws on its missing dependencies).

### Feature — Copy-inline button in the browser pane

Each table row in the browser tree now has two action buttons: the
existing **Roll** (evaluates the table, shows the result below) and
a new **📋 Copy inline**. Clicking Copy puts the inline form —
`` `rdm:[@TableName]` `` — on the clipboard, ready to paste into a
note's prose. Once rendered in Reading view, the pasted call rolls
live and shows the standard preview/lock/reroll controls.

A subtlety the UX has to handle: an inline `rdm:` call resolves
against the calling note's own scope (its embedded `randomness`
codeblocks plus their `Use:` imports). If the user pastes the call
into a note that hasn't imported the source generator, the call
won't evaluate. The Copy button's Notice surfaces the exact `Use:`
line the user needs — e.g.:

> Copied `rdm:[@MasterOrcName]`
>
> If your note doesn't already import this generator,
> add a randomness codeblock with:
>   Use: IPP3/Common/nbos/Names/Orc.ipt

The Use: line isn't auto-copied (one clipboard slot = one thing);
the user can manually add a codeblock once per note and then paste
inline calls freely.

Implementation: pure helper `buildInlineSyntax(name)` builds the
code-span string; `BrowserView.copyInline(file, name)` wires it to
`navigator.clipboard.writeText` with the standard error-handling
pattern (matches `copyResult`). Click handler calls
`stopPropagation()` so clicking Copy doesn't also collapse the
parent file row.

5 new tests at `browserView.test.ts`: pure helper formatting,
helper tolerates spaces in table names, button renders one per
table, click writes the right text to a stubbed clipboard, click
doesn't bubble. Clipboard stubbed via `Object.defineProperty` on
`navigator` because jsdom doesn't ship a clipboard polyfill.

### Bug fix — Use: resolution now searches `<root>/Common/`

Follow-up to the case-insensitive fix. Same user, same vault: with
generator root set to `IPP3`, `Use: nbos\names\orc.ipt` from
`IPP3/Common/nbos/Encounters/Orcs.ipt` still failed because none of
the candidate paths included the `Common/` layer. My resolver tried:

  1. `IPP3/Common/nbos/Encounters/nbos/names/orc.ipt` — doesn't exist
  2. `IPP3/nbos/names/orc.ipt` — missing `Common/`, doesn't exist
  3. `nbos/names/orc.ipt` — vault-rooted, doesn't exist

The actual file at `IPP3/Common/nbos/Names/Orc.ipt` never got
considered as a candidate. Case-insensitive lookup couldn't help —
the *structure* was wrong, not the case.

**Cause:** the original IPP3 (per its user manual) always searched a
`Common/` subfolder of its install dir for Use: references — that
was the implicit library namespace. Legacy generators were authored
against that assumption: `Use: nbos\names\orc.ipt` meant "find this
relative to Common/, wherever Common/ lives". Vaults that mirror
the IPP3 layout therefore have generators referencing paths that
implicitly start with `Common/`.

**Fix:** the Use: resolver now tries `<generatorRoot>/Common/<ref>`
as a candidate before `<generatorRoot>/<ref>`. Order:

  1. callerDir + ref   (sibling files)
  2. <root>/Common/ref (IPP3 canonical library namespace)  ← NEW
  3. <root>/ref        (fallback for vaults without Common/ layer)
  4. ref as-is         (vault-rooted refs)

The Common-lookup is silent when no `Common/` subfolder exists, so
vaults that organise differently still work via candidate 3. The
sync and async resolvers stay in sync (both updated identically;
comments call out the requirement to keep them parallel).

5 new regression tests across `fileResolver.test.ts`,
`asyncPrefetcher.test.ts`, and `browserView.test.ts` pin the new
behaviour, including the exact user-reported reproduction (file
under `IPP3/Common/nbos/Encounters/`, Use: with backslashes and
lowercased ref, target at `IPP3/Common/nbos/Names/Orc.ipt`).

### Bug fix — case-insensitive Use: resolution

Real-vault report: a generator at `IPP3/Common/nbos/Encounters/Orcs.ipt`
with `Use: nbos\names\orc.ipt` failed with "Use: target not found",
even though the file `IPP3/Common/nbos/Names/Orc.ipt` was clearly
present in the vault. **Cause:** the original IPP3 ran on Windows
(case-insensitive filesystem), so legacy generators reference files
with whatever casing the author happened to type. Obsidian's vault
adapter on macOS/Linux is case-sensitive — `vault.adapter.exists("nbos/names/orc.ipt")`
returns false when the actual file is `nbos/Names/Orc.ipt`.

**Fix:** `vaultFileSource` now does a case-insensitive fallback. On
the first `exists`/`read` miss, it builds a lazy index from the
vault's file list (`vault.getFiles()`) keyed by lowercased path. The
literal-case path is always tried first (fast common path); the
index only gets built when a fallback is actually needed, and is
reused across multiple Use: references in the same resolve operation.

6 new tests at `views.test.ts` and `browserView.test.ts` pin the
fallback: exists/read both work across case mismatch, no fallback
when literal case matches, end-to-end pipeline correctly resolves
the user's exact scenario.

This complements the existing path-separator normalisation (`\` →
`/`), so a Windows-authored `Use: nbos\names\orc.ipt` resolves
correctly to the macOS/Linux file `nbos/Names/Orc.ipt`.

### Browser pane — folder tree v2

User feedback: the flat-list browser worked but scaled badly past
a handful of generators. Rebuilt as a collapsible folder tree:

- New module `src/views/browserTree.ts` — pure tree-building
  functions (`buildFolderTree`, `filterTree`, `collectAllPaths`).
  19 unit tests at `__tests__/views/browserTree.test.ts` pin
  hierarchy construction, sorting, root-path filtering, search-
  filter behaviour, and path collection for auto-expansion.

- Expansion state persists in `settings.browserExpandedPaths`
  (string[] of folder + file paths). Toggling any chevron writes
  to settings immediately. Default empty — tree starts fully
  collapsed.

- "Collapse all" button in the header clears the persistent
  expansion set but leaves the filter input alone, so
  collapse-all-then-filter is the fastest way to find a specific
  generator in a deep tree.

- Filter behaviour: when the search box is non-empty, we filter
  the tree to matching subtrees, then layer a *transient*
  expansion set over the user's persistent one covering every
  remaining node. Matches are visible without manual clicking;
  clearing the filter restores the saved expansion. The persistent
  set is never modified by filter typing.

- Click bubbling guarded: Roll buttons live inside expanded file
  rows whose header is itself clickable to toggle expansion. The
  Roll button's handler calls `e.stopPropagation()` so rolling
  doesn't collapse the file.

8 view-integration tests at `browserView.test.ts` exercise the
rendered DOM: starts collapsed, clicks toggle, Collapse-all clears,
filter auto-expands ancestors, filter survives Collapse-all, etc.

The engine survives the most complex real-world file in the corpus
(Random Treasure CR1-CR30) which exercises: prompts, conditionals with
quiet-assignment branches, recursion (AddCommas calls itself), parameter
passing via `with`, filter chains with computed args (`Substr 2 {$NewLength}`),
embedded table calls in filter args, and HTML output.

### Test coverage map (as of this session)

| Suite | Tests | What it covers |
|---|---|---|
| `__tests__/engine/contentParser.test.ts` | (existing) | Escapes, brackets, braces, conditionals at the AST level |
| `__tests__/engine/fileParser.test.ts` | (existing) | Table structure, commands, item prefixes |
| `__tests__/engine/expressions.test.ts` | 81 | Numbers, strings, arithmetic/precedence, comparisons, variables (incl. `$` prefix), assignment (`=` vs `==`), functions, dice (seeded), embedded brackets, errors |
| `__tests__/engine/filters.test.ts` | 53 | Each of the 21 filters individually + chain behaviour + unknown-filter passthrough |
| `__tests__/engine/recursionGuard.test.ts` | 7 | Direct & indirect self-recursion caught; legitimate AddCommas-style recursion unaffected; custom budget honoured; depth resets between reps |
| `__tests__/resolver/mdExtractor.test.ts` | 22 | Fence variants (backtick/tilde, ≥3 chars, indent, CRLF), language tag matching, multi-block notes |
| `__tests__/resolver/fileResolver.test.ts` | 39 | Path normalisation, `resolveUsePath`, linear & diamond Use: chains, cycle detection, import-depth cap, end-to-end through Evaluator |
| `__tests__/resolver/scope.test.ts` | 13 | Plain expressions, in-note codeblock visibility, multi-codeblock namespace sharing, in-note Use: resolution, `visibleTableNames` query |
| `__tests__/resolver/asyncPrefetcher.test.ts` | 13 | Linear/transitive Use: walks, dedupe, cycles short-circuit, missing-file recording, generatorRoot fallback, depth cap, .md raw scan |
| `__tests__/views/views.test.ts` | 22 | Settings round-trip, `stableSeedFor`, settings tab `display()`, **`normalizePath` import wiring (new)**, `vaultFileSource`, codeblock rendering, error blocks, stable-seed determinism, prompt controls + change re-render |
| `__tests__/views/lockingService.test.ts` | 36 | `parseInlineCall` / `serialiseInlineCall` round-trips, `applyLockToSource` / `applyUnlockToSource` (single, Nth, re-lock, out-of-range, non-matching), `transformAllInlineCalls`, `PreviewRegistry` (get/set/delete/clearNote/clear with prefix-collision check) |
| `__tests__/views/inlineProcessor.test.ts` | 12 | `replaceCodeElement` (locked / unfilled states, lock vs reroll button click), `renderInlineError`, full pipeline (non-`rdm:` ignored, locked passthrough, unfilled evaluates and caches, re-render uses cache, error path, multiple calls) |
| `__tests__/views/promptUI.test.ts` | 12 | `initialPromptValues`, free-text inputs (change vs input event), dropdowns (preselect, change), multi-prompt aggregation, label rendering |
| `__tests__/views/sanitiser.test.ts` | 34 | Allowed tags (b, i, u, br, ul/li, p, div, headings, tables) survive; attacks blocked (script, iframe, link, meta, form, a, object, embed, svg+onload); attributes stripped (onclick, onerror, onmouseover, style); HTML entities safely round-trip; comments dropped |
| `__tests__/views/iptView.test.ts` | **13 (new)** | View type identity (constant, getViewType, getDisplayText fallback + with file), render pipeline (setViewData triggers render, error block on resolver failure, getViewData read-only, clear empties state), prompts (rendered when declared, change re-renders, switching files resets), output sanitisation (script stripped, allowed tags survive) |
| `__tests__/integration/corpus.test.ts` | (existing) | End-to-end against the 5 real `.ipt` files |

## Bugs resolved during integration

These were caught by running the corpus through the evaluator. Each fix
made the engine more correct, not just "test-passing":

1. **Conditional comparisons treated text as identifiers.** `{$x}=foo` was
   evaluating `foo` as a variable name (which resolved to empty). Fixed: 
   conditions render both sides as content first, then compare as strings 
   (with numeric coercion when both look numeric). See `evalConditionTruthy` 
   in `evaluator.ts`.

2. **Variable references in `Define:` weren't being looked up.** `VariableNode`
   only checked the eager `vars` map. Fixed: fall through to `defines` and
   re-evaluate the source on each reference.

3. **Expression parser didn't accept `$` prefix on identifiers.** Files like
   `{$NormalCheck}` would fail with "unexpected character '$'". Fixed: leading
   `$` is consumed and ignored in `parseIdentifierOrCall`.

4. **Literal brackets weren't re-evaluating embedded variables.** The text
   `[{$NewValue} >> Length]` had `text="{$NewValue} "` but no rendering pass.
   Fixed: re-parse `text` as content and render before applying filters.

5. **Filter arguments weren't being rendered.** `Substr 2 {$NewLength}` was
   parsing `{$NewLength}` as a literal token. Fixed: added `renderArgs()` 
   helper used by Substr, Left, Right, Implode, and At.

6. **`Substr N` with no length was returning the rest of the string.** The
   corpus AddCommas pattern proves IPP3's actual behavior is "1 character"
   when length is omitted. Documented and fixed.

7. **No bound on table-call nesting.** Self-recursive or mutually recursive
   tables would blow the JS stack with a RangeError. Fixed: added 
   `callDepth` tracking in `runTable` with default budget of 100 (configurable
   via `EvaluatorOptions.maxRecursionDepth`). Throws a distinct 
   `RecursionLimitError` that names the offending table — surfaces cleanly
   to the UI layer when that arrives. AddCommas runs in <10 levels of depth, 
   so legitimate generators are unaffected.

## Important decisions captured

- **Stickiness model is "preview-first, manual lock"** — both for inline 
  `rdm:` and codeblocks. Rendering never mutates the note; "Lock" command
  writes preview → text using `⟹` separator for inline and append-below
  for codeblocks.
- **Plugin name is "Randomness"**, codeblock tag `randomness`, inline 
  trigger `rdm:`. Plugin ID `randomness` (TBC: registry check still 
  needed).
- **MIT license + NBOS attribution for IPP3 compatibility** (same approach
  as Kingmaker's MIT + Paizo Community Use).
- **`Use:` resolution order**: current folder → generator root → same-note
  codeblocks (for inline only). `.md` files treated identically to `.ipt`
  (codeblocks extracted).
- **Engine is deterministic given a seed** — every test pins RNG.
- **No silent mutation** is the load-bearing design principle.
- **Recursion budget default is 100; configurable via options.** Caught
  errors throw `RecursionLimitError` so the future UI can show "your
  generator looks infinitely recursive" rather than a generic stack
  overflow.
- **Resolver is backend-agnostic via `FileSource`.** Implementations:
  in-memory (tests), Node fs (CLI/smoke), Obsidian Vault (plugin —
  to be written in `src/views/`). Keeps the resolver pure-TS, same as
  the engine, so the testable surface stays testable from Node.
- **Cycle detection precedes dedupe.** When `A → B → A`, `A` is already
  in the "loaded" set (it was the entry point), so a naïve dedupe would
  silently skip the back-edge. The resolver checks the active visit
  stack first — that's the actual cycle condition. Caught by tests
  during initial development; left documented in code so the rule
  doesn't get accidentally inverted later.
- **Synthetic in-note scope uses a `.__inline.ipt` path suffix.** Inline
  `rdm:` calls assemble a virtual file holding the user's expression.
  When that virtual file has Use: directives, the resolver re-parses
  the synthetic source — and parses dispatch on extension. The suffix
  forces the .ipt code path so we don't accidentally re-run the
  markdown extractor on already-extracted content. Subtle but the kind
  of footgun that's hard to debug if you trip it later.
- **The async/sync boundary lives in `asyncPrefetcher.ts`.** Obsidian's
  Vault is async; the resolver and engine are synchronous (with ~150
  tests baked into that contract). Rather than convert the entire
  chain to async, the prefetcher walks Use: graphs async, fetches
  files, and populates an in-memory FileSource for the synchronous
  resolver to consume. Small duplication of work in exchange for not
  rewriting the test surface.
- **Plugin uses standard DOM methods, not Obsidian's HTMLElement
  extensions** (`empty()`, `createDiv()`, `createEl()`). Obsidian
  augments the prototype globally — fine in production, but jsdom
  doesn't have those methods, so tests would fail. Using `while
  (el.firstChild) el.removeChild(...)` and `document.createElement` is
  identical in behaviour and works everywhere.
- ~~**`innerHTML` is used for engine output**~~ — superseded this
  session by `src/views/sanitiser.ts`. Engine output now passes through
  a tag-whitelist sanitiser before reaching the DOM. Drops `<script>`,
  `<iframe>`, event handler attributes, etc. Documented allowed tag list
  in the sanitiser source. The trust model in the README is still "use
  generators you trust" — defence-in-depth, not a free pass.
- **Lock state lives in the note text, not in plugin state.** The
  serialised form `rdm:expr⟹result` is the source of truth. Plugin
  state (`PreviewRegistry`) holds only *previews* — the unstable in-
  between state before a user commits with Lock. Killing the registry
  loses previews but never loses locked content. This is the
  load-bearing decision behind the whole stickiness model.
- **The lock separator is `⟹` (U+27F9, LONG RIGHTWARDS DOUBLE
  ARROW).** Chosen because it's visually distinctive, unambiguously
  not regular punctuation, and rare enough in prose that we don't
  worry about collisions. The shorter `⇒` (U+21D2) was considered but
  is closer to common math notation.
- **Occurrence-based inline call identity, not position-based.** Two
  `rdm:[@X]` calls on the same note are distinguished by "which
  Nth-of-this-expression they are", which survives unrelated edits
  anywhere else in the file. Position offsets would be fragile under
  any concurrent edit. The trade-off: re-ordering identical inline
  calls scrambles their associations. We accept this; it's a rare
  edit pattern.
- **"Lock all" requires previews to already exist.** The command
  walks the note and locks anything with a cached preview, skipping
  the rest with a notice. A cleaner version would evaluate missing
  previews on the fly. Filed as a Phase 4 item — current behaviour is
  correct, just slightly more steps for the user.

## What's next, in priority order

### Phase 1 — finish engine integration tasks

1. ~~**Add expression evaluator tests**~~ ✓ Done — 81 tests in 
   `__tests__/engine/expressions.test.ts`.

2. ~~**Add filters tests**~~ ✓ Done — 53 tests in 
   `__tests__/engine/filters.test.ts`.

3. **Pull a bigger corpus** from your Drive (maybe 5-10 more files spanning
   Encounters, Creatures, DMG, SKT folders). Run them through 
   `parseGeneratorFile` and `Evaluator.run()` with seed sweeps to surface 
   edge cases the current corpus doesn't hit. — **STILL OUTSTANDING**.

4. ~~**Add max-recursion-depth guard** in evaluator (default 100).~~ ✓ Done.
   `RecursionLimitError` exported from `evaluator.ts`. 7 tests in
   `__tests__/engine/recursionGuard.test.ts` covering direct + indirect 
   recursion, custom budgets, legitimate corpus recursion, and depth 
   reset between reps.

### Phase 2 — resolver layer (`src/resolver/`) ✓ Done this session

5. ~~**`fileResolver.ts`** — Use: path resolution with backslash → forward-slash
   normalisation for legacy Windows paths.~~ ✓ Done.
   `FileSource` interface for backend abstraction (Node fs / Obsidian Vault
   / in-memory test source), `normalisePath` / `joinPath` / `dirname` pure
   helpers, `resolveUsePath` for single-hop, `resolveBundle` for recursive
   Use: graph walking with cycle detection (`ImportCycleError`) and
   import-depth cap (default 32). 39 tests.

6. ~~**`mdExtractor.ts`** — Pull ```` ```randomness ```` codeblocks out of .md
   files, present as virtual .ipt source.~~ ✓ Done. Handles tilde fences,
   4+ backticks, case-insensitive language tags, indented (≤3 space)
   fences, CRLF, labels (`randomness:main`), multi-block notes. 22 tests.

7. ~~**`scope.ts`** — Track table visibility per context (especially for inline
   `rdm:` seeing same-note codeblocks).~~ ✓ Done. `buildInlineBundle`
   composes mdExtractor + fileResolver; in-note codeblocks share a
   namespace; in-note Use: directives resolve relative to note dir →
   generator root. `visibleTableNames` query for future autocomplete.
   13 tests.

### Phase 3 — Obsidian UI (`src/views/`) — completed across two sessions

8. ~~**`main.ts`** — Plugin entry, settings, command registration.~~
   ✓ Done. Loads settings via `loadData`/`saveData`, registers the
   `randomness` codeblock processor, the `rdm:` inline post-processor,
   the settings tab, and the "Lock all" / "Reroll all" commands. Owns
   the shared `PreviewRegistry`.

9. ~~**`settings.ts`** — Generator root path, render prefs.~~ ✓ Done.
   Three settings: `generatorRoot` (vault-relative path for Use:
   fallback), `defaultFormatting` (`"html"` or `"text"`), and
   `stableCodeblockSeeds` (FNV-1a seed derived from source + line, for
   deterministic codeblock renders). Plus the settings tab UI.

10. ~~**`iptView.ts`** — Custom view for .ipt files (result + reroll, edit via
    Open as Markdown).~~ ✓ Done this session. `TextFileView` subclass
    registered for the `.ipt` extension. On open, evaluates the file
    through the engine pipeline and renders the output (sanitised, same
    as codeblocks). Includes Reroll + Open-as-Markdown actions in the
    view title bar. Renders Prompt: controls when the file declares
    them, with values resetting on file switch. 13 tests.

11. ~~**`codeblockProcessor.ts`** — Renders `randomness` codeblocks with preview
    state, lock button, reroll button.~~ ✓ Done. Each codeblock prefetches
    Use: graph via Vault, runs synchronous resolver + Evaluator, renders
    output (or a friendly error block). Now also renders `Prompt:`
    controls above the output when the generator declares them — changing
    a prompt re-renders with the new value. Wraps in `MarkdownRenderChild`
    so async work bails cleanly if the section is unloaded mid-render.
    21 tests.

12. ~~**`inlineProcessor.ts`** — Handles `rdm:expr` and `rdm:expr⟹result`
    (state machine: unfilled → preview → locked).~~ ✓ Done. Walks rendered
    `<code>` elements, finds `rdm:` patterns, swaps them for a custom
    `<span>` with the result + Lock / Reroll buttons. Locked calls
    display their stored result without re-evaluating. Unfilled calls
    evaluate against the inline scope, cache the result in the
    `PreviewRegistry`, and stay stable across re-renders. 12 tests.

13. ~~**`lockingService.ts`** — Writes preview → locked. Batches writes. Handles
    "lock all in note" and "reroll all in note" commands.~~ ✓ Done. Pure
    text transforms (`applyLockToSource`, `applyUnlockToSource`,
    `transformAllInlineCalls`) plus the in-memory `PreviewRegistry`.
    The actual file writes happen via `vault.process` and `vault.modify`
    from `main.ts` / `inlineProcessor.ts`. 36 tests cover the transforms
    and registry exhaustively — these write to user note content, so
    correctness matters a lot.

14. ~~**`promptUI.ts`** — Renders Prompt: declarations inline.~~ ✓ Done.
    Free-text prompts render as `<input>` (change on blur, not per
    keystroke); options prompts render as `<select>` dropdowns.
    `initialPromptValues` seeds from declared defaults. Wired into
    `codeblockProcessor.ts` — change events trigger re-render. 12 tests.

#### Bridge modules (not in original plan but ended up necessary)

**`asyncPrefetcher.ts`** — The synchronous resolver can't talk to Obsidian's
async Vault directly. Rather than make the entire resolver chain (and 74
existing tests) async, this module walks the Use: graph eagerly with an
async backend (`AsyncFileSource`), fetches every reachable file once, and
hands the synchronous resolver a populated in-memory `FileSource`. 13 tests.

**`vaultFileSource.ts`** — Tiny adapter wrapping Obsidian's `Vault.adapter`
as an `AsyncFileSource`.

### Phase 4 — polish for v0.1.0

15. ~~**Plugin registry collision check** for "Randomness" name.~~ ✓ Done.
    Searched the canonical community-plugins.json (via gitee mirror) for
    `id: "randomness"` and `name: "Randomness"` — no collision. Closest
    hits are "Dice Roller" and "Random Number Generator", different
    purpose. Final word at PR submission; BRAT-only distribution
    remains the safe fallback.

16. ~~**README** — MIT, NBOS attribution, BRAT install instructions,
    examples.~~ ✓ Done. Covers BRAT install, manual install, codeblock
    + inline syntax, sharing across notes via `Use:`, commands,
    settings, security model, MIT + NBOS attribution. `LICENSE` file
    added. Bare-minimum `styles.css` added so the inline UI looks
    intentional rather than naked.

17. ~~**`manifest.json`** — standard Obsidian plugin manifest.~~ ✓ Done.
    Minimal valid shape: id, name, version, minAppVersion (1.4.0),
    description, author, isDesktopOnly=false.

18. ~~**`esbuild.config.mjs`** — bundler config.~~ ✓ Done. Standard
    sample-plugin shape with our entry point (`src/views/main.ts`).
    `npm run build` produces a 46KB minified `main.js` at repo root,
    ready for BRAT or manual install.

19. ~~**`iptView.ts`** — Custom file view for raw `.ipt` files.~~ ✓ Done
    this session. See item #10 above.

20. ~~**Inline "Lock all" should evaluate missing previews first.**~~
    ✓ Done. The command now walks the source, collects unique unfilled
    expressions, evaluates each (using cached previews where available),
    and applies all locks in one atomic `vault.modify`. Failed
    evaluations are counted and surfaced in the notice. Documented
    trade-off: identical-expression occurrences all evaluate to the
    same value (one eval per unique expr); users wanting independent
    rolls per occurrence should scroll first to populate distinct
    previews, then lock-all commits what's visible.

21. ~~**HTML sanitisation for engine output.**~~ ✓ Done. New
    `src/views/sanitiser.ts` parses engine output with the platform's
    HTML parser, walks the tree, drops any tag not in the whitelist
    along with its content, and strips all attributes. Whitelist
    covers what real corpora emit: inline formatting (b, i, u, em,
    strong, br, span, …), block structure (p, div, ul, ol, li, hr,
    blockquote, pre), headings (h1–h6), tables (table, tr, td, th).
    Everything else — `<script>`, `<iframe>`, `<a>`, `onclick`,
    `style`, `<svg onload>` — is dropped. 34 tests cover both
    legitimate formatting and every attack vector I could think of.
    `codeblockProcessor`'s `renderOutput` now routes through
    `setSanitisedHtml` instead of `innerHTML`.

### Outstanding for v0.2 / Phase 5

22. **File-edit invalidation for Use: graph cache.** Currently each
    codeblock render fetches its Use: graph from scratch. Wire to
    `vault.on("modify")` for invalidation.
23. **Inline call occurrence identity under partial re-render.**
    Section-only renders count occurrences within the section's DOM,
    not the whole note. Add a data-attribute carrying the source-level
    occurrence index at render time.
24. **Lock-button should target the specifically clicked occurrence.**
    Currently locks the first unfilled with the same expression; see
    #23 — same fix.
25. **`Use:` paths from generator files don't go through `normalizePath`.**
    Settings input now does (this session); generator-authored Use:
    references could too, though they're already lightly normalised by
    our own `normalisePath` (backslash → forward slash). Low priority
    because IPP3 paths don't typically need Unicode normalisation.

## Known limitations / open questions

- **`[#table]` with no index** uses "current row index of caller" per spec; 
  currently defaults to 1. Low priority — rare in corpus.
- **`{rep}` built-in** is set per top-level rep but not per sub-table call. 
  Matches IPP3 behavior — verified.
- ~~No depth limit on `each` filter recursion~~ — superseded by the
  global `runTable` recursion guard added this session. `each` calls go
  through `runTable` and are counted by `callDepth` like any other table
  call.
- **Forced index out of range** (`[#5 NextTable]` when there are 3 items)
  currently returns null → empty string. May want default or wrap-around 
  behavior; depends on IPP3 spec interpretation.
- **Multi-codeblock notes share a single table namespace** — if a note has
  two `randomness` codeblocks both defining `Table: X`, the second silently
  shadows the first (fileParser keeps the last). Probably fine, but the
  inline UI should at least warn when this happens. Low priority.
- **Resolver doesn't follow Use: from .md files into their _own_ in-note
  codeblocks** — only top-level Use: lines are followed when a .md is the
  target of another file's Use:. Same-note codeblock scoping is only
  triggered by the inline `rdm:` path through `scope.ts`. Likely the
  right behaviour, but worth noting for the UI design.
- **Missing Use: targets throw** rather than warn. The plugin UI should
  catch `ResolveError` and surface a friendly message; the engine itself
  should never see a half-resolved bundle.
- ~~**Generator output is injected via `innerHTML`.**~~ — resolved this
  session; output passes through a tag-whitelist sanitiser before DOM
  attach. The trust model still tells users to only run generators
  they trust, since the whitelist is defence-in-depth.
- ~~**No path normalisation through Obsidian's `normalizePath()`.**~~
  Partially resolved this session. Settings input now routes the user's
  typed Generator-root through `normalizePath`. `Use:` paths from
  generator file bodies still only go through our resolver's lighter
  `normalisePath` (backslash → forward slash, segment cleanup); the
  Unicode-normalisation case is a Phase 5 item if real corpora ever
  need it.
- **No file-edit invalidation yet.** Each codeblock render fetches its
  Use: graph from scratch. Fine perf-wise for small graphs, but a deep
  chain of files re-fetched on every scroll is wasteful. The plugin
  layer should subscribe to `vault.on("modify")` and either invalidate
  a shared cache or re-render dependent codeblocks. Deferred until
  perf actually shows up as a problem.
- **Inline `[email protected]` occurrence identity is best-effort under partial
  re-render.** When Obsidian re-renders only one section of a note (a
  common optimisation), the inline post-processor counts occurrences
  within that section's DOM, not across the whole note. Result: the
  preview cache might double-evaluate the Nth call when N counts
  differently in different render contexts. The cache keys still
  stabilise once the note settles, but the first render after a
  section-only change might do an extra evaluation. Acceptable.
- **`rdm:` separator collision.** If a user puts `⟹` literally
  inside an expression — say `rdm:'a⟹b'` — the parser treats the
  first `⟹` as a lock marker and parses the rest as the locked
  result. This is the same kind of constraint as not allowing
  backticks in code spans. Documented in lockingService source.
- **Lock-button click locks the first unfilled occurrence of the
  expression, not necessarily the one that was clicked.** The DOM
  element doesn't carry enough position information across Obsidian's
  rendering pipeline to identify "this specific one"; we fall back to
  "first unfilled with this expr". For unique expressions this is
  always right; for duplicates it's only wrong when the user clicks
  on the 2nd+ unfilled. A future improvement: store a data-attribute
  with the occurrence index at render time, read it on click.

## Run instructions

```bash
cd /home/claude/randomness
npm install         # one-time setup
npx jest            # run all tests (~1.3s)
npx tsc --noEmit    # strict typecheck
```

Test layout:
- `__tests__/engine/` — pure engine module tests (parser, content, expressions, filters, recursion guard)
- `__tests__/resolver/` — resolver layer (mdExtractor, fileResolver, scope, asyncPrefetcher)
- `__tests__/views/` — Obsidian plugin layer (settings, vaultFileSource, codeblockProcessor) — runs under jsdom via per-file pragma
- `__tests__/integration/corpus.test.ts` — end-to-end against real .ipt files

## Corpus on disk

5 representative files in `corpus/`:
- `Orc Clan Name.ipt` (59 B) — minimal Use:+[@] test
- `Common Place names.ipt` (1.9 KB) — 7+ tables, weighted, lookup with ranges
- `Spell Book.ipt` (884 B) — Define: with dice, deck picks, HTML output
- `Picked Pockets.ipt` (1.5 KB) — inline picks, `\a`/`\z` escapes (truncated; 
  see Drive for full version)
- `Random Treasure CR1-CR30.ipt` (2.1 KB) — the stress test: prompts, 
  conditionals, math, recursion, filter chains
