# 08 - Coming From Dice Roller

Used the Dice Roller plugin? Almost everything you wrote still
works, exactly as written — Randomness speaks its language.

1. Disable Dice Roller (Settings → Community plugins).
2. Make sure Randomness is enabled.
3. Your `dice:` rolls, table rolls and tag rolls all keep
   working — you don't have to touch a single note.

Try some classic Dice Roller rolls — these are live, click them:

- `dice: 1d20 + 5` — plain rolls
- `dice: 4d6dl1` — modifiers
- `dice: 3d6>=5` — success counting

## One thing you do have to bring across

Your **saved formulas** don't come over by themselves. If you
gave a roll a nickname in Dice Roller, open **Settings →
Randomness → Dice formula aliases** and paste your list in, one
`nickname = formula` per line:

```text
sneak = 4d6dl1
adv = 2d20kh
```

Until you do that, any roll that used a nickname comes out blank.
Afterwards they roll exactly as they used to.

## Your other kinds of roll

```text
`dice-mod: 2d6 * 10`      rolls once, leaves plain text behind
`dice+: 1d20`             accepted (the 🔒 lock does the saving now)
`dice-: 1d20`             accepted too
`dice: [[Loot^gems]]`     roll on a table in another note
`dice: 3[[Loot^gems]]`    three of them
`dice: #rumour`           a random note tagged #rumour
`dice: #rumour|link`      a link to one instead
```

The little display switches on the end — `|form`, `|nodice`,
`|render`, `|text(…)` — all carry over unchanged.

Missing the Dice View panel? It's the **Dice** tab in the sidebar
now: press Ctrl/Cmd+P and run **"Open dice tray"**.

If you use **Fantasy Statblocks**, its attack and damage dice
keep rolling too. Randomness stands in for Dice Roller
automatically once you've turned that plugin off.

## One difference worth knowing

Your old `dice:` rolls keep the meaning they always had, so
nothing in your vault changes. Just don't assume the two prefixes
agree: `dice: 3d6>=5` counts how many dice showed 5 or more, while
`rdm:3d6>=5` asks whether the *total* is 5 or more. The reference
spells this out under *Dice modifiers*.

## What you gain by switching

- **The 🔒 lock.** A result you like gets written into the note
  itself, so it's still there tomorrow. Dice Roller kept saved
  results in its own hidden file, and they went missing.
- **Tag rolls with nothing else installed.** Dice Roller needed
  the Dataview plugin for those. This one doesn't.
- **The whole generator engine.** Everything in chapters 05 and
  06 — tables, weights, variables — is waiting whenever you want
  it.

## A few things aren't ported

Fantasy AGE stunt dice (`dS`) and `#tag|+` (one result from every
tagged note) say so plainly when you roll them. Genesys narrative
dice don't: most of them just error, but `1ds` quietly rolls a
d100 and hands back a number that looks perfectly fine. Convert
Genesys pools by hand rather than trusting a result.

Want the whole story, including the handful of other things that
work a little differently now? It's here:
[The full switching guide](https://github.com/Obsidian-TTRPG-Community/Randomness/blob/main/docs/migrating-from-dice-roller.md)

Next: [[09 - Going Further]]
