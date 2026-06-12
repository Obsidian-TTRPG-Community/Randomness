---
type: stable
subtype: "{{subtype}}"
size: "{{size}}"
town: "{{town}}"
---
# {{name}}

> [!info] {{type}} in {{town}}

A {{type}} on the outskirts of {{town}}.

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

// The stablemaster — same person in the infobox and the rolled text.
let main = null;
if (has) { main = await P.roll(); tR += infobox(main, "Stablemaster", "Runs"); }

const result = await api.rollUnscoped("TF-Stable", { promptValues: {
  town: "{{town}}", shopType: "{{type}}", shopName: "{{name}}",
  keeperName: main?.name ?? "", keeperRace: main ? raceWord(main) : "",
  keeperGender: main?.gender ?? "", keeperAge: main?.age ?? "",
  keeperDesc: main ? descOf(main) : ""
}});
tR += result.result;

// Help in the yard.
if (has) {
  tR += "\n\n## In the yard\n\n";
  tR += await face(await P.roll({ age: "young" }), "Stablehand");
}
%>
