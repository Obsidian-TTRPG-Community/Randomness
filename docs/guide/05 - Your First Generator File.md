# 05 - Your First Generator File

Tables in notes are great. But when a generator gets big — or you
want to use it in every vault — put it in a **generator file**.

## What is a .rdm file?

Just a text file. Nothing magic. The `.rdm` ending tells
Randomness "this whole file is tables".

One surprise: when you click a `.rdm` file in Obsidian, you don't
get the text — you get a **rolled result**, with a 🎲 button to
roll it again. To see and change the tables themselves, click
**Open as Markdown** in the row of little buttons at the top right
of the tab.

## The easy way to make one

Press Ctrl/Cmd+P to open Obsidian's command box, type
**"Create new generator file"**, and hit Enter.

That's it. Randomness makes the file for you, puts some example
tables inside so you can see the shape of it, and opens it up. (If
you've set a Generator root folder, the file lands in there.)

## The manual way

If you'd rather do it by hand: make a text file and give it a name
ending in `.rdm` (not `.md`, and not `.rdm.txt`!). If you have set
a Generator root folder, put the file in there — once that folder
is set, Randomness stops looking anywhere else. Haven't set one?
Then anywhere in your vault is fine.

> **Windows tip:** Windows hides file endings by default, so your
> "MyTables.rdm" might secretly be "MyTables.rdm.txt". In File
> Explorer, turn on **View → File name extensions**, then rename.
> Or skip all that and use the command above.

## What goes inside

```text
// Lines starting with // are comments.
Table: Weather
sunny and warm
grey drizzle
howling wind
thick fog

Table: Mood
cheerful
grumpy
suspiciously quiet
```

`Table:` starts a new table, and every line under it is one thing
that might come out. Blank line, then `Table:` again for the next
one.

The FIRST table in the file is the boss. When you roll the whole
file — by opening it, or by clicking **Roll** next to it in the
sidebar — that's the one that rolls.

## Rolling it

Anywhere in any note:

```text
`rdm:[@Weather]`
```

That works from any note, with no setting up — Randomness knows
the names of every table in every `.rdm` file it can see.

Which files can it see? All of them, unless you tell it otherwise.
If you set a **Generator root** folder (Settings → Randomness), it
looks *only* inside that folder — tidier, but remember to keep
your `.rdm` files in there.

Or roll it without typing anything: click the 🎲 icon in the strip
of icons down the left edge of Obsidian. Find your file in the
list, click it to open it up, and hit **Roll** next to any table.

Next: [[06 - Bigger Generators]]
