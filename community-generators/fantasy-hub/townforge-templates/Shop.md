---
type: shop
subtype: "{{subtype}}"
size: "{{size}}"
town: "{{town}}"
---
# {{name}}

> [!info] {{subtype}} {{type}} in {{town}}

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

// ─── ONE keeper + ONE customer across the whole note ──────────────
// Both rolled once; the generator's Proprietor line, quotes, and
// "Also here" customer all describe these exact people. With no pack
// installed both stay null and the generator rolls its own (as before).
let keeper = null, shopper = null;
if (has) {
  keeper = await P.roll();
  shopper = await P.roll();
  // Constrain if you like, e.g.:
  //   P.roll({ gender: "female", race: "gnome", age: "old" })
  tR += infobox(keeper, "Shopkeeper", "Runs");
}

const shop = await api.rollUnscoped("TF-ShopByType", {
  promptValues: {
    town: "{{town}}",
    shopType: "{{subtype}}",
    shopName: "{{name}}",
    size: "{{size}}",
    keeperName: keeper?.name ?? "",
    keeperRace: keeper ? raceWord(keeper) : "",
    keeperGender: keeper?.gender ?? "",
    keeperAge: keeper?.age ?? "",
    keeperDesc: keeper ? descOf(keeper) : "",
    custName: shopper?.name ?? "",
    custRace: shopper ? raceWord(shopper) : "",
    custDesc: shopper ? descOf(shopper) : ""
  }
});
tR += shop.result;

// The customer from the "Also here" line, with a face.
if (has && shopper) {
  tR += "\n\n## Seen browsing\n\n";
  tR += `- ${P.inlineSnippet(shopper.recipe, 96)} **${shopper.name}**\n`;
}
%>
