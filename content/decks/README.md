# Example deck bundles

Downloaded on demand by the plugin's settings buttons ("Example
deck: …") — never shipped inside the plugin release, so the base
install stays small. Each bundle folder contains an `index.json`
(`{ "name": "<Deck Name>", "files": [...] }`) and the files it
lists; the installer writes them to `<Generator Root>/Decks/<Deck
Name>/` in the user's vault. Images listed in `files` are fetched
as binary — to add card art to a bundle, drop the images in the
bundle folder (named to slug-match the card keys, e.g.
`the-tower.png` ↔ `The Tower`) and list them in `index.json`.

Licensing:

- `playing-cards` — a standard 54-card deck as text; no copyrightable
  content.
- `tarot-rws` — the Rider–Waite–Smith tarot (first published 1909,
  public domain). Card meanings are condensed from A. E. Waite,
  *The Pictorial Key to the Tarot* (1911), public domain. Any card
  scans added here must come from a public-domain source (e.g. the
  Wikimedia Commons RWS scans).
