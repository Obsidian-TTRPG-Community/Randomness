# Randomness — Public JS API

Randomness exposes a JavaScript API for other plugins and for
[Templater](https://github.com/SilentVoid13/Templater) scripts. Use it
to roll generators from code — for example, to populate a freshly
created note from a shared generator library.

```js
const api = app.plugins.plugins["randomness"].api;
const result = await api.roll("VillainName");
console.log(result.result); // -> "Mordred the Pale"
```

- **API version:** `1.0.0` (read `api.version`)
- The API is stable within a major version. New methods may be added
  in minor versions; breaking changes bump the major.

---

## Quick reference

| Method | Purpose |
| --- | --- |
| `roll(tableName, opts?)` | Roll a named table **in note scope**. |
| `rollUnscoped(tableName, opts?)` | Roll a named table found **anywhere in the vault**, ignoring scope. |
| `rollExpression(rawExpr, opts?)` | Roll an arbitrary expression, e.g. `"[@A] of [@B]"`. |
| `tables(callerNotePath?)` | List table names visible from a note's scope. |
| `tablesWithSources(callerNotePath?)` | List tables with their source files and scope flag. |
| `onRoll(callback)` | Subscribe to every roll attempt. Returns an unsubscribe fn. |
| `version` | The API version string. |

All roll methods are `async` and return a `Promise<RollResult>`.

---

## Scoped vs. unscoped — which roll do I use?

This is the most important distinction in the API.

**`roll()` is scoped.** It resolves tables the way a codeblock in a note
would: it can see same-note tables and whatever that note's `Use:`
imports bring in. It is the right call when you are rolling *from the
context of a specific note* and want that note's scope to apply.

> Scoped rolls can only reach tables defined in **markdown codeblocks**
> (and their `Use:` graph). They **cannot** reach a bare `.ipt` file's
> `Table:` definitions unless that file is `Use:`d into scope.

**`rollUnscoped()` ignores scope.** It searches every `.ipt` file in the
vault (under the generator root, if one is configured) for a table with
the given name, loads that file plus its entire `Use:` graph, and rolls
it. This is the right call for **automation and note generation**, where
there is no note scope wired up yet.

> Use `rollUnscoped()` when a Templater template creates a new note and
> needs to roll a generator from your shared library. The new note has
> no scope, so a scoped `roll()` would find nothing.

---

## Methods

### `roll(tableName, opts?) → Promise<RollResult>`

Roll a named table in note scope. Internally wraps the name as
`[@tableName]`.

```js
const r = await api.roll("Weather", {
  callerNotePath: "Campaigns/Saltmarsh/Session 12.md",
});
```

**`opts` (`RollOptions`, all optional):**

| Field | Type | Meaning |
| --- | --- | --- |
| `callerNotePath` | `string` | Note path used to resolve scope (which `Use:` imports and same-note tables are visible). Falls back to the active note, then to no scope. |
| `seed` | `number` | Deterministic roll: same seed + same expression + same scope → same result. Omit for normal random behaviour. |
| `promptValues` | `Record<string,string>` | Override generator prompts, keyed by prompt label. Prompts without an override use their declared default. |

---

### `rollUnscoped(tableName, opts?) → Promise<RollResult>`

Roll a named table found anywhere in the vault, ignoring note scope.

```js
const r = await api.rollUnscoped("TF-Inn", {
  promptValues: { town: "Frostkey", shopName: "The Salty Anchor" },
});
```

**`opts` (`UnscopedRollOptions`, all optional):**

| Field | Type | Meaning |
| --- | --- | --- |
| `seed` | `number` | Deterministic roll (wired to the engine RNG). |
| `promptValues` | `Record<string,string>` | Prompt overrides keyed by prompt label. |
| `filePath` | `string` | Disambiguate when multiple files define the same table name: only consider the file at this exact vault path. |

**Collision handling.** If two files define the same table name, the
first discovered (sorted by path) wins, and a one-time warning is logged
to the developer console:

```
randomness: rollUnscoped("Inn") is ambiguous — 2 files define this
table (.../Inns.ipt, .../place-inn.ipt). Using ".../Inns.ipt". Pass
{ filePath: "..." } to choose a specific one.
```

Pass `filePath` to pick the one you mean, or give your tables unique
names to avoid the collision entirely.

---

### `rollExpression(rawExpr, opts?) → Promise<RollResult>`

Roll an arbitrary expression rather than a single named table. Accepts
the same `RollOptions` as `roll()`.

```js
const r = await api.rollExpression("[@FirstName] [@Surname] of [@City]");
```

---

### `tables(callerNotePath?) → Promise<string[]>`

List table names visible from a note's scope, deduplicated and sorted.

```js
const names = await api.tables("Notes/Generators Hub.md");
// -> ["City", "FirstName", "Surname", "Weather", ...]
```

---

### `tablesWithSources(callerNotePath?) → Promise<TableSource[]>`

Like `tables()`, but each entry reports where the table lives and
whether it's in the caller's scope. In-scope tables come first.

```js
const all = await api.tablesWithSources();
const innFiles = all.filter((t) => t.name === "Inn");
// Inspect innFiles[].filePath to see which files define "Inn".
```

Each `TableSource`:

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | `string` | Table name. |
| `source` | `string` | Source label (file title, or `(this note)` for in-note tables). |
| `filePath` | `string` | Vault path of the defining file; `""` for in-note tables. |
| `inScope` | `boolean` | True if reachable from the caller note's scope. |

> This is the diagnostic to reach for when a `rollUnscoped()` returns
> the "wrong" generator: filter by the table name and inspect the
> `filePath`s to find the colliding file.

---

### `onRoll(callback) → () => void`

Subscribe to every roll attempt — both successes and failures. Returns
an unsubscribe function.

```js
const off = api.onRoll((result) => {
  if (result.error) console.warn("roll failed:", result.error);
  else console.log("rolled:", result.result);
});
// later:
off();
```

---

## `RollResult`

Every roll method resolves to a `RollResult`:

| Field | Type | Meaning |
| --- | --- | --- |
| `result` | `string` | Rendered output. On failure, an error-marker string `[ROLL ERROR: ...]` so spliced text shows something visible. |
| `table` | `string` | Table name requested (or the raw expression for `rollExpression`). |
| `expression` | `string` | Full expression evaluated (e.g. `"[@TableName]"`). |
| `source` | `string?` | Note/file path the roll was scoped to, if any. |
| `error` | `string?` | Set only when the attempt threw; the error message. |
| `timestamp` | `string` | ISO 8601 timestamp of the attempt. |
| `rollId` | `string` | Unique ID for this roll (for dedup/history). |

Roll methods do not reject on a generator error — they resolve with a
`RollResult` whose `error` is set and whose `result` is the
`[ROLL ERROR: ...]` marker. Check `result.error` if you need to branch.

---

## Prompts and `promptValues`

A generator can declare prompts:

```
Prompt: town {} an unnamed town
Prompt: shopName {} 
```

`promptValues` overrides them **by label**:

```js
await api.rollUnscoped("TF-Inn", {
  promptValues: { town: "Frostkey", shopName: "The Salty Anchor" },
});
```

- Keys must match the `Prompt:` labels exactly.
- A prompt with no override uses its declared default.
- Inside the generator, prompts are read positionally as `{$prompt1}`,
  `{$prompt2}`, … in declaration order. (A common pattern is to copy
  them into named variables: `Set: town={$prompt1}`.)

---

## Recipes

### Generate a note from a shared generator (Templater)

```js
<%*
const api = app.plugins.plugins["randomness"].api;
const fm = tp.frontmatter;
const r = await api.rollUnscoped("TF-Inn", {
  promptValues: { town: fm.town, shopName: fm.name },
});
tR += r.result;
%>
```

### Deterministic / reproducible rolls

```js
const a = await api.rollUnscoped("Weather", { seed: 12345 });
const b = await api.rollUnscoped("Weather", { seed: 12345 });
// a.result === b.result
```

### Diagnose a wrong / colliding generator

```js
const all = await api.tablesWithSources();
console.table(
  all.filter((t) => t.name === "Inn").map((t) => ({ file: t.filePath }))
);
```

---

## Versioning

`api.version` is the API surface version (currently `1.0.0`), **not** the
plugin version. Consumers can check it:

```js
const api = app.plugins.plugins["randomness"]?.api;
if (!api) {
  // Randomness not installed/enabled.
} else if (!api.version.startsWith("1.")) {
  // Built against a different major; behaviour may differ.
}
```
