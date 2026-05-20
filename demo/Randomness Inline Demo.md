# Randomness inline demo

> [!important]
> Inline `rdm:` calls render in **Reading view** only. Switch to it
> with `Ctrl/Cmd-E` or the read-eye icon in the top-right of this
> tab before testing the buttons. In Live Preview the calls show as
> plain code spans without the 🔒/🎲 controls — that's a known
> limitation; codeblocks (the gray box at the bottom) work in both
> views.

Drop this note into any folder of a vault where the Randomness plugin
is enabled. Open it in **Reading view**. Each `rdm:` call below should
render with the result inline, a 🎲 reroll button, and (if unfilled) a
🔒 lock button.

The tables that power this demo live in the codeblock at the bottom
of this note — the inline calls automatically see same-note generators.

## 1. Simplest case — a single table roll

The traveler arrived at `rdm:[@Settlement]` as dusk fell.

Hover the result. The 🎲 button rerolls; 🔒 commits the current preview
into the source by appending `⟹result`. Switch to Edit view after
locking to see the change in the underlying text.

## 2. Pre-locked call — committed result

This call has already been locked, so it shows the same result every
render and survives reload:

> The innkeeper, a weary man named `rdm:[@Person]⟹Korad the Blue`,
> nodded as we entered.

Click 🎲 on it to strip the lock — the next render will show a fresh
preview, and the `⟹Korad the Blue` will be gone from the source.

## 3. Multiple identical calls — each independent

Three travelers from the same caravan, each named separately:

- `rdm:[@Person]`
- `rdm:[@Person]`
- `rdm:[@Person]`

Even though the expression is identical, each call has its own preview.
Lock them one at a time to see distinct results committed. (Heads up:
the lock button targets the *first unfilled* occurrence of the
expression, so locking from the third one before the first/second is
locked will still lock the first. Either lock top-to-bottom, or use
the "Lock all unfilled rdm:" command from the command palette.)

## 4. Mixed calls in one sentence — natural prose

> A merchant named `rdm:[@Person]` was last seen heading toward
> `rdm:[@Settlement]`, carrying `rdm:[@Cargo]`.

This is the everyday case — sprinkle generators through your worldbuilding
prose, lock the ones you like, leave the rest as live previews.

## 5. With a filter — uppercase, proper-case, bold

- Plain: `rdm:[@Settlement]`
- UPPER: `rdm:[@Settlement >> upper]`
- Proper Case: `rdm:[@Settlement >> proper]`
- **Bold:** `rdm:[@Settlement >> bold]`

The full filter set (21 of them) works in inline calls — see the README
for the list.

## 6. Dice and math expressions

The party rolls for initiative:

- d20 roll: `rdm:{1d20}`
- d20 plus modifier: `rdm:{1d20+3}`
- Stat block (4d6 drop lowest, traditional): `rdm:[@Stat]`

## 7. Conditional expressions

The shopkeeper's mood today is `rdm:[@Mood]`, which means prices are
`rdm:[@Pricing]`.

## 8. The codeblock that powers all of the above

Don't delete this — the inline calls above depend on it. Edit freely
to customise.

```randomness
Table: Settlement
Stonewatch
Riverbend
Greenhollow
Ashpoint
Coppertown
Thornhaven
Mistford

Table: Person
Tessith Vone
Korad the Blue
Mira Thornhaven
Vex Iremane
Old Brannic
Selene Coalheart
Pip Ferrowclaw

Table: Cargo
a bundle of silk
two casks of spiced wine
a crate of suspiciously-labelled tea
a map of dubious provenance
a sealed iron strongbox
a satchel of rare salts

Table: Stat
{4d6}

Table: Mood
foul
cheerful
distracted
nervous
businesslike

Table: Pricing
inflated by half
fair, for once
unaccountably generous
nonexistent — everything's on the house today
slightly off, depending on who's asking
```

## Try the commands

With this note open and focused, run the command palette
(`Ctrl/Cmd-P`) and search for "Randomness":

- **Lock all unfilled rdm: in current note** — every unlocked inline
  call gets evaluated and committed in one atomic save. Identical
  expressions get the same value (one evaluation per unique expr).
- **Reroll all rdm: in current note** — strips every lock; all calls
  return to live-preview state on the next render.
