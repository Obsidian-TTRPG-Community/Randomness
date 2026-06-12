---
type: guild
subtype: "{{subtype}}"
size: "{{size}}"
town: "{{town}}"
heraldry-seed: <% Date.now().toString(36) + Math.random().toString(36).slice(2, 6) %>
---

# {{name}}
> [!infobox]+
> # {{name}}
> `heraldry:|120`
> ###### Stats
> | Type | Stat |
> | --- | --- |

> [!info] thieves' guild in {{town}}

A criminal syndicate operating in the shadows of {{town}}.

<%*
const api = app.plugins.plugins["randomness"].api;
const P = api.portraits;
const has = P && (await P.available());
const raceWord = (p) => ({ halfelf: "half-elf", halforc: "half-orc" }[p.race] ?? p.race ?? "");
const descOf = (p) => p.age === "old" ? "silver-haired"
  : (p.recipe.parts.scars ?? -1) >= 0 ? "scarred"
  : (p.recipe.parts.facial_hair ?? -1) >= 0 ? "bearded"
  : p.age === "young" ? "fresh-faced" : "";
const infobox = (p, heading, lastRow) => [
  "> [!infobox]", `> # ${p.name}`,
  "> " + P.inlineSnippet(p.recipe, 160),
  `> ###### ${heading}`, "> | |  |", "> | --- | --- |",
  `> | Race | ${raceWord(p)} |`, `> | Gender | ${p.gender} |`,
  `> | Age | ${p.age} |`, `> | ${lastRow} | {{name}} |`, "", "",
].join("\n");
const face = async (p, role) => {
  const beat = (await api.rollUnscoped("Personality")).result;
  return `- ${P.inlineSnippet(p.recipe, 96)} **${p.name}** — ${role}, ${beat}\n`;
};

// The boss — same person in the infobox and the rolled text.
let main = null;
if (has) { main = await P.roll(); tR += infobox(main, "Boss", "Runs"); }

const result = await api.rollUnscoped("TF-Guild", { promptValues: {
  town: "{{town}}", shopType: "{{type}}", shopName: "{{name}}",
  slant: "criminal", size: "{{size}}",
  keeperName: main?.name ?? "", keeperRace: main ? raceWord(main) : "",
  keeperGender: main?.gender ?? "", keeperAge: main?.age ?? "",
  keeperDesc: main ? descOf(main) : ""
}});
tR += result.result;

// Watching the door.
if (has) {
  tR += "\n\n## In the shadows\n\n";
  tR += await face(await P.roll({ age: "young" }), "Lookout");
  tR += await face(await P.roll(), "Fence");
}
%>

```heraldry
```
