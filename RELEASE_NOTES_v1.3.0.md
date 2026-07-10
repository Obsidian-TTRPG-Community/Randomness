# Randomness 1.3.0 — the Dice Roller merge

Dice Roller has moved in. Every capability of the
[Dice Roller](https://github.com/Obsidian-TTRPG-Community/dice-roller)
plugin now lives in Randomness — same syntax, one engine, actively
maintained — plus a few things Dice Roller never had. If you're
coming from Dice Roller: disable it, enable Randomness, and your
notes keep working unchanged
([migration guide](docs/migrating-from-dice-roller.md)).

## Dice, everywhere the engine rolls

Full modifier grammar in `{…}` expressions — codeblocks, inline,
JS API: keep/drop (`4d6dl1`, `2d20kh`), exploding (`!`, `!!`, `!i`),
re-rolls (`r`, `ri`), sort, unique, success counting (`6d6cs>=5`,
`-=1` for negatives), conditional modifiers (`1d6!i=!3`), percentile
`d%`, Traveller `d66%`, Fudge `dF`, custom face ranges `d[3,5]`.

## Your notes are rollable

Any markdown table or list with a `^block-id` is a table the engine
can roll: inline `` `rdm:[[Note^loot]]` `` (with lock/re-roll
buttons), from codeblocks via `Use: [[Note]]` + `[@loot]`, column
picks (`|Header`, `|xy`), markdown lookup tables (`dice: 1d20`
header + ranges), repetitions (`3[[Note^loot]]`), and nested rollers
inside cells. Whole-note rolls too: `[[Note|line]]`, `[[Note|block]]`,
and tag rolls `#tag` / `#tag|link` — backed by Obsidian's metadata
cache, **no Dataview required**. Wikilinks resolve exactly like
Obsidian links.

## `dice:` compatibility

The complete Dice Roller inline surface — `dice:`, `dice+:`,
`dice-:`, `dice-mod:` — with Dice Roller's own semantics (bare
`3d6>=5` counts successes; `d20`/`3d` defaults). Formula aliases in
settings, `|text(…)` and `|form` honoured, `dice-mod:` writes its
roll into the note on first render. Turns on automatically when the
Dice Roller plugin isn't enabled. Locks (`⟹`) replace Dice Roller's
fragile result saving: results live in the note, survive sync, and
re-roll on demand.

## Dice tray & graphical dice

A sidebar dice tray (dices ribbon icon): build a pool from d4–d100
buttons, advantage/disadvantage, modifier stepper, a formula box that
accepts everything above (tables, tags, aliases), saved formulas
(shared with the alias setting), and click-to-re-roll history.
Graphical dice animate rolls — a tumbling cube for d6s, spinning
polyhedra for the rest — as pure decoration on top of the engine's
result, so seeds and locks stay exact.

## Engine improvements along the way

Self-`Use:` imports are a silent no-op (no more cycle errors when a
note references itself), a note's own tables are in scope for its
inline calls with no `Use:` line, and bare `` `rdm:` ``/`` `dice:` ``
mentions in prose stay literal instead of erroring.

## Compatibility

IPP3/`.ipt` semantics are untouched: bare comparisons still compare
sums (`cs` is the explicit success marker), unmodified `NdN` rolls
consume the RNG stream identically (seeded generators reproduce
exactly), and the full community corpus passes unchanged. Not yet
ported: Fantasy AGE stunt dice, Genesys narrative dice, `#tag|+`,
true block-type filters, and Dataview inline fields in formulas —
all error clearly rather than guessing.

---

*Dice mechanics and syntax ported from
[@javalent/dice-roller](https://github.com/Obsidian-TTRPG-Community/dice-roller)
(MIT, © Jeremy Valentine). Thank you, Jeremy.*
