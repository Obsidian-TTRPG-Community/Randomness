# Randomness — Image Embed Demo

This note demonstrates the v0.4.0 wiki-syntax rendering feature.
Drop the `portraits.ipt` file and the `images/` folder into your
vault alongside this note, then open this note in **Reading view**.

> [!important]
> Inline `rdm:` calls inherit their generator scope from the
> `randomness` codeblocks in the **same note**. So the codeblock
> below isn't just a demo — it's also what brings `portraits.ipt`
> into scope for the inline calls later in the note. You need at
> least one codeblock with the `Use:` directive somewhere in the
> note before inline calls can find the table.

## 0. Scope-setting codeblock

This codeblock both rolls a portrait AND imports `portraits.ipt`
into the note's scope so the inline calls below can use it.

```randomness
Use: portraits.ipt
[@portrait]
```

## 1. Inline `rdm:` — Roll a portrait inline

Now that `portraits.ipt` is in scope (from the codeblock above),
inline calls can reference the `portrait` table directly. Each
inline call gets a 🎲 reroll and 🔒 lock button.

The party encounters a stranger: `rdm:[@portrait]` who looks at
you suspiciously.

## 2. Multiple inline calls

Each `rdm:` call is independent — clicking reroll on one only
affects that one, even when they're all the same expression
(v0.3.1 fix).

Three travellers come into the inn:

- `rdm:[@portrait]`
- `rdm:[@portrait]`
- `rdm:[@portrait]`

## 3. Combined: portrait + flavour text

The `encounter` table combines a portrait with a flavour line,
demonstrating that the engine still does its normal job
(picking, joining, formatting) around wiki-syntax.

```randomness
Use: portraits.ipt
[@encounter]
```

## 4. Reps — multiple portraits in one roll

You can roll the table multiple times in one go. The visual gap
between reps (from v0.3.0) makes each portrait read as its own
distinct chunk rather than merging together.

```randomness
Use: portraits.ipt
3[@portrait]
```

---

## How it works under the hood

The `portraits.ipt` file looks like this:

```
Table: portrait
![[images/goblin-warrior.svg]]
![[images/dwarf-cleric.svg]]
![[images/elf-ranger.svg]]
![[images/human-bard.svg]]
![[images/halfling-rogue.svg]]
![[images/tiefling-wizard.svg]]
```

When you roll, the engine picks one of those lines verbatim. The
post-processor sees the `![[images/...svg]]` in the output, looks
up `images/goblin-warrior.svg` in your vault via Obsidian's
metadata cache, and swaps in a real `<img>` element. If you move
or rename the SVG files, the link goes "unresolved" (styled as
muted dashed-underline text) rather than crashing.

`{var}` substitution still works inside the brackets, so you can
build dynamic embeds like `![[ {filename} ]]` if your generator
picks the filename separately.

## Why inline calls need a scope-setting codeblock

Inline `rdm:` calls don't accept their own `Use:` directive — the
syntax inside the brackets is the expression body only, so
`` `rdm:[@portrait Use: portraits.ipt]` `` would try to look up a
table literally named `portrait Use: portraits.ipt`. That's why
the previous version of this demo errored.

Instead, inline calls share the note's scope: every `randomness`
codeblock in the same note contributes its `Use:` imports and
its own tables to a pool that all inline calls can draw from.
The simplest pattern is to start the note with one "scope-setting"
codeblock and sprinkle inline calls throughout.
