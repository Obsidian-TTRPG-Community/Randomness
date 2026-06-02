# Randomness 1.0.11 release pack

Drop this whole folder structure into your repo root (it merges with existing
folders). All paths below are relative to the repo root.

## Files in this pack

### New
- `.github/workflows/release.yml` — tag-triggered release workflow
- `__tests__/api/dictKey.test.ts` — tests for the dictKey API option
- `RELEASING.md` — maintainer guide for releasing
- `demo/shops/place-counts.ipt` — size-aware count helper (new)

### Updated
- `src/api/index.ts` — adds `dictKey` option to roll() and rollUnscoped()
- `manifest.json` — version bumped to 1.0.11
- `package.json` — version bumped to 1.0.11
- `versions.json` — adds 1.0.11 entry
- `CHANGELOG.md` — adds 1.0.11 entry
- `API.md` — adds dictKey docs + Dictionary tables section
- `demo/shops/shop-{general,weapon,armor,alchemy,magic}.ipt` — size scaling
- `demo/shops/place-{market,barracks,guild}.ipt` — size scaling + market composition
- `demo/shops/*` — full demo generator set (32 .ipt files + ATTRIBUTION.md)

## Release sequence

```sh
# 1. Drop the pack contents into your repo (merge with existing folders)
# 2. Verify locally
npm test                  # should be 1,036 / 1,036
npm run build             # produces main.js, manifest.json, styles.css

# 3. Commit and push
git add .
git commit -m "Release 1.0.11: dictKey for dictionary tables + release workflow"
git push origin main

# 4. Verify on github.com that .github/workflows/release.yml is on main

# 5. Tag and push (this triggers the workflow)
git tag 1.0.11
git push origin 1.0.11

# 6. Watch the Actions tab
```

If you need to re-release (failed first attempt):
```sh
git tag -d 1.0.11
git push --delete origin 1.0.11
# fix the issue, commit, push
git tag 1.0.11
git push origin 1.0.11
```
