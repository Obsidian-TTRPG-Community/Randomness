# Changelog

All notable changes to the Randomness plugin.

## 1.0.12

### Fixed
- **Dictionary keys with spaces or other punctuation now work in
  `api.roll`/`rollUnscoped` via `dictKey`.** 1.0.11 built
  `[#<key> <Table>]` expressions internally; that form whitespace-
  splits, so a key like `"Knight Bachelor"` was misparsed as key
  `Knight` against a non-existent table `Bachelor <Table>`. The API
  now looks the entry up directly via a new `Evaluator.runByKey`
  method, passing the key verbatim. Hyphenated, punctuated, and
  embedded-quote keys all resolve.

### Added
- **Quoted-key syntax for IPP3 dictionary lookups.** In a `.ipt`
  file, write `[#"key with spaces" Table]` to look up a dictionary
  entry whose key isn't a single bareword. Embedded double-quotes
  can be escaped: `[#"a \"b\" c" Table]`. Unquoted keys
  (`[#Plain Table]`, `[#Master-Adept Table]`, `[#{$var} Table]`)
  continue to work exactly as before — the quoted form is additive,
  not a syntax change. Reported by claudermilk while building an
  NPC generator driven by meta-bind dropdowns.

## 1.0.11

### Added
- **`dictKey` option for dictionary tables.** `roll()` and `rollUnscoped()`
  now accept a `dictKey` to look up an entry in a `Type: Dictionary`
  table — equivalent to the IPP3 `[#<key> <Table>]` pick syntax.
  Reported: calling `api.roll()` on a dictionary table silently returned
  an empty string because dictionaries aren't rolled randomly and
  `promptValues` doesn't address dictionary keys. The
  `rollExpression("[#<key> <Table>]")` form already worked and
  continues to; `dictKey` is the typed convenience for callers that
  have a key in hand (typically from frontmatter or a meta-bind input).
  Unknown keys return an empty string, matching IPP3's `[#bogus Table]`
  behaviour.

## 1.0.10

### Fixed
- **macOS Unicode (NFD/NFC) filename matching.** macOS filesystems
  store names in Unicode NFD (decomposed); a `Use:` reference typed or
  stored in NFC has different bytes for any accented/combining character
  even though it looks identical. The index and the file-source lookups
  now normalise both sides to NFC before comparing, so a reference
  matches its on-disk file regardless of composition form. (Pure-ASCII
  names are unaffected — NFC is a no-op there.)

## 1.0.9

### Changed
- **"Diagnose generator resolution" now dumps the raw folder listing.**
  The command prints every file in the active note's folder verbatim
  (quoted, so trailing spaces or control characters are visible) and
  unfiltered (so non-`.ipt` names show too), and compares the raw
  adapter listing against what Obsidian's `getFiles()` reports for the
  same folder. This pinpoints cases where a file renders in Obsidian's
  tree/embed but a `Use:` reference can't match it on disk — e.g. a
  hidden double extension (`portraits.ipt.txt`), a trailing space, or an
  odd Unicode form.

## 1.0.8

### Fixed
- **Legacy sub-path `Use:` references now resolve.** Community IPP3
  files (e.g. the NBOS corpora) reference imports with Windows
  backslashes, lowercase, and a folder layout that doesn't match the
  vault — for instance `Use: nbos\names\orc.ipt` when the real file is
  `…/Common/nbos/Names/Orc.ipt`. The index fallback previously fired
  only for bare filenames (no slashes), so these sub-path references
  failed even though the target file was indexed. The fallback now also
  handles slashed references: it matches on the basename and, when
  several files share it, prefers the one whose path ends with the
  reference's suffix (case-insensitively). Positional resolution still
  takes priority, so explicit relative/rooted paths are unaffected.

## 1.0.7

### Fixed
- **Disk-scan fallback now actually runs (root path convention).** The
  fallback that scans the vault on disk for `.ipt` files Obsidian hasn't
  indexed started its recursive walk at `"/"`, but Obsidian's adapter
  uses `""` for the vault root — so `adapter.list("/")` returned nothing
  useful and the whole scan silently found zero files (reported as
  `fromDiskScan: 0`). The walk now starts at `""` and descends properly,
  so a sibling `.ipt` that `getFiles()` omitted (the reported case:
  `portraits.ipt` next to its note, embeddable by Obsidian yet absent
  from the metadata index) is now discovered and indexed.

### Changed
- **"Diagnose generator resolution" now tests the adapter directly.** In
  addition to listing the index, it lists the active note's folder via a
  live `adapter.list` and attempts `adapter.read` on each `.ipt` there —
  so a report shows definitively whether a file is missing from the
  index vs. unreadable by the adapter.

## 1.0.6

