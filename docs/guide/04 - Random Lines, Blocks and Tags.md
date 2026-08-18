# 04 - Random Lines, Blocks and Tags

You don't even need a table. Randomness can pick from whole
notes.

Heads up: unlike the last three chapters, nothing on this page
rolls by itself — the examples need notes and tags that only exist
in *your* vault. Copy the bits you like into a note of your own
and they will come alive there.

## A random line or paragraph from a note

```text
`rdm:[[Rumour Mill|line]]`    one random line from that note
`rdm:[[Rumour Mill|block]]`   one random paragraph
`rdm:3[[Rumour Mill|line]]`   three random lines
```

Make a note called "Rumour Mill", fill it with one rumour per
line, and those calls work anywhere in your vault.

## A random note with a tag

Tag some notes `#rumour` — either by typing `#rumour` straight
into the note, or by adding it to the note's tag list at the top.
Either way works. Then:

```text
`rdm:#rumour`        a random paragraph from a random tagged note
`rdm:#rumour|link`   a link to a random tagged note
```

No extra plugins needed — tags come from Obsidian itself.

## Picking from a smaller pile

Got a big vault with lots of tagged notes? You can narrow down
which ones count. Add more rules after the tag, each one separated
by a `|` bar.

Some of the rules look at **properties**. A property is one of
those `name: value` lines at the very top of a note, between two
`---` lines — Obsidian shows them as a little table at the top of
the page. If a note says `universe: Eldara` up there, then
`universe=Eldara` will find it.

```text
`rdm:#npc|universe=Eldara|link`   only NPCs whose `universe` property
                                  is Eldara
`rdm:#npc|#merchant`              notes with BOTH tags
`rdm:#npc,#monster`               notes with EITHER tag
`rdm:#npc|universe=Eldara,Vex`    property is Eldara OR Vex
`rdm:*|universe=Eldara|link`      Eldara notes, tag or no tag
`rdm:*|folder=Bestiary|cr=3|link` a random CR-3 monster note from
                                  your Bestiary folder
```

Randomness is relaxed about how you wrote the value:

- Capital letters don't matter — `eldara` finds `Eldara`.
- If a note lists several values, matching any one is enough.
- If the value is a link like `universe: "[[Eldara]]"`, the link's
  name counts.
- And `universe=*` means "I don't care what it says, as long as
  the note *has* a universe."

## More than one at a time

Put a number in front, exactly as you would for a line roll:

```text
`rdm:3#monster|link`          three picks
`rdm:3#monster|unique|link`   three DIFFERENT monsters
`rdm:{1d4}#rumour`            roll d4, get that many rumours
```

Without `|unique` the same note can show up twice — fine for
rumours, less so for "the five monsters in this dungeon". Ask for
more unique notes than you have and you just get all of them.

One limit worth knowing: a paragraph roll (`#rumour` with no
`|link`) has to open every note it might pick, so it only ever
looks at 50 of them, chosen at random. `|link` and `prop:` rolls
read no notes at all, so they always see every single match.

### Putting them on separate lines

Ask for three and you get them in one line, split by commas.
`|sep:` lets you choose what goes between them instead. It works
on the rolls that read your notes — tagged notes, paragraphs,
lines, and `^`-named tables:

```text
`rdm:3#monster|sep:<br>|link`      one per line
`rdm:3#monster|sep:<br>• |link`    one per line, bulleted
`rdm:3[[Rumour Mill|line]]|sep:\n` same thing, written as a newline
`rdm:3[[Loot^loot]]|sep: /\_`      a slash-separated list
```

(Tables you write yourself in a `randomness` block don't use
`sep:` — they use the `>> implode` filter instead. Chapter 06.)

Everything after `sep:` is the separator, spaces included, so
`sep: —\_` really does put spaces around the dash. Two shorthands
help where a space is hard to type: `\n` is a line break and `\_`
is a space.

**If your separator ends in a space, write `\_` for that space.**
Randomness snips spaces off the end of what you type, so `sep: / `
quietly becomes `sep: /` and you get `sword /ring /sword`.
`sep: /\_` keeps the space and gives you the
`sword / ring / sword` you meant.

If you use `sep:` and `prop:` together, `sep:` has to come first.
Everything after `prop:` counts as part of your sentence, `|` bars
and all:

```text
`rdm:3*|folder=Bestiary|unique|sep:<br>|prop:{{link}} — CR {{cr}}`
```

## Printing the properties themselves

So far properties have only been used to *choose* a note. You can
also *print* them. Finish your roll with `prop:` and then write a
little sentence — Randomness fills in the blanks from whichever
note it picked. Put a property's name in double curly brackets to
make a blank:

```text
`rdm:*|folder=Bestiary|prop:cr`

`rdm:*|folder=Bestiary|prop:{{link}} — CR {{cr}}, {{hp}} HP`
```

That second one comes out as:

```text
[[Bestiary/Bog Hag|Bog Hag]] — CR 3, 45 HP
```

...which Obsidian then shows as **Bog Hag — CR 3, 45 HP**, with
"Bog Hag" clickable.

Randomness picks *one* monster and fills the whole sentence in
from that one monster, so the CR and the HP always belong
together. If you wrote two separate `` `rdm:` `` rolls instead,
you'd get two different monsters — a dragon's hit points glued to
a zombie's name. Every pair of backticks is its own roll.

Four blanks are about the note itself rather than its properties:
`{{name}}` is just its name, `{{link}}` is a clickable link,
`{{path}}` is where it lives in your vault, and `{{linkpath}}` is
a link that shows that whole location. Anything else you put in
brackets is looked up in the note's properties — and a note that
hasn't got the property you asked for is quietly skipped, so
you'll never get a half-empty sentence.

## Why this is handy

- A `#quest-hook` tag across your campaign notes = instant
  session starter.
- An "Overheard in the market" note + `|line` = endless flavour.
- `#npc|link` = "who shows up?" without building anything.

Next: [[05 - Your First Generator File]]
