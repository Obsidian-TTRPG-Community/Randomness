# 04 - Random Lines, Blocks and Tags

You don't even need a table. Randomness can pick from whole
notes.

## A random line or paragraph from a note

```text
`rdm:[[Rumour Mill|line]]`    one random line from that note
`rdm:[[Rumour Mill|block]]`   one random paragraph
`rdm:3[[Rumour Mill|line]]`   three random lines
```

Make a note called "Rumour Mill", fill it with one rumour per
line, and those calls work anywhere in your vault.

## A random note with a tag

Tag some notes `#rumour` (in the text or in frontmatter). Then:

```text
`rdm:#rumour`        a random paragraph from a random tagged note
`rdm:#rumour|link`   a link to a random tagged note
```

No extra plugins needed — tags come from Obsidian itself.

## Narrowing by tags and properties

Running several campaigns in one vault? Filter the candidates with
extra pipe segments — more tags, or frontmatter properties:

```text
`rdm:#npc|universe=Eldara|link`   only NPCs whose `universe` property
                                  is Eldara
`rdm:#npc|#merchant`              notes with BOTH tags
`rdm:#npc,#monster`               notes with EITHER tag
`rdm:#npc|universe=Eldara,Vex`    property is Eldara OR Vex
`rdm:*|universe=Eldara|link`      any note with the property, no tag
`rdm:*|folder=Bestiary|cr=3|link` a random CR-3 monster note from
                                  your Bestiary folder
```

Values match case-insensitively, lists in frontmatter match if any
entry hits, and link-style values (`universe: "[[Eldara]]"`) match
their note name. `prop=*` means "the property exists".

## More than one at a time

Put a number in front, exactly as you would for a line roll:

```text
`rdm:3#monster|link`          three picks
`rdm:3#monster|unique|link`   three DIFFERENT monsters
`rdm:{1d4}#rumour`            roll d4, get that many rumours
```

Without `|unique` the same note can show up twice — fine for rumours,
less so for "the five monsters in this dungeon". Ask for more unique
notes than you have and you just get all of them.

## Printing the properties themselves

Filtering on a property is one thing; printing it is another. End the
call with `prop:` and the rest becomes a template:

```text
`rdm:*|folder=Bestiary|prop:cr`

`rdm:*|folder=Bestiary|prop:{{link}} — CR {{cr}}, {{hp}} HP`
```

The second one renders as:

> [[Bestiary/Bog Hag|Bog Hag]] — CR 3, 45 HP

One note is rolled and the whole line is filled in from it, so the CR
and the HP always belong to that monster. Writing two separate
`` `rdm:` `` calls would give you two different monsters — each inline
call is its own roll.

`{{link}}`, `{{linkpath}}`, `{{path}}` and `{{name}}` describe the note
itself; anything else is one of its properties. A note that's missing a
property you asked for is simply never picked.

## Why this is handy

- A `#quest-hook` tag across your campaign notes = instant
  session starter.
- A "Overheard in the market" note + `|line` = endless flavour.
- `#npc|link` = "who shows up?" without building anything.

Next: [[05 - Your First Generator File]]