### Added
- **"Diagnose generator resolution" command.** Lists every `.ipt` file
  the index currently holds (and the active note's folder-siblings) to
  the developer console, plus a notice with the count. Turns "why won't
  my `Use:` resolve?" from guesswork into a definitive check: if the
  file isn't in the list, it isn't indexed (check the generator-root
  setting and the `.ipt` extension); if it is, resolution should work.

## 1.0.5

### Fixed
- **Inline and codeblock `Use:` now consult the vault index.** Inline
  `rdm:` calls and `randomness` codeblocks resolved their `Use:`
  directives only positionally (caller dir, generator root, vault root)
  via the adapter — they never used the bare-filename index the way the
  public API and "Rebuild generator index" do. So a `Use: portraits.ipt`
  could fail in a note even when the file was a correct sibling and the
  index knew exactly where it was. All three paths (inline, codeblock,
  API) now share the same index-backed resolution, so a bare `Use:`
  resolves consistently everywhere. This was the remaining cause of the
  image-embed demo's "Use: target not found" after 1.0.2–1.0.4.

## 1.0.4

### Added
- **Index rebuild now reports what it found.** Running "Rebuild
  generator index" shows an Obsidian notice summarising the result
  (e.g. "index rebuilt — 23 generator files, 168 tables") and logs full
  detail to the developer console, including a count of files
  discovered only by the on-disk scan — i.e. files Obsidian hadn't
  indexed yet. That count is a quick diagnostic: non-zero means the
  disk-scan fallback (1.0.3) just caught files the metadata index
  missed.

## 1.0.3

### Fixed
- **Generator index now finds files Obsidian hasn't indexed.** The
  bare-filename resolver and the "Rebuild generator index" command both
  built their index purely from Obsidian's metadata index
  (`vault.getFiles()`), which omits `.ipt` files Obsidian hasn't
  registered yet — so a `Use: portraits.ipt` could fail to resolve, and
  rebuilding the index didn't help because it read from the same
  incomplete source. The index now *also* scans the vault on disk via
  the adapter, and reads unindexed files directly, so dropped-in `.ipt`
  files resolve (and "Rebuild generator index" genuinely picks them up).
- Builds on the 1.0.2 file-resolution fallbacks for the same root cause.

## 1.0.2

### Fixed
- **`Use:` target not found for files added outside Obsidian.** A `.ipt`
  file dropped into the vault via Finder/Explorer could fail to resolve
  from a `Use:` directive at every location, because file lookups went
  only through Obsidian's metadata index (`getFiles`), which doesn't
  include files Obsidian hasn't indexed yet. File resolution now falls
  back to a raw `adapter.list()` directory scan that reads the vault
  contents directly, catching unindexed files (and resolving them
  case-insensitively). Reported on macOS with `portraits.ipt`.
- **Clearer "not found" error.** When a `Use:` target can't be resolved,
  the error now points at the most common real cause — an unindexed
  file — and suggests reloading Obsidian or running "Rebuild generator
  index", instead of implying the path is wrong.

## 1.0.0

First stable release. Full implementation and documentation of the
public JavaScript API; the complete API surface (version `1.0.0`) is
implemented, covered by 64 dedicated tests, and documented in
[API.md](API.md). Ships with an expanded PF2e settlement generator
library.

This release marks the plugin as stable for general use. The API
surface is committed: breaking changes to it will bump the major
version.

**Thanks to [@pjjelly17](https://github.com/pjjelly17)**, whose PR #1
proposed the public JS API that this release builds on and documents.

### Added
- **`rollUnscoped(tableName, opts?)`** — roll a table found anywhere in
  the vault, ignoring note scope. Searches every `.ipt` file (under the
  generator root, if configured), loads the defining file plus its full
  `Use:` graph, and rolls. This is the method to use for note generation
  and automation, where no note scope is wired up. Accepts `seed`,
  `promptValues`, and `filePath` (to disambiguate name collisions).
- **Vault index** — basename and table-name index over the generator
  library, powering bare-filename `Use:` resolution and faster
  `rollUnscoped`. Invalidates on vault create/delete/rename/modify.
- **"Rebuild generator index" command** — manual rescan of the
  generator library, as an escape hatch if the index looks stale.
- **Ambiguity warning** — when `rollUnscoped` finds multiple files
  defining the same table name, it logs a one-time console warning
  naming the colliding files and the one chosen, and points to the
  `filePath` option.
- **`promptValues` and `seed` wired through** the public roll methods to
  the engine (real prompt overrides and deterministic rolls, not no-ops).
- **`API.md`** — full reference for the public API: every method, the
  `RollResult`/`TableSource` shapes, scoped vs. unscoped guidance,
  prompts, collision handling, and recipes.

### Notes
- The public API surface version is `1.0.0`. The plugin version (this
  `1.0.0`) and the API version are tracked separately; read `api.version`
  for the latter.

### Fixed
- CSS lint: the broken-link style now uses a dashed `border-bottom`
  instead of an underline decoration, clearing the community-plugin
  linter's "partially supported on minAppVersion" warning. Identical
  visual result.

## 0.6.0
- Vault index for basename and table-name lookup.

## 0.5.x
- Public JS API introduced (`roll`, `rollExpression`, `tables`,
  `tablesWithSources`, `onRoll`, `version`), then `rollUnscoped` added.

## 0.4.4
- Community-plugin review fixes: replaced `builtin-modules` dependency
  with Node's `module.builtinModules`; CSS `text-decoration` shorthand
  split into longhand for Electron compatibility.
