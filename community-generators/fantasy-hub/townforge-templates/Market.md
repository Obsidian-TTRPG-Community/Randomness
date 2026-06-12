---
type: market
subtype: "{{subtype}}"
size: "{{size}}"
town: "{{town}}"
---
# {{name}}

> [!info] {{type}} in {{town}}

A {{type}} in the heart of {{town}}.

<%*
const api = app.plugins.plugins["randomness"].api;
const P = api.portraits;
const has = P && (await P.available());
const face = async (p, role) => {
  const beat = (await api.rollUnscoped("Personality")).result;
  return `- ${P.inlineSnippet(p.recipe, 96)} **${p.name}** — ${role}, ${beat}\n`;
};

// This generator scales with settlement size: pass {{size}} so the
// count and the mix of goods match the town tier. The market has no
// single proprietor — the faces below are the crowd instead.
const result = await api.rollUnscoped("TF-Market", { promptValues: {
  town: "{{town}}", shopType: "{{type}}", shopName: "{{name}}", size: "{{size}}"
}});
tR += result.result;

if (has) {
  tR += "\n\n## Faces in the crowd\n\n";
  tR += await face(await P.roll(), "Stallholder");
  tR += await face(await P.roll(), "Shopper");
  tR += await face(await P.roll({ age: "young" }), "Errand-runner");
}
%>
