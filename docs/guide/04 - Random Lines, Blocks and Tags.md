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

### Putting them on separate lines

Several results come back as a comma list. `|sep:` changes the glue to
whatever you like — and it works on line, block and table rolls too:

```text
`rdm:3#monster|sep:<br>|link`      one per line
`rdm:3#monster|sep:<br>• |link`    one per line, bulleted
`rdm:3[[Rumour Mill|line]]|sep:\n` same thing, written as a newline
`rdm:3[[Loot^loot]]|sep: /\_`      a slash-separated list
```

Everything after `sep:` is the separator, spaces included, so
`sep: —\_` really does put spaces around the dash. Two shorthands help
where a space is hard to type: `\n` is a line break and `\_` is a
space.

**Write `\_` whenever the separator ends in a space.** A space right
before the closing backtick is trimmed away before Randomness sees it,
so `sep: / ` quietly joins with `" /"` and you get
`sword /ring /sword`. `sep: /\_` gives you the `sword / ring / sword`
you meant. (It only matters at the very end — in `sep: —\_|link` the
space would survive anyway — but always writing `\_` is the habit that
never bites.)

On a tag roll `sep:` goes before `prop:`, which swallows the rest of
the line:

```text
`rdm:3*|folder=Bestiary|unique|sep:<br>|prop:{{link}} — CR {{cr}}`
```

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
