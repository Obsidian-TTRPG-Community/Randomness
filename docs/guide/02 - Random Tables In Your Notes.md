# 02 - Random Tables In Your Notes

Any table or bullet list in a note can be rolled on, once you give
it a name. Write the name on its own line just below, starting
with a `^`, like `^taverns`. (Obsidian calls that a "block id" —
it is just Obsidian's way of naming one chunk of a note, so you
can point at it later.)

## A simple table

| Tavern |
| ------ |
| The Prancing Pony |
| The Rusty Bucket |
| The Laughing Ghost |
| The Drunken Goblin |

^taverns

Tonight you sleep at `rdm:[@taverns]`.

Want three at once? Put a number in front — using the longer form
that names the note as well as the table, which is what the bottom
of this page is about:

Tonight's three choices: `rdm:3[[02 - Random Tables In Your Notes^taverns]]`

## Lists work too

- it starts to rain
- a dog follows you
- you smell fresh bread
- someone is watching

^events

On the way: `rdm:[@events]`

## Tables with columns

| Name  | Job       | Secret |
| ----- | --------- | ------ |
| Alia  | baker     | afraid of yeast |
| Borin | guard     | writes poetry |
| Cass  | herbalist | can't smell anything |

^npcs

- Whole row: `rdm:[@npcs]`
- Just a name: `rdm:[@npcs.Name]`
- Any random box in the whole table, from any column:
  `rdm:[@npcs.xy]`

### Keeping a row together

Each column is its own table, so three calls give you three
different people — a baker with somebody else's secret:

`rdm:The [@npcs.Job] was [@npcs.Secret], which put [@npcs.Name] at a disadvantage.`

There is a trick. Roll the row *number* once, remember it, and
then ask each column for that same row.

`rdm:The [#{row=1d{count(npcs)}} npcs.Job] was [#{$row} npcs.Secret], which put [#{$row} npcs.Name] at a disadvantage.`

That looks scary, so here it is in pieces:

- `count(npcs)` is how many rows the table has — 3 right now, and
  4 the moment you add a row, so this never goes out of date.
- `1d{count(npcs)}` rolls a die with that many sides. One row
  picked.
- `row=` gives that number a name, and `$row` means "the number I
  named". So all three `[# ]` calls fetch the *same* row.

One warning: this all has to live inside a single `` `rdm:` `` —
names like `$row` are forgotten the moment the backticks close.

## Lookup tables (roll dice, read the row)

Sometimes you want to roll a die and look up the answer, like a
real rulebook. Put the die in the top-left box and give every row
a number, or a range of numbers:

| dice: 1d20 | What happens |
| ---------- | ------------ |
| 1-2        | Ambush! {1d4} bandits jump out |
| 3-10       | A quiet mile |
| 11-17      | A traveller waves hello |
| 18-20      | You find {2d6} coins on the road |

^road

On the road: `rdm:[@road]`

Notice the `{1d4}` inside a row — tables can roll dice (and even
other tables) inside their results. Rollers all the way down.

## Rolling from other notes

`[@taverns]` looks for that table in the note you are writing in.
To reach a table living in a *different* note, name that note too
— its name in `[[ ]]`, then `^`, then the table's name:

```text
`rdm:[[02 - Random Tables In Your Notes^taverns]]`
```

Numbers work here as well — this one gives you three names from
the table further up the page:
`rdm:3[[02 - Random Tables In Your Notes^npcs.Name]]`

### One cell from a table in another note

Everything from the columns section above works across notes too —
just add the column after the table name:

- A whole row: `rdm:[[02 - Random Tables In Your Notes^npcs]]`
- One column: `rdm:[[02 - Random Tables In Your Notes^npcs|Name]]`
- Any single box: `rdm:[[02 - Random Tables In Your Notes^npcs|xy]]`

This is the tidy way to keep one big table in one place. A wide
table — five columns of twenty names, say — takes up far less
screen than a single column of a hundred, and every NPC note in
your vault can reach into it with one span instead of carrying its
own copy.

If you'd rather write it the way you write `[@npcs.xy]`, a dot does
the same job: `rdm:[[02 - Random Tables In Your Notes^npcs.xy]]`.
Inside a markdown table you have to use the dot — a `|` would end
the cell.

Next: [[03 - Lock It In]]
