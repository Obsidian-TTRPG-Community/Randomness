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

## The sidebar

Click the 🎲 icon in the strip of icons down the left edge of
Obsidian. A panel opens listing every generator in your vault,
sorted into folders. Next to each table are three buttons:

- **Roll** — try the table right there.
- 📋 — copy the ready-made roll, so you can paste it straight
  into a note.
- 📍 — pin a favourite so it sits at the top of the list.

Next: [[08 - Coming From Dice Roller]]
