# 07 - Sharing Tables Between Notes

Made a great table? Use it everywhere.

## The zero-setup way

If a table lives in a `.rdm` file under your **Generator root**
(Settings → Randomness), just call it by name from any note —
the `Weather` table you made in chapter 05, for example:

```text
`rdm:[@Weather]`
```

Randomness finds the file for you. Even better, you barely have
to type it. Start a roll and stop after the `@`:

```text
`rdm:[@
```

A little menu pops up listing every table in your vault. Pick one
and it finishes the name for you. If that table lives somewhere
this note can't see yet, Randomness quietly adds the line that
fetches it — more on that line just below.

## Borrowing tables from another note

Back in chapter 02 you named a table by putting `^` and a name on
the line underneath it. Any note's `^` tables can be rolled from
anywhere, as long as you name the note as well as the table:

```text
`rdm:[[02 - Random Tables In Your Notes^taverns]]`
```

Or bring ALL of another note's tables into this note at once.
Start a block with three backticks and the word `randomness`,
then a `Use:` line naming the note you're borrowing from. `Use:`
means "go and fetch that note's tables for me".

It looks like this — indented here only so you can read it, so
when you type it yourself start every line hard against the left
edge:

    ```randomness
    Use: [[02 - Random Tables In Your Notes]]
    Tonight: [@taverns]
    ```

One `Use:` line does the whole note. From then on, any roll you
type between backticks anywhere else in this note can use those
tables too — the block doesn't have to sit next to them.

## Tables that roll on other tables

A table's rows can hold rolls of their own, and those rolls can
name another note. This table's one row reaches into chapter 02
for a name and a job — try it:

| Encounter |
| --------- |
| You meet `rdm:[[02 - Random Tables In Your Notes^npcs.Name]]`, the `rdm:[[02 - Random Tables In Your Notes^npcs.Job]]` |

^encounter

Rolling this note's table gets you both: `rdm:[[07 - Sharing Tables Between Notes^encounter]]`

Note the dot in `^npcs.Name`. Picking a column is usually written
`^npcs|Name`, but a `|` inside a table cell ends the cell — so
inside a table, use the dot. They mean the same thing.

Nothing else to set up — no `Use:` line, no copying tables about.
Build one Bestiary note and let every encounter table in your
vault borrow from it.

Two notes may point at each other, which is handier than it
sounds: a Places table whose rows mention people, and a People
table whose rows mention places.

The note you name is the note you get. If this note happened to
have its own `^npcs` table as well, the roll above would still
reach into chapter 02 — you said chapter 02, so that's what
answers.

## The sidebar

Click the 🎲 icon in the strip of icons down the left edge of
Obsidian. A panel opens listing every generator in your vault,
sorted into folders. Next to each table are three buttons:

- **Roll** — try the table right there.
- 📋 — copy the ready-made roll, so you can paste it straight
  into a note.
- 📍 — pin a favourite so it sits at the top of the list. Use the
  ▲▼ buttons to rearrange your favourites, or ⇅ on the Favourites
  header to sort them by name or by file.

Next: [[08 - Coming From Dice Roller]]
