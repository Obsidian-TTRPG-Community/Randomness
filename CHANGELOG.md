# Changelog

All notable changes to the Randomness plugin.

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
