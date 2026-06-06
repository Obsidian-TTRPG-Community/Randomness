# Randomness 1.0.13 release pack

Drop into your repo root (merges with existing files).

## Verified

- 969 / 969 tests green (up from 957; added 12 regression tests in __tests__/integration/ipp3-compat.test.ts)
- Build clean
- Ultimate Powers Character Generator renders complete NPCs (1900+ chars, fully varied across seeds)
- Dungeon Room Description renders varied door + room descriptions

## Release sequence

    npm test            # should be 969 / 969
    npm run build       # should produce main.js cleanly
    git add .
    git commit -m "Release 1.0.13: IPP3 compatibility — community generator support"
    git push origin main
    git tag 1.0.13
    git push origin 1.0.13
