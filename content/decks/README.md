# Example deck bundles

Downloaded on demand by the plugin's settings buttons ("Example
deck: …") — never shipped inside the plugin release, so the base
install stays small. Each bundle folder contains an `index.json`
(`{ "name": "<Deck Name>", "files": [...] }`) and the files it
lists; the installer writes them to `<Generator Root>/Decks/<Deck
Name>/` in the user's vault. Images listed in `files` are fetched
as binary; card art pairs with the `.rdm` card keys by slug
(`the-tower.jpg` ↔ `The Tower`), and `_back.*` is the card back.

Licensing:

- `playing-cards` — a standard 54-card deck. The SVG card faces and
  backs are original artwork generated for this plugin (MIT, same as
  the plugin).
- `tarot-rws` — the Rider–Waite–Smith tarot, all 78 cards. The card
  scans reproduce the deck first published in 1909 (art by Pamela
  Colman Smith), which is in the public domain in the United States
  and, since 2022, in the United Kingdom and European Union. Card
  meanings are condensed from A. E. Waite, *The Pictorial Key to the
  Tarot* (1911), also public domain. The `_back.svg` is original
  artwork (MIT).
