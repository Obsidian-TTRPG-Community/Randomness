---
type: undertaker
subtype: "{{subtype}}"
size: "{{size}}"
town: "{{town}}"
---
# {{name}}

> [!info] {{type}} in {{town}}

A {{type}} on the streets of {{town}}.

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

// The undertaker — same person in the infobox and the rolled text.
let main = null;
if (has) { main = await P.roll(); tR += infobox(main, "Undertaker", "Keeps"); }

const result = await api.rollUnscoped("TF-Undertaker", { promptValues: {
  town: "{{town}}", shopType: "{{type}}", shopName: "{{name}}",
  keeperName: main?.name ?? "", keeperRace: main ? raceWord(main) : "",
  keeperGender: main?.gender ?? "", keeperAge: main?.age ?? "",
  keeperDesc: main ? descOf(main) : ""
}});
tR += result.result;
%>
