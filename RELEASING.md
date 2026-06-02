# Releasing Randomness

Releases are tag-driven. Pushing a version tag (like `1.0.11`) to GitHub
triggers `.github/workflows/release.yml`, which verifies, tests, builds,
and publishes a GitHub Release with the loose plugin files attached.
You don't build or upload anything by hand.

> **Tag format: bare version, no `v` prefix.** Obsidian's community-
> plugin checker matches the tag literally against `manifest.version`,
> so `1.0.11` is correct; `v1.0.11` is not.

---

## What the workflow does

When a tag matching `[0-9]+.[0-9]+.[0-9]+` is pushed, GitHub Actions:

1. **Checks out the repo at the tag.**
2. **Installs deps** via `npm ci`.
3. **Verifies the tag matches `manifest.version`.** If they disagree,
   the workflow fails before doing anything else. This catches the
   class of bug where a tag says `1.0.11` but the shipped
   `manifest.json` still reads `1.0.10` — BRAT and Obsidian would both
   trip on it.
4. **Runs the full test suite** (`npm test -- --ci`). A tagged build
   with failing tests must not publish. Currently 1,036 tests across
   45 suites.
5. **Builds** the plugin (`npm run build`) and verifies `main.js`,
   `manifest.json`, and `styles.css` all exist.
6. **Attests build provenance** so installers can verify the artefacts
   came from this workflow on this repo.
7. **Extracts release notes** from `CHANGELOG.md` — the section under
   `## <tag>` becomes the release body. A missing section produces a
   warning + a generic body, not a failure.
8. **Publishes** a GitHub Release titled `Randomness <tag>` with
   `main.js`, `manifest.json`, and `styles.css` attached as **loose
   files** (not zipped — the community-plugin checker requires this).

The workflow also supports manual re-runs via the Actions UI
(`workflow_dispatch` with a `tag` input) — useful if a first attempt
failed mid-build.

---

## Releasing a new version (step-by-step)

For a typical patch release, e.g. `1.0.12`:

### 1. Update versions in the three places they live

- **`manifest.json`** — `"version": "1.0.12"` and (if you've bumped the
  minimum Obsidian version) `"minAppVersion"`.
- **`package.json`** — `"version": "1.0.12"`.
- **`versions.json`** — add a new entry mapping the version to the
  required `minAppVersion`, e.g. `"1.0.12": "1.4.0"`. Keep older
  entries; this file is how older Obsidian installs find a compatible
  release.

A one-liner that does all three (run from the repo root, replace
`1.0.12`):

```sh
VERSION=1.0.12
node -e "
  for (const f of ['manifest.json','package.json']) {
    const j = require('./'+f);
    j.version = '$VERSION';
    require('fs').writeFileSync(f, JSON.stringify(j,null,'\t')+'\n');
  }
  const v = require('./versions.json');
  v['$VERSION'] = v[Object.keys(v)[0]];  // copy minAppVersion from latest
  require('fs').writeFileSync('versions.json', JSON.stringify(v,null,'\t')+'\n');
"
```

(Eyeball `versions.json` afterwards — the auto-copy assumes the
`minAppVersion` is unchanged. If you actually bumped the floor, fix
the new entry by hand.)

### 2. Write the CHANGELOG entry

Add a section at the top of `CHANGELOG.md`:

```markdown
## 1.0.12

### Added
- New thing.

### Fixed
- Bug.
```

The workflow extracts everything between `## 1.0.12` and the next
`## ` heading. Conventions used so far:

- One section per release, version as the heading.
- Group under **Added** / **Changed** / **Fixed** / **Removed** as
  appropriate.
- Bold the lead noun ("**`dictKey` option for dictionary tables.**") —
  it reads cleanly in the GitHub Release UI.

### 3. Commit, push, tag, push tag

```sh
git add manifest.json package.json versions.json CHANGELOG.md
git commit -m "Release 1.0.12"
git push origin main

# Then tag and push the tag — THIS is what triggers the workflow.
git tag 1.0.12          # bare version, no 'v'
git push origin 1.0.12
```

### 4. Watch the Actions tab

Open the [Actions tab](https://github.com/Obsidian-TTRPG-Community/Randomness/actions)
and watch the `Release` workflow run. It typically takes a couple of
minutes. On success there's a new GitHub Release with the three loose
files attached.

### 5. Sanity-check the published release

- The release tag should read `1.0.12` (not `v1.0.12`).
- Open `manifest.json` from the release assets and confirm
  `"version": "1.0.12"`.
- The release body should be the CHANGELOG section, not the generic
  fallback.

---

## When something goes wrong

### Tag-vs-manifest mismatch ("Tag does not match manifest.version")

You tagged before bumping, or you bumped but didn't commit the bump,
or the commit wasn't pushed. Fix:

```sh
# Delete the bad tag locally and remotely.
git tag -d 1.0.12
git push --delete origin 1.0.12

# Bump manifest/package/versions properly, commit, push.
# Then re-tag.
git tag 1.0.12
git push origin 1.0.12
```

### Tests failed in CI

The workflow stops before publishing — there's no half-released state
to clean up. Fix the failing test(s) on a branch, merge, then re-tag
(deleting the bad tag first as above).

### The release was created but assets are wrong

Use the manual re-run path. In the Actions tab, click **Release** →
**Run workflow**, type the tag (e.g. `1.0.12`), and run. The workflow
detects the existing release and updates notes + replaces assets via
`--clobber`. No need to delete the release first.

### CHANGELOG section missing

The workflow won't fail — it logs a warning and publishes with a
generic body. To fix retrospectively: add the section to `CHANGELOG.md`,
commit, then trigger a manual re-run for that tag (it'll re-extract
the notes).

---

## What's NOT in this workflow (deliberate)

- **No release-please / conventional-commits bot.** Releases are
  hand-tagged. If we ever want auto-bumped release PRs from
  conventional commits, that's a separate workflow added alongside,
  the way Relations has it.
- **No pre-release tags.** The tag pattern is strict
  `[0-9]+.[0-9]+.[0-9]+`. If we want `1.1.0-beta.1` releases, the
  pattern needs widening — easy change when needed.
- **No npm publish.** Randomness ships as an Obsidian plugin, not an
  npm package; the only consumers fetch from GitHub Releases / BRAT.

---

## First-time setup checklist (one-off)

If this is the very first time using this workflow on a fresh clone:

- [ ] `.github/workflows/release.yml` is in `main`.
- [ ] Repo settings → Actions → General → Workflow permissions:
      "Read and write permissions" (needed so the workflow can
      create releases and upload assets via `GITHUB_TOKEN`).
- [ ] Bumped `manifest.json`, `package.json`, and `versions.json`
      together for the first release; matched the CHANGELOG section.
- [ ] First release goes via the normal flow above — there's no
      separate bootstrapping step.
