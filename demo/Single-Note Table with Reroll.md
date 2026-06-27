# Single-note table + dice reroll button

**Question this answers:** "How can I define a table in a note and get a
random result from it with a dice button for reroll — keeping the table in
that one note, no external file?"

**Short answer:** Define the table once in a `randomness` codeblock at the
bottom of the note, then reference it inline anywhere with `` `rdm:[@TableName]` ``.
The inline call renders the result with a 🎲 reroll button right next to it.
Inline calls automatically see codeblocks **in the same note**, so nothing
external is required.

> [!important]
> The 🎲 / 🔒 buttons appear in **Reading view** only. Switch with
> `Ctrl/Cmd-E` (or the read-eye icon, top-right of the tab). In Live Preview
> the call shows as a plain code span without buttons — that's expected.

---

## Try it

Roll on the table: `rdm:[@Treasure]`

That inline call above shows a random result plus a 🎲 button — click 🎲 to
reroll, or 🔒 to lock the current result permanently into the note.

You can drop the same call into prose as many times as you like, and each one
rolls independently:

> Opening the chest, you find `rdm:[@Treasure]` resting on top of
> `rdm:[@Treasure]`.

Want a weighted table (some results more common than others)? Put a number and
a colon in front of the line — higher number = more likely:

The weather today is `rdm:[@Weather]`.

---

## The table definition (keep this in the note)

The inline `rdm:` calls above read from this codeblock. Edit the lines freely —
add, remove, or reweight entries and the calls pick them up. Don't delete it,
or the calls have nothing to roll on.

```randomness
Table: Treasure
a pouch of 2d6 gold coins
a tarnished silver ring
a vial of glowing liquid
an old map with one corner torn off
nothing but cobwebs
a rusty iron key

Table: Weather
5: clear skies
3: light rain
2: heavy fog
1: a sudden thunderstorm
```

---

## Notes for customising

- **Naming:** `Table: X` defines a table; `` `rdm:[@X]` `` rolls it. The name
  after `@` must match the `Table:` name exactly (case-sensitive).
- **Dice inside results:** `2d6` in the Treasure table rolls live each time.
  You can also roll dice directly inline: `` `rdm:{1d20+3}` ``.
- **Weighting:** the leading `5:` / `3:` style sets relative weight. Lines with
  no number default to weight 1.
- **Filters:** append `>> upper`, `>> proper`, or `>> bold`, e.g.
  `` `rdm:[@Treasure >> proper]` ``.
- **Locking vs rerolling:** 🎲 rerolls; 🔒 writes the chosen result into the
  source as `` `rdm:[@Treasure]⟹a rusty iron key` `` so it survives reloads.
  Click 🎲 on a locked call to unlock and reroll it.
- **Always-fresh alternative:** the codeblock itself also renders a result and
  rerolls on every render — but it has no button. Use the inline `rdm:` call
  when you want the clickable 🎲.
```
