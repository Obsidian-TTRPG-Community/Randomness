# Randomness

An [Obsidian](https://obsidian.md) plugin for random generators — tables,
dice, NPC portraits, and whole-location templates. Generators are plain-text
`.rdm` files; legacy `.ipt` files load identically.

Roll on tables inline with `` `rdm:[@Names]` ``, embed full generators in
````randomness```` codeblocks, and re-use existing `.ipt` files from twenty
years of the Inspiration Pad
ecosystem.

## Features

- **`randomness` codeblocks** — embed a generator directly in a note. Rolls
  every render; supports the full grammar including weighted tables,
  lookup tables, deck picks, conditionals, dice, expressions, and 21 filters.
- **Inline `rdm:` calls** — one-shot rolls scattered through your prose.
  Preview first, then click 🔒 to commit the result as
  `` `rdm:[@Names]⟹Alice` `` — the lock survives reloads, syncs, and
  reopening the vault. Click 🎲 to re-roll.
- **`Use:` other files** — share table libraries across notes. Reference
  `.ipt` files or `.md` notes containing `randomness` codeblocks; resolution
  follows the calling note's folder first, then a configurable generator root.
- **Auto-discovery by table name** — reference a table by name
  (`` `rdm:[@TavernName]` `` or `[@TavernName]` in a codeblock) with no
  `Use:` line, and the plugin finds the `.rdm`/`.ipt` file that defines it
  anywhere under your Generator root — pulling it in automatically, and
  following that file's own `Use:` graph. Anything you define locally or
  import with `Use:` always wins, so discovery can never shadow your own
  tables.
- **Prompts** — generators that declare `Prompt:` controls render dropdowns
  or text inputs above the output; changing a value re-rolls with the new
  prompt set.
- **Deterministic when you want it** — every codeblock can be configured to
  use a stable seed (off by default), so the same source at the same
  location produces the same roll on every render. Locks remain the
  strongest guarantee.
- **Generator browser pane** — a right-sidebar view that displays
  every `.ipt` file in your configured Generator root (or whole
  vault) as a collapsible folder tree mirroring your vault's
  structure. Click a folder or file chevron to expand; click any
  table's **Roll** button to generate a result, or **📋** to copy
  an inline `rdm:` reference for that table to your clipboard
  (paste into prose; the Notice shows the `Use:` line you'll need
  to add to your note). Click the result body to copy the rendered
  text. The tree starts fully collapsed and remembers what you
  expand across sessions. A "Collapse all" button resets the tree
  without clearing your search filter, so collapse-then-filter is a
  fast way to find a specific generator in a deep folder hierarchy.
  Open via the dice ribbon icon or the "Open generator browser"
  command.
- **Existing `.ipt` files work as-is.** The engine survives the full
  AddCommas/Random-Treasure-CR1-CR30 community stress-test corpus.
- **JavaScript API** — roll generators from other plugins or Templater
  scripts via `app.plugins.plugins["randomness"].api`. Scoped and
  unscoped rolls, prompt overrides, deterministic seeds, and a roll
  event stream. Ideal for generating notes from a shared generator
  library. See [API.md](API.md).

## Install

### Via BRAT (recommended while in beta)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin if you don't have it.
2. Open BRAT settings → Add Beta Plugin → enter this repo's URL.
3. Enable "Randomness" under Community Plugins.

### Manually

1. Download `main.js`, `manifest.json` (and `styles.css` if present) from the
   latest [release](../../releases).
2. Copy them into `.obsidian/plugins/randomness/` inside your vault.
3. Enable "Randomness" under Settings → Community Plugins.

## Usage

### Codeblocks

````markdown
```randomness
Table: Settlement
Riverbend
Stonewatch
Greenhollow
```
````

Renders to one of "Riverbend", "Stonewatch", or "Greenhollow", chosen at
random each time the codeblock renders.

Use the full grammar — multiple tables, weighted entries, lookup
tables, `Set:`/`Define:`, prompts, conditionals, dice expressions, filters,
the lot:

````markdown
```randomness
Prompt: Tier {Easy|Normal|Hard}Normal
Table: Encounter
1: A single goblin scout.
2: [@Group] goblins.
6: A goblin chieftain with [1d4+2] {$prompt1} guards.

Table: Group
1-3: small group of {2d4}
4-6: warband of {3d6}
```
````

The dropdown for `Tier` appears above the result; changing it re-rolls.

### Inline `rdm:`

Anywhere in your prose, wrap an expression in backticks with the `rdm:`
prefix:

```markdown
The shopkeeper, a `rdm:[@Names]` from `rdm:[@Origin]`, eyed me suspiciously.
```

Each `` `rdm:...` `` renders inline with a preview, plus 🔒 (lock) and 🎲
(re-roll) buttons. Clicking 🔒 rewrites the underlying text to include the
chosen result:

```markdown
The shopkeeper, a `rdm:[@Names]⟹Tessith Vone` from `rdm:[@Origin]⟹Coppertown`, eyed me suspiciously.
```

The lock survives reloads, sync, and reopening the vault. To re-roll a
locked call, click 🎲 — it strips the lock and shows a fresh preview.

The expression's scope sees same-note `randomness` codeblocks plus any
`Use:` declarations from those blocks, and falls back to auto-discovery
(any table defined in a generator file under your Generator root), so you
can keep table definitions alongside the prose or in a shared library —
whichever you prefer.

### Sharing tables across notes

In a shared `.ipt` file (e.g. `Generators/common-names.ipt`):

```
Table: Names
Tessith Vone
Korad the Blue
Mira Thornhaven
```

In any note's codeblock:

````markdown
```randomness
Use:common-names.ipt
Table: NPC
{1d2=1, A man named, A woman named} [@Names].
```
````

`Use:` paths resolve relative to the current note's folder first, then
relative to the **Generator root** configured in Settings → Randomness.

#### Or skip `Use:` entirely

If the generator file lives under your **Generator root**, you can drop
the `Use:` line and just reference the table by name — Randomness finds
the file that defines it for you:

````markdown
```randomness
[@Names]
```
````

This works the same way in inline `rdm:` calls. It's a convenience layer
on top of `Use:`: only files under the Generator root are searched, and
anything you define locally or import with `Use:` takes precedence over a
discovered table. Reach for an explicit `Use:` when you want an
unambiguous reference — for instance when two files define a table with
the same name.

### Commands

- **Lock all unfilled `rdm:` in current note** — evaluates every unfilled
  inline call (using cached previews where available, fresh evaluations
  otherwise) and writes all locks in one atomic save.
- **Reroll all `rdm:` in current note** — strips every lock and clears
  cached previews. The next render shows fresh previews everywhere.
- **Rebuild generator index** — rescans the vault for generator files.
  Run this after adding or renaming generator files if auto-discovery,
  the JS API's `rollUnscoped`, or bare-filename `Use:` resolution looks
  stale.

## Scripting: the JS API

Randomness exposes a JavaScript API for other plugins and for
[Templater](https://github.com/SilentVoid13/Templater) scripts, so you
can roll generators from code — for example, to populate a freshly
created note from a shared generator library.

```js
const api = app.plugins.plugins["randomness"].api;

// Roll a generator found anywhere in the vault (ignores note scope):
const r = await api.rollUnscoped("VillainName");
console.log(r.result); // -> "Mordred the Pale"
```

The two rolls you'll use most:

- **`roll(name, opts?)`** — rolls a table **in note scope** (sees the
  note's same-note codeblocks and `Use:` imports). Use it when rolling
  from the context of a specific note.
- **`rollUnscoped(name, opts?)`** — rolls a table found **anywhere in
  the vault**, ignoring scope. Use it for automation and note
  generation, where there's no scope wired up yet — e.g. a Templater
  template that builds a note from your shared generators.

Both accept `promptValues` (override a generator's prompts by label) and
`seed` (deterministic rolls). `rollUnscoped` also accepts `filePath` to
disambiguate when two files define the same table name.

```js
// Pass values into a generator's prompts, by label:
const inn = await api.rollUnscoped("TF-Inn", {
  promptValues: { town: "Frostkey", shopName: "The Salty Anchor" },
});
```

**Full reference, including every method, option, the `RollResult`
shape, collision handling, and recipes: see [API.md](API.md).**

## Settings

- **Generator root** — vault-relative folder used as the fallback for
  `Use:` paths that don't resolve next to the calling note.
- **Default formatting** — `HTML (rich)` to enable bold/italic/list
  filters as visual formatting; `Plain text` to keep them as plain
  characters. Individual generators can override via the `Formatting:`
  directive.
- **Stable codeblock seeds** — when on, codeblocks render the same result
  across reloads (until you reroll). Useful for keeping a generator
  "settled" without committing to a specific lock. Off by default.

## Where inline `rdm:` calls work

Inline `rdm:` calls render in **Reading view** only. Obsidian's
**Live Preview** uses a different rendering pipeline (CodeMirror 6
extensions, not markdown post-processors), and the plugin doesn't
have a CM6 extension yet. In Live Preview the inline calls show as
plain code spans — locks in the source survive, but the 🔒/🎲
buttons don't appear.

Workflow recommendation: author your prose in Live Preview, switch
to Reading view (Ctrl/Cmd-E or the read-eye icon) to roll/lock
inline calls. Locks written from Reading view show up in Live
Preview's underlying source immediately.

Codeblock generators (`` ```randomness ``) work in both views —
those use the codeblock processor, which Live Preview does handle.

## Security

The plugin's HTML output passes through a tag whitelist before being
attached to the DOM. Allowed tags: structural (p, div, ul, ol, li, hr,
blockquote, pre, h1–h6), inline formatting (b, i, u, em, strong, s, code,
br, span, and a few others), and tables. All attributes are stripped.
Anything outside the whitelist — `<script>`, `<iframe>`, `<a>`, event
handlers like `onclick` — is dropped along with its content.

**You should still only use generators you trust.** The whitelist is
defence-in-depth, not a free pass to run arbitrary `.ipt` files from
strangers.

## Attribution

This plugin is MIT-licensed (see [LICENSE](LICENSE)).

**Lineage.** The `.rdm` format grew out of the Inspiration Pad Pro 3
(`.ipt`) grammar by [NBOS Software](https://nbos.com) — credit where it's
due, and `.ipt` files still load identically so generators written in
2008 keep rolling today. Randomness has since grown well past the
original grammar (portraits, prompt variables, locked rolls, note
scoping, a scripting API) and `.rdm` is its native format going forward.

Generator content (`.ipt` files) from the wider community remains the
copyright of its original authors and is governed by whatever licenses
those authors chose. The plugin does not include or distribute generator
content; the corpus shipped in the dev repo is for testing only.

## Development

Pure-TypeScript engine and resolver, no Obsidian imports outside
`src/views/`. The test suite runs against in-memory file sources and
jsdom for DOM testing — no Obsidian instance required to develop.

```bash
npm install         # one-time setup
npm test            # run the full suite (~2s, 459 tests)
npx tsc --noEmit    # strict typecheck
npm run build       # bundle for distribution
npm run dev         # watch mode
```

Architecture in three layers:

- **Engine** (`src/engine/`) — pure generator evaluator. AST, parsers,
  expression evaluator with seedable PRNG, 21 filters, recursion guard.
- **Resolver** (`src/resolver/`) — `Use:` graph traversal,
  markdown-codeblock extraction, inline scope assembly. Synchronous;
  async backend via `asyncPrefetcher`.
- **Views** (`src/views/`) — the only layer that imports Obsidian.
  Codeblock processor, inline processor, settings, lock/reroll state
  machine, prompt UI, HTML sanitiser.

See `STATUS.md` for the full design log including bugs found and fixed,
trade-offs accepted, and outstanding items.
