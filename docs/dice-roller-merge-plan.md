# Dice Roller → Randomness merge plan

**Status:** All phases (1–7) implemented (Unreleased). Release as
1.3.0 (notes drafted in RELEASE_NOTES_v1.3.0.md), then execute
docs/retirement/dice-roller-retirement-kit.md.

- *Phase 1* — modifiers, conditions via `cs`, and special dice live in
  `src/engine/dice.ts`. Stunt (`dS`) and Genesys narrative dice deferred
  to Phase 3: their results are symbols and stunt-point displays, not
  numbers, so they belong with the `dice:` compat display layer rather
  than the numeric expression grammar.
- *Phase 2* — markdown tables and lists with `^block-id`s are rollable
  via `src/resolver/mdContent.ts`: `Use: [[Note]]` imports, direct
  `rdm:[[Note^id]]` inline calls, `|Header`/`|xy` column picks, and
  markdown lookup tables. Deferred within Phase 2: section/`|line`
  rollers (want Obsidian's metadata cache — revisit alongside tag
  rollers in Phase 4) and Obsidian-style shortest-path wikilink
  resolution (wikilinks currently resolve like `Use:` paths; wiring
  `metadataCache.getFirstLinkpathDest` into the plugin-side
  `basenameResolver` is the natural follow-up).
- *Phase 3 (complete)* — `dice:`/`dice+:`/`dice-:`/`dice-mod:`
  inline spans route through the engine via `src/compat/diceCompat.ts`
  translation, behind the "Dice Roller compatibility" settings toggle
  (smart default: on when Dice Roller is absent). Formula aliases come
  from settings (`diceFormulas`), `|text(…)`/`|form` are honoured, and
  `dice-mod:` auto-writes via a lock on first render. `|render` is
  honoured by Phase 6; still inert: `|nodice`, `|avg`, `|none`.

- *Phase 4* — whole-note line/block rolls (`[[Note|line]]`,
  `[[Note|block]]`, hidden `__lines:`/`__blocks:` tables built by
  `parseFileSource`) and tag rolls (`#tag`, `#tag|link`) backed by
  Obsidian's metadata cache — **no Dataview dependency**, one better
  than Dice Roller. Wikilinks also resolve via
  `metadataCache.getFirstLinkpathDest` now. Remaining from the original
  Phase 4 scope: Dataview inline fields in formulas (`1d6 + field`),
  the every-file tag mode (`#tag|+`), and true block-type filters
  (currently approximated to the block roll).
- *Phase 5* — dice tray (`src/views/diceTrayView.ts`): plain-TS
  sidebar view with die-pool buttons, advantage/disadvantage,
  modifier stepper, a free formula box speaking the full compat
  syntax, saved formulas (same store as `diceFormulas` aliases), and
  a click-to-re-roll history. No Svelte.
- *Phase 6* — graphical dice (`src/render3d/diceOverlay.ts`), with a
  deliberate design change from the original plan: the three.js +
  cannon-es port was REJECTED. Obsidian plugins are single-file CJS
  bundles, so esbuild cannot code-split — the "lazy-loaded chunk"
  premise was impossible, and bundling would have ~5×'d main.js with
  physics code whose results fight the engine's (in Dice Roller the
  physics decided the roll). Instead: a dependency-free CSS-3D
  overlay that animates the ENGINE's values (cube for d6, shaped
  chips + number-cycle for the rest, keep/drop dimming, total
  badge). The module boundary is "show these dice values", so a
  photoreal backend can still be swapped in later. Wired to the
  tray and the `|render` flag, gated by the `graphicalDice` setting.
- *Phase 7* — migration guide (`docs/migrating-from-dice-roller.md`),
  retirement kit (`docs/retirement/dice-roller-retirement-kit.md`:
  README banner, final release notes, deprecation-Notice patch,
  archival checklist), and 1.3.0 release notes draft
  (`RELEASE_NOTES_v1.3.0.md`). Remaining judgement call for release
  time: a `getRoller` API compat shim if plugins in the wild consume
  Dice Roller's JS API.

**Goal:** Absorb all Dice Roller functionality into Randomness, then retire
Dice Roller. Support the legacy `dice:` syntax with full compatibility so
existing notes render unchanged, while `rdm:` gains every capability.

## Background

We maintain both plugins. Dice Roller (v11.4.2, `@javalent/dice-roller`,
MIT) provides inline dice with modifiers, vault-content rolling (markdown
tables, sections, lines, tags), a dice tray view, and 3D graphical dice.
Randomness provides the generator grammar (`.rdm`/`.ipt`), locks, prompts,
filters, auto-discovery, portraits, and a JS API. Feature overlap is small;
audience overlap is near-total.

