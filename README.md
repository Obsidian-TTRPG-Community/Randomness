# Randomness

Dice, random tables, and full random generators for
[Obsidian](https://obsidian.md) — built for TTRPGs and creative
writing, simple enough for anyone.

Roll dice in a sentence. Turn any markdown table into a rollable
table. Lock the results you like into your notes forever. And when
you outgrow that, a complete generator engine (the Inspiration Pad
Pro format — twenty years of community tables load as-is) is
underneath.

**Randomness has absorbed the
[Dice Roller](https://github.com/Obsidian-TTRPG-Community/dice-roller)
plugin.** Every `dice:` roll, table roll, and tag roll keeps
working — see [migrating from Dice Roller](docs/migrating-from-dice-roller.md).

## The 30-second tour

Roll dice anywhere:

```markdown
The goblin hits you for `dice: 2d6 + 3` damage.
Stats: `dice: 4d6dl1` — advantage: `dice: 2d20kh` — hits: `dice: 6d6>=5`
```

Turn a markdown table into a rollable one by naming it:

```markdown
| Tavern |
| ------ |
| The Prancing Pony |
| The Drunken Goblin |

^taverns

Tonight you drink at `rdm:[@taverns]`.
```

Every roll gets 🎲 (re-roll) and 🔒 (**lock** — the result is
written into your note itself, surviving reloads and sync):

```markdown
Tonight you drink at `rdm:[@taverns]⟹The Drunken Goblin`.
```

## Features

- **Dice** — the full grammar: modifiers (`4d6dl1`, `2d20kh`,
  exploding `!`, re-rolls `r`, success counting `6d6>=5`),
  percentile, Fate/Fudge, d66, custom face ranges. A sidebar
  **dice tray** with pool buttons, advantage/disadvantage, and
  saved formulas. Optional tumbling **dice animations**.
- **Roll your notes** — markdown tables (with column picks and
  dice-lookup rows), lists, random lines or paragraphs from any
  note, and random `#tagged` notes — no Dataview required.
- **Locks** — results are committed into the note text, not
  plugin state, so they survive sync and outside edits.
  `dice-mod:` locks itself on first render.
- **Dice Roller compatibility** — `dice:`, `dice+:`, `dice-:`,
  and `dice-mod:` spans work with Dice Roller's own semantics,
  plus formula aliases and the `|text(…)`/`|form`/`|render`
  flags. Turns on automatically when the Dice Roller plugin
  isn't running.
- **Generator files** — plain-text `.rdm` files (legacy `.ipt`
  loads identically): weighted tables, lookup tables,
  dictionaries, deck picks, variables, conditionals, prompts
  (dropdowns above the output), 21 filters, dice everywhere, and
  tables calling tables — rollers all the way down. The engine
  survives the full community stress-test corpus.
- **Zero-friction sharing** — `Use:` other files or notes
  (wikilinks resolve like Obsidian links), auto-discovery of
  tables by name under your Generator root, and autocomplete
  that adds imports for you.
- **Generator browser** — a sidebar pane with every generator in
  your vault: roll, copy an inline call, pin favourites. Tabs
  for **Portraits** (layered character faces with rolled names,
  via a one-click art pack), a portrait **Builder**, and the
  **Dice** tray.
- **Scripting API** — roll tables from Templater/DataviewJS,
  seeded and prompt-controlled, plus portrait generation. See
  [API.md](API.md).

## Install

1. In Obsidian: Settings → Community plugins → Browse →
   "Randomness" → Install, then Enable.
2. Or manually: download `main.js`, `manifest.json`, and
   `styles.css` from the latest [release](../../releases) into
   `.obsidian/plugins/randomness/`.

## Learn it in ten minutes

Open **Settings → Randomness** and click **Install the guide**.
You get a small folder of notes — one per feature, every example
live and rollable — starting from "roll a die" and ending at
generator files. Also on that settings page:

- **Open reference** — the complete syntax reference as a
  searchable note.
- **Add examples** — five commented starter `.rdm` generators.

And the **"Create new generator file"** command makes and opens a
starter `.rdm` for you — no fighting with hidden file extensions.

## For Dice Roller users

Disable Dice Roller, enable Randomness, done — your notes don't
change. The [migration guide](docs/migrating-from-dice-roller.md)
has the full compatibility table and the short list of things that
work differently (mostly better: locks instead of fragile result
saving, tag rolls without Dataview).

## Generator content & licensing

`.rdm`/`.ipt` generators you download from the community keep
whatever licence their authors chose. The plugin does not include
or distribute generator content; the corpus in the dev repo is for
testing only.

## Development

Pure-TypeScript engine and resolver, no Obsidian imports outside
`src/views/`. The test suite runs against in-memory file sources
and jsdom — no Obsidian instance required to develop.

```bash
npm install         # one-time setup
npm test            # run the full suite (1,100+ tests)
npx tsc --noEmit    # strict typecheck
npm run build       # bundle for distribution
npm run dev         # watch mode
```

Architecture in four layers:

- **Engine** (`src/engine/`) — pure generator evaluator: AST,
  parsers, dice core with the full modifier grammar, expression
  evaluator with seedable PRNG, 21 filters, recursion guard.
- **Resolver** (`src/resolver/`) — `Use:` graph traversal,
  markdown table/list/line/block extraction, inline scope
  assembly. Synchronous; async backend via `asyncPrefetcher`.
- **Compat** (`src/compat/`) — the Dice Roller syntax translator.
- **Views** (`src/views/`) — the only layer that imports
  Obsidian: codeblock and inline processors, dice tray, browser
  pane, settings, lock/reroll state machine, sanitiser.

Docs sources of truth: `docs/reference.md` (→ `npm run
embed-reference`) and `docs/guide/` (→ `npm run embed-guide`).
See `STATUS.md` for the design log and
`docs/dice-roller-merge-plan.md` for the merge architecture.

## Credits

Dice mechanics and the `dice:` syntax come from
[@javalent/dice-roller](https://github.com/Obsidian-TTRPG-Community/dice-roller)
(MIT, © Jeremy Valentine) — thank you, Jeremy. The generator
grammar implements the Inspiration Pad Pro format; thanks to the
NBOS community for twenty years of tables.
