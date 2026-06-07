# Randomness 1.0.17 release pack

Tiny follow-up to 1.0.16. Clears the last two warnings flagged by the
automated review (both on `src/views/settings.ts` line 444 — the
`vault.modify(... as any, ...)` cast that 1.0.16 missed).

## What's in here

- `src/views/settings.ts` — imports `TFile`; uses `instanceof TFile`
  to narrow the `vault.getAbstractFileByPath` result instead of
  the `as any` cast
- `manifest.json`, `package.json` — version → 1.0.17
- `versions.json` — adds 1.0.17 entry pointing at minAppVersion 1.7.2
- `CHANGELOG.md` — 1.0.17 entry at top
- `main.js` — production build

No other source files change.

## Release sequence

    # 1. Drop the pack contents into your repo root, overwriting
    #    the matching files.

    # 2. Verify
    npm test          # should be 975 / 975
    npm run build     # clean

    # 3. Commit, push
    git add .
    git commit -m "Release 1.0.17: TFile narrowing cleanup"
    git push origin main

    # 4. Tag
    git tag 1.0.17
    git push origin 1.0.17