## Architecture decision: one dice core, two syntaxes

There must be exactly **one** implementation of dice mechanics.
`dice:` and `rdm:` are front-end syntaxes over the same engine.

- Port Dice Roller's modifier/condition logic (its `rollers/dice/` stack is
  battle-tested) into `src/engine/` as the canonical dice core.
- `expressions.ts` (`{NdN}` grammar) calls into the core, so codeblocks,
  inline `rdm:`, inline `dice:`, and the JS API all share behaviour.
- Port the moo-based lexer (`src/lexer/lexer.ts`, 322 lines) as the
  **compat parser** for `dice:` strings; it produces the same AST the core
  consumes.

### Source disposition

| Dice Roller module | Action |
| --- | --- |
| `lexer/` (moo) | Port as `dice:` compat parser (adds `moo` dep) |
| `rollers/dice/*` (modifiers, fudge, percent, stunt, narrative) | Port into engine core |
| `rollers/table|section|line|tag` | Reimplement on `src/resolver/` (extend `mdExtractor.ts`) — gains locks/filters/reps for free |
| `renderer/` (three.js + cannon-es, ~1k lines) | Port as **lazy-loaded** module; deps excluded from main bundle |
| `view/DiceTray.svelte` | Rewrite in plain TS/DOM (Randomness has no Svelte and shouldn't gain it) |
| `processor/` | Discard — route through existing `inlineProcessor.ts` / `codeblockProcessor.ts` |
| Result saving / `dice-mod` | Superseded by locks (`⟹`) |
| Genesys glyph fonts (`assets/`) | Port with narrative dice |
| Settings | Merge into Randomness settings under a "Dice" section |

## Phases

### Phase 1 — Dice core: modifiers & special dice

`kh`/`kl`/`dh`/`dl`, explode `!`/`!!` (with `i` and count), reroll `r`/`ri`,
sort `s`/`sd`, unique `u`, min/max faces `d[Y,Z]`, dice conditions
(`>=`, `=!`, `-=` success counting), conditional modifiers (chainable),
percentile `d%` and custom percent (`d66%`), Fudge `dF`, stunt `dS`,
Genesys/SWRPG narrative dice, exponents.

Exposed in the `rdm` grammar inside `{…}`: `{4d6dl1}`, `{2d20kh}`,
`{1d20>=15}`. **Gate:** full `.ipt` corpus passes unchanged — `!`, `%`,
and comparison tokens must not break existing generators.

### Phase 2 — Vault-content rollers

Markdown tables via `[[Note^block-id]]` (multi-header `|Header`, lookup
tables, `|xy` cell picks, nested rollers in cells), lists, `|line`,
section/block rollers with block-type filters. Implemented as a new table
source in `src/resolver/` so `[@…]` calls, repetitions, filters, and locks
all apply. `rdm:` syntax proposal: `rdm:[[Note^id]]` mirrors `dice:` form.

### Phase 3 — `dice:` full-compat surface

- Register `dice:` (and `dice+:`, `dice-:`, `dice-mod:`) inline/codeblock
  prefixes alongside `rdm:` via `INLINE_PREFIX` generalisation.
- Full syntax: all flags (`|render`, `|norender`, `|avg`, `|none`,
  `|text(…)`, `|form`/`|noform`, `|nodice`), wikilink/tag rollers, formula
  aliases from settings.
- `dice-mod:` maps to an immediate lock (same semantics, more robust).
- **Coexistence guard:** compat prefix defaults **off**; enabling it while
  the Dice Roller plugin is active shows a warning Notice.

### Phase 4 — Tag rollers & Dataview integration

Tag rollers (`#tag`, `|-`/`|+`, `|link`) and Dataview inline fields in
formulas (`1d6 + field`). Dataview is an **optional** dependency: features
degrade with a clear message when it's absent.

### Phase 5 — Dice View tray

Plain-TS rewrite of the Svelte tray: d20 set buttons,
advantage/disadvantage, modifier stepper, formula box, saved formulas.
Lives beside the generator browser; command + ribbon entry.

### Phase 6 — 3D graphical dice

Port `renderer/` with `three` + `cannon-es` as lazy-loaded chunk
(dynamic import on first `|render` or tray graphic roll). Bundle-size
budget for the main chunk: no regression.

### Phase 7 — Migration & retirement

1. Randomness release notes + migration guide (`docs/migrating-from-dice-roller.md`).
2. Final Dice Roller release: README banner + in-app Notice pointing to
   Randomness; then archive the repo.
3. Community plugin listing updated; BRAT users notified via release notes.
4. Keep `dice:` compat permanently — it *is* the migration st