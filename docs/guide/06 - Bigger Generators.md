# 06 - Bigger Generators

Everything here works in `.rdm` files AND in `randomness` blocks
inside notes (that's a fenced block whose language is the word
`randomness` — chapter 07 shows how to type one). Every example
below is a real, live block: click **🎲 Reroll** on any of them
to get a new result.

## Tables that call tables

In chapter 05 you rolled a table from a note. A table can also
roll another table from inside its own text. Put `[@OtherTable]`
right in a line and Randomness swaps it for a result:

```randomness
Table: Encounter
A [@Monster] guards a [@Treasure].

Table: Monster
grumpy troll
sleepy dragon
very small ghost

Table: Treasure
chest of buttons
golden sandwich
map to somewhere
```

## Make some results rarer

Put a number and a colon in front. Think of it as how many
tickets that line gets in the hat:

```randomness
Table: Find
10: a plain rock
5: a shiny rock
1: THE KING OF ROCKS
```

That's 10 + 5 + 1 = 16 tickets. The plain rock holds 10 of them,
so it wins about 10 times out of every 16. THE KING OF ROCKS
holds one.

## Remember things with variables

A variable is a labelled box. `Set:` rolls something once and
drops the result in the box; the label you chose, written as
`{$label}`, pours it back out — as many times as you like. Here
the box is called `name`:

```randomness
Table: Villain
Set: name=[@Name]
{$name} raises an eyebrow. "Yes," says {$name}, "it was me."

Table: Name
Doctor Pickle
Lady Ravensworth
The Postman
```

## If this, then that

Sometimes you want the result to depend on the roll. Read this
one out loud: **when** this is true, **do** that, or **else** do
the other thing, and that's the **end** of it.

```randomness
Table: SavingThrow
Set: roll={1d20}
Rolled {$roll}: [when]{$roll}>=10[do]You made it![else]You fell in the mud.[end]
```

`>=` means "is at least", so `{$roll}>=10` asks "did we roll 10
or more?". The `[else]` part is optional — leave it out and
nothing is printed when the answer is no. One `[when]` can't live
inside another one; if you need two questions, ask them on two
separate lines.

## Ask the reader

`Prompt:` puts a little drop-down menu above the result, so
whoever opens the note can choose. Three parts: a name, the
choices between `{ }` split by `|`, and the one to start with.

```randomness
Prompt: Danger {Low|High} Low
Table: Cave
[when]{$Danger}=Low[do]Three bats and an echo.[else]The dragon is home. RUN.[end]
```

Use the name you gave it — `{$Danger}` — to find out what was
picked.

## Polish the output

A filter tidies up a result on its way out. Write `>>` and the
filter's name after the table name, and add another `>>` if you
want a second filter:

```randomness
Table: Shout
[@Animal >> upper]!!!

Table: Animal
weasel
heron
capybara
```

Other useful filters: `proper` (puts a Capital Letter at the
start of every word), `implode` (joins several rolls with
commas), and `bold` (makes the result **bold**).

## Ask for several at once

Put a number straight after the `@` to roll the same table more
than once. `[@3 Animal]` rolls Animal three times.

This is where `implode` earns its keep. On its own, a repeated
call runs the results straight together with nothing in between,
so `[@3 Animal]` gives you `weaselheroncapybara`. Add a filter
and they come apart:

```text
[@3 Animal]                  weaselheroncapybara
[@3 Animal >> implode]       weasel, heron, capybara
[@3 Animal >> implode \n]    one on each line
```

The same animal can turn up twice — every roll is a fresh pick.

There's more — dictionary tables (one table that looks up
matching entries in another), and card decks that never deal the
same card twice. It's all in the full reference: **Settings →
Randomness → Open reference**.

Next: [[07 - Sharing Tables Between Notes]]
