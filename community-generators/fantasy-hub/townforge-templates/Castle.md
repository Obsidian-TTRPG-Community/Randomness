---
type: castle
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

> [!info] {{type}} in {{town}}

A {{type}} overlooking {{town}}.

<%*
const api = app.plugins.plugins["randomness"].api;
const P = api.portraits;
const has = P && (await P.available());
const raceWord = (p) => ({ halfelf: "half-elf", halforc: "half-orc" }[p.race] ?? p.race ?? "");
const descOf = (p) => p.age === "old" ? "silver-haired"
  : (p.recipe.parts.scars ?? -1) >= 0 ? "scarred"
  : (p.recipe.parts.facial_hair ?? -1) >= 0 ? "bearded"
  : p.age === "young" ? "fresh-faced" : "";
const infobox = (p, heading, lastRowName, lastRowVal) => [
  "> [!infobox]", `> # ${p.name}`,
  "> " + P.inlineSnippet(p.recipe, 160),
  `> ###### ${heading}`, "> | |  |", "> | --- | --- |",
  `> | Race | ${raceWord(p)} |`, `> | Gender | ${p.gender} |`,
  `> | Age | ${p.age} |`, `> | ${lastRowName} | ${lastRowVal} |`, "", "",
].join("\n");
const face = async (p, role) => {
  const beat = (await api.rollUnscoped("Personality")).result;
  return `- ${P.inlineSnippet(p.recipe, 96)} **${p.name}** — ${role}, ${beat}\n`;
};

// The ruler — same person in the infobox and the rolled text.
let main = null;
if (has) { main = await P.roll(); tR += infobox(main, "Ruler", "Holds", "{{name}}"); }

const result = await api.rollUnscoped("TF-Castle", { promptValues: {
  town: "{{town}}", shopType: "{{type}}", shopName: "{{name}}",
  keeperName: main?.name ?? "", keeperRace: main ? raceWord(main) : "",
  keeperGender: main?.gender ?? "", keeperAge: main?.age ?? "",
  keeperDesc: main ? descOf(main) : ""
}});
tR += result.result;

// The household.
if (has) {
  tR += "\n\n## At court\n\n";
  tR += await face(await P.roll(), "Captain of the guard");
  tR += await face(await P.roll(), "Steward");
}
%>

```heraldry
```
