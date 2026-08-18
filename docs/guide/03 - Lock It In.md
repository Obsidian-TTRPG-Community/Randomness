# 03 - Lock It In

An unlocked roll is only a *preview*. It stays the same while
Obsidian is open, but nothing is written down — close Obsidian and
it rolls a new answer next time. When you get a result you want to
KEEP — a name, a shop, a plot twist — lock it.

## Try it

Your rival's name is `rdm:[@rivals]`.

| Rival |
| ----- |
| Ember the Unpaid |
| Sir Reginald Crumb |
| Two Ferrets In A Coat |
| Madame Halibut |

^rivals

See the two little buttons just before the name? Click the 🔒.
Done — that result is now written into your note itself. It
survives closing Obsidian, syncing to your phone, everything.

A locked roll drops down to a single button, 🔓 — click it to
unlock and roll fresh.

Want to see where the answer went? Press Ctrl/Cmd+E to flip the
note into edit mode. Your roll is sitting right there in the
writing, after a `⟹` arrow — like
`` `rdm:[@rivals]⟹Madame Halibut` ``. It is part of your note now.
Nothing is hidden anywhere else, so it goes wherever your note
goes.

## Lock everything at once

Two shortcuts. Press Ctrl/Cmd+P to open Obsidian's command box,
then start typing the name:

- **Lock all unfilled rdm: in current note** — locks every roll
  that isn't locked yet, keeping exactly what's on screen.
- **Reroll all rdm: in current note** — unlocks everything for a
  fresh start.

## Rolls that lock themselves

`dice-mod:` rolls once and locks itself straight away. The first
time the note opens, Randomness rolls it, writes the answer into
your note, and never touches it again:

```text
Treasure: `dice-mod: 2d6 * 10` gold
```

Great for loot you generate once and never want to change.

Next: [[04 - Random Lines, Blocks and Tags]]
