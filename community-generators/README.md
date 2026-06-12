# Community generators

Generators contributed by Randomness users. Drop them into your vault
and `Use:` them like any other `.ipt` file.

## How this folder works

Each contribution lives in its own subfolder. A typical entry looks like:

```
community-generators/
  example-tavern-names/
    README.md          ← what it does, sample output, author, license
    tavern-names.ipt   ← the generator itself
    ATTRIBUTION.md     ← credits + license (only if non-trivial)
```

Larger contributions can have several `.ipt` files and an `images/`
folder. As long as the top-level `README.md` explains what's in the
folder and how to use it, the internal layout is the author's call.

## How to use a contribution

1. Browse to the folder you want.
2. Download the `.ipt` file(s). On GitHub: open the file, click
   the **Raw** button, then save with your browser. Or clone /
   download the whole repo and pick out what you want.
3. Drop the files anywhere inside your vault. Randomness finds them
   by name, so the path doesn't have to match what's in the
   contributor's vault — but keeping related files in one folder is
   sensible.
4. Reference them from a `randomness` codeblock the same way you
   would your own files:

   ````
   ```randomness
   Use: tavern-names.ipt
   [@TavernName]
   ```
   ````

5. If a contribution depends on other community files, its README
   will say so — download those too.

## Contributing

Two ways, pick whichever fits how you work:

### Easy: submit via a GitHub issue

This is what the **Submit your own** button in the plugin's settings
opens. It pre-fills an issue template asking for your file content,
attribution, and a short description. A maintainer reviews and adds it
to the folder. You'll need a free GitHub account.

### Direct: open a pull request

If you're comfortable with git:

1. Fork the repo, branch off `main`.
2. Add a subfolder under `community-generators/` named for your
   contribution (kebab-case, e.g. `desert-encounters/`).
3. Inside it: at minimum, a `README.md` (describe + sample +
   attribution) and your `.ipt` file(s).
4. Open a PR. Reviewers may ask for changes — usually just
   formatting, attribution clarity, or a clearer description.

See `CONTRIBUTING.md` at the repo root for the full guidelines.

## What gets accepted

- Original content, or content you have permission to share, under
  a license that lets others use and adapt it (CC0 / CC-BY /
  MIT-style work well for tables).
- Randomness generator files (`.rdm`, or legacy `.ipt`) that work with the released version of
  Randomness (no patches required).
- A `README.md` that explains what the generator does, a sample
  output or two, and the license.

## What doesn't

- Verbatim tables from copyrighted sources you don't have rights
  to. Inspiration is fine; re-publishing isn't.
- NSFW / harassment / hate content.
- Generators that depend on un-released or patched plugin
  versions — wait until the change ships, then submit.
- Solicitation, spam, or anything that's really just an
  advertisement.

Maintainers reserve the right to decline submissions or ask for
changes. Inclusion isn't an endorsement.
