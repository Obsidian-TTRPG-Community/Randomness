# 01 - Roll Some Dice

Everything on this page is really rolling right now. Click 🎲 next
to any answer for a new one, or 🔒 to keep the one you've got.

(Still got the old **Dice Roller** plugin switched on? Turn it off
first — Settings → Community plugins. While it's on, it grabs these
`dice:` rolls and the settings below won't do anything.)

## Plain rolls

- One d20: `dice: 1d20`
- With a bonus: `dice: 1d20 + 5`
- Lots of dice: `dice: 8d6` (fireball!)
- Don't know the die count? `dice: d20` means one d20.

## The famous ones

- **Advantage** (roll two d20, keep the best): `dice: 2d20kh`
- **Disadvantage** (keep the worst): `dice: 2d20kl`
- **Ability score** (roll 4d6, drop the lowest): `dice: 4d6dl1`
- **Exploding dice** (max roll = roll again and add): `dice: 3d6!`
- **Re-roll 1s once**: `dice: 2d6r`
- **Count successes** (how many dice rolled 5+): `dice: 6d6>=5`

## Special dice

- Percentile: `dice: d%`
- Traveller d66: `dice: 1d66%`
- Fate/Fudge dice: `dice: 4dF`

## Watch them tumble

Add `|render` and the dice tumble across the screen — but only
when you ask for a *new* roll: `dice: 4d6dl1|render`, then click
its 🎲.

(Turn the tumbling on or off in Settings → Randomness →
Graphical dice. It starts switched on.)

## See what each die rolled

Rest your mouse on any roll. A little box pops up showing what
each die landed on. Dice that got thrown away have brackets round
them, like `(1)`.

Want to see the faces right there in the sentence instead of `13`,
like `13 (7, 6)`? Add `|dice`: `dice: 2d10|dice`. To make *every*
roll do it, switch on **Settings → Randomness → Show dice
breakdown**.

Some games — Ironsworn is the famous one — care about what each
die shows, not the total. This is for those.

## See the formula too

Prefer `2d6+3 → 11` over a bare `11`? Turn on **Settings →
Randomness → Show dice formula**. Every dice roll in your notes
then shows its sum this way, no matter whether you wrote `dice:`
or `rdm:`. Table rolls are left alone. And on any one `dice:` roll
you can disagree with the setting: `|form` forces the formula on,
`|noform` forces it off.

## Dice inside sentences and tables

Both of these do exactly the same thing — roll two d10 and add
them:

```text
`rdm:2d10`
`rdm:{2d10}`
```

If the whole thing is *just* dice, you can skip the curly
brackets. The moment you put words around the dice, you need them.
Without them nothing rolls — `` `rdm:you take 2d6` `` just prints
those exact words back at you. With them,
`` `rdm:you take {2d6}` `` gives you "you take 7".

Once you start writing your own tables — the next chapter, and
chapter 5 — dice always live inside curly brackets. Here is what
one of those tables looks like while you are typing it:

````text
```randomness
Table: Loot
You find {2d6} gold coins and {1d4} shiny buttons.
```
````

And here is that same block actually running. Obsidian swaps the
whole block for the result:

```randomness
Table: Loot
You find {2d6} gold coins and {1d4} shiny buttons.
```

## Name your favourite rolls

Open **Settings → Randomness → Dice formula aliases** and add:

```text
sneak = 4d6dl1
```

Now `dice: sneak` rolls it. The ★ button in the dice tray saves
formulas to the same list.

## Cheat sheet

| Write | Get |
| ----- | --- |
| `2d6 + 3` | two d6 plus 3 |
| `2d20kh` / `2d20kl` | keep highest / lowest |
| `4d6dl1` | drop the lowest die |
| `3d6!` | exploding sixes |
| `2d6r` | re-roll 1s once |
| `6d6>=5` | count dice showing 5+ |
| `d%`, `4dF`, `1d66%` | percentile, Fate, d66 |

Next: [[02 - Random Tables In Your Notes]]
