# Migrating from Dice Roller

Randomness now does everything Dice Roller did — same syntax, same
notes, plus locks, generators, and more. Migration is three steps and
your notes don't change at all.

## The three steps

1. **Disable Dice Roller** (Settings → Community plugins).
2. **Install/update Randomness** and enable it.
3. That's it. Randomness detects that Dice Roller is gone and turns
   on **Dice Roller compatibility** automatically — every `dice:`
   span in your vault renders through the Randomness engine. (The
   toggle lives in Settings → Randomness if you ever want it off.)

## What works identically

| You wrote | Still works |
| --- | --- |
| `dice: 1d20 + 5` | ✅ full arithmetic, parens, exponents |
| `dice: 4d6dl1`, `2d20kh`, `!`, `!!`, `r`, `s`, `u` | ✅ all modifiers |
| `dice: 3d6>=5` | ✅ success counting, Dice Roller semantics |
| `dice: d20`, `dice: 3d` | ✅ omitted-value defaults (1 roll / d100) |
| `dice: d%`, `1d66%`, `4dF`, `1d[3,5]` | ✅ special dice |
| `dice: [[Note^block-id]]` (+ `3[[…]]`, `1d4+1[[…]]`) | ✅ table & list rolls |
| `dice: [[Note^id]]\|Header`, `\|xy` | ✅ column / cell picks |
| `dice: [[Note]]`, `dice: [[Note]]\|line` | ✅ random block / line |
| `dice: #tag`, `#tag\|-`, `#tag\|link` | ✅ tag rolls — **no Dataview needed** |
| Saved formulas | ✅ paste them into Settings → Randomness → Dice formula aliases |
| `dice-mod:` | ✅ writes the roll into the note on first render |
| `dice+:` / `dice-:` | ✅ accepted; locks replace result-saving (below) |
| `\|text(…)`, `\|form` | ✅ honoured |
| Dice View | ✅ the dice tray (dices ribbon icon) — plus a formula box that takes tables, tags, and aliases |
| Graphical dice | ✅ a built-in dice animation (Settings → Randomness → Graphical dice); `\|render` honoured for plain dice formulas |

## What's better

- **Locks replace result saving.** Dice Roller's saved results lived
  in plugin state and were lost when a note changed outside Obsidian.
  Randomness writes the result into the note itself:
  `` `dice: 1d20+5⟹17` `` — visible in the source, survives sync,
  one click (🔒) to commit, one (🎲) to re-roll.
- **Tag rolls don't need Dataview.** Obsidian's own metadata cache
  drives them (frontmatter and inline tags, nested tags included).
- **Repetition on wikilink rolls** works inline: `dice: 3[[Note^id]]`.
- **The whole generator engine** is on tap: weighted tables, lookup
  tables, prompts, filters, deck picks, portraits, and a JS API. When
  you outgrow a markdown table, `.rdm` files are waiting.

## What's different

- **`3d6>=5` in the `rdm:` prefix** means "is the sum ≥ 5" (IPP3
  semantics). Success counting there uses an explicit marker:
  `rdm:{3d6cs>=5}`. Your `dice:` spans keep Dice Roller semantics.
- **Block-type filters** (`|paragraph`, `|heading-2`, …) approximate
  to a random block for now.
- **`#tag|+`** (one result from every tagged file) isn't supported
  yet; `#tag` rolls one result from one random tagged note.
- **Stunt (`dS`) and Genesys narrative dice** aren't supported yet —
  they render a clear error, never a wrong number.
- **Graphical dice** are a built-in animation of the engine's roll,
  not a physics simulation — results are always the engine's, so
  seeds and locks stay exact.

## FAQ

**Do I have to edit my notes?** No. `dice:` spans keep working as
written, and locking preserves your prefix.

**Can I keep both plugins installed?** Installed yes, enabled no —
both would process the same spans. The compatibility toggle warns if
it's on while Dice Roller is enabled.

**Where did "Globally save results" go?** Use locks: the 🔒 button on
any span, or the "Lock all rdm: in current note" command.

**What about the Dice Roller JS API?** Randomness has its own richer
API (`app.plugins.plugins["randomness"].api` — see API.md). A
`getRoller`-style compat shim is on the roadmap; if a plugin you use
consumes Dice Roller's API, open an issue so we can prioritise it.
