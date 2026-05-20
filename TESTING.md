# Randomness v0.1.0 — manual install & smoke test guide

This is a practical walkthrough for getting the plugin into a real
Obsidian vault and verifying the features work. It assumes you've
just downloaded `randomness-v0.1.0-install.zip`.

## Install (~30 seconds)

1. Open your Obsidian vault folder in a file manager.
2. Navigate to `.obsidian/plugins/`. If `.obsidian` isn't visible,
   you may need to "show hidden files" first.
3. Extract `randomness-v0.1.0-install.zip` here. You should end up
   with `.obsidian/plugins/randomness/` containing exactly three
   files: `main.js`, `manifest.json`, `styles.css`.
4. Restart Obsidian (or run "Reload app without saving" from the
   command palette).
5. Open **Settings → Community plugins**.
6. Find "Randomness" in the **Installed plugins** list and toggle
   it on. (If you don't see it, make sure "Restricted mode" is off
   and try **Reload plugins**.)

If the plugin fails to load, open **View → Toggle Developer Tools →
Console** and check for red errors. Most likely cause is a
typo in the install path; `manifest.json` must be in
`.obsidian/plugins/randomness/`, NOT in `.obsidian/plugins/`.

## Smoke test 1: codeblock rendering (~1 minute)

Create a new note and paste this:

````markdown
```randomness
Table: Settlement
Stonewatch
Riverbend
Greenhollow
Ashpoint
```
````

Switch to reading view (or wait for live preview to render). You
should see one of "Stonewatch", "Riverbend", "Greenhollow", or
"Ashpoint" displayed.

Reload the note. The result may change on each render — that's the
default behavior. (To stabilize, turn on **Settings → Randomness →
Stable codeblock seeds**.)

**Expected:** a settlement name renders.
**If broken:** the entire codeblock shows as plain code (post-processor
not registered) or you see "Rolling…" forever (engine threw and
didn't catch — open dev console for the trace).

## Smoke test 2: inline rdm: with lock (~2 minutes)

In the same note, add:

```markdown
The traveler met `rdm:[@Settlement]` at the crossroads.
```

In reading view you should see the `rdm:[@Settlement]` replaced by
a styled span showing a settlement name with 🔒 and 🎲 icons on hover.

- Click 🎲 — the result re-rolls.
- Click 🔒 — the underlying source text changes to something like
  `rdm:[@Settlement]⟹Riverbend`. Switch to edit view to confirm.
  The lock survives note close/reopen, Obsidian restart, and sync.
- Click 🎲 on the now-locked span — the lock suffix disappears
  from the source.

**Expected:** preview/lock/reroll all work; locked state is visible
in the source text.
**If broken:** if no buttons appear, the inline post-processor isn't
wired correctly. If clicking the buttons doesn't change the source,
the `vault.process` write path is broken — check dev console.

## Smoke test 3: prompts (~1 minute)

Add another codeblock:

````markdown
```randomness
Prompt: Mood {Cheerful|Grim|Suspicious}Grim
Table: Greeting
"Well met!" they said, looking {$prompt1}.
```
````

You should see a dropdown labeled "Mood" above the rendered output,
with "Grim" preselected. The output should say:
`"Well met!" they said, looking Grim.`

Change the dropdown to "Cheerful" — the output should re-render
with the new value.

**Expected:** dropdown above output; changes trigger re-render.

## Smoke test 4: .ipt file view (~1 minute)

Create a file called `test.ipt` in your vault (any folder).
Contents:

```
Table: Loot
1 gold piece
A rusty dagger
Three apples
A suspicious letter
```

In the file explorer, click `test.ipt`. It should open in a custom
view showing one of the four loot items, with **Reroll** (🎲) and
**Open as Markdown** icons in the title bar.

- Click 🎲 — gets a new loot item.
- Click the file-text icon — switches to the standard markdown
  editor showing the raw source.

**Expected:** custom view renders, both actions work.
**If broken:** if `.ipt` opens in plain text, another plugin may
have claimed `.ipt` (check dev console for a Randomness warning).

## Smoke test 5: Use: across files (~2 minutes)

Create `Generators/names.ipt` somewhere in your vault:

```
Table: FirstName
Tessith
Korad
Mira
Vex

Table: FullName
[@FirstName] of [@Town]

Table: Town
Greenhollow
Stonewatch
```

Now in any note's codeblock:

````markdown
```randomness
Use:Generators/names.ipt
Table: NPC
A traveler named [@FullName].
```
````

**Expected:** "A traveler named Tessith of Greenhollow." (or similar).
**If broken:** "Use: target not found" error block means the path
didn't resolve. Either fix the path or set **Settings → Randomness →
Generator root** to `Generators` so the lookup falls back there.

## Smoke test 6: commands (~1 minute)

In a note with several `rdm:` calls (some locked, some not):

1. Open the command palette (`Ctrl/Cmd-P`).
2. Run **Randomness: Lock all unfilled rdm: in current note**.
   A notice should appear: "locked N calls". All unfilled calls now
   have `⟹result` suffixes in the source.
3. Run **Randomness: Reroll all rdm: in current note**. Notice:
   "rerolled — unlocked N calls". All locks removed; next render
   produces fresh previews.

**Expected:** both commands work end-to-end.

## Smoke test 7: sanitisation (~30 seconds)

Paranoid check that the HTML sanitiser works. Try this:

````markdown
```randomness
Table: T
safe<script>alert('XSS')</script>also-safe
```
````

**Expected:** you see "safealso-safe" (the `<script>` and its
content are stripped). No alert dialog. If an alert pops up, the
sanitiser isn't wired — STOP and report.

## What to file a bug report about

Open dev tools (`Ctrl/Cmd-Shift-I`), reproduce the issue, and include:

- The console output (red errors especially)
- The exact source of the codeblock or inline call
- Your settings (Generator root path, formatting mode, stable seeds)
- Obsidian version + platform

## Known limitations (not bugs)

- **No file-edit invalidation** — if you edit a `Use:`'d file, notes
  that reference it won't auto-refresh. Reload the note manually.
- **Lock targets the first unfilled with matching expression** — if
  you have two identical `rdm:[@X]` and click 🔒 on the second,
  it locks the first. Workaround: vary the expressions or use
  "Lock all".
- **No mobile testing has been done** — `isDesktopOnly: false` in the
  manifest is aspirational; the plugin uses only DOM APIs that
  should work on mobile, but it hasn't been smoke-tested on iOS or
  Android yet.

## Known plugin conflicts

- **Dataview** — earlier versions of this plugin used `=rdm:` as
  the inline trigger, which collided with Dataview's inline DQL
  syntax (Dataview claims any code span starting with `=`). The
  prefix is now `rdm:` (no equals sign), which Dataview leaves
  alone. If you see "Dataview (inline field 'rdm:'): Error: PARSING
  FAILED" anywhere, you're on an old build — update.
- **Various Complements / autocomplete plugins** — if you have an
  autocomplete plugin running, it may pop up dictionary suggestions
  while you're typing inline `rdm:` expressions. Harmless but
  distracting; turn the plugin off for notes where you're authoring
  generators, or add an exclusion for the `rdm:` pattern in its
  settings.
