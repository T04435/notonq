// One example per kind of keyed block (notonq["<entity_id>"]), for the REST docs and llms-full.txt. Shapes are the
// handlers' own (tests/unit/additive.test.ts runs them); IDs and values are illustrative, lists trimmed with "…".
export type KeyedExample = { kind: string; when: string; code: string };

export const KEYED_EXAMPLES: KeyedExample[] = [
  {
    kind: "filled",
    when: "GET /q/search?types=urn:entity:artist&query=Six Foot Blonde: not in Qloo, filled from open sources",
    code: `"results": [ …Qloo's results…, { "entity_id": "221af8ba-bce4-48f1-a19b-d9562274dc0f", "name": "Six Foot Blonde", … } ],
"notonq": {
  "served_by": "mixed", "gap": { "kind": "G1" }, …,
  "221af8ba-bce4-48f1-a19b-d9562274dc0f": {
    "kind": "filled",
    "served_by": "fallback", "gap": { "kind": "G1", "qloo_status": 200 },
    "proxy": { "replaced": [], "stand_ins": [{ "entity_id": "…", "name": "Honey Butter", "weight": 0.93, "source": "lastfm" }, …] },
    "cache": { … }, "demand": { … }, "provenance": { … }, "confidence": "high", …
  }
}`,
  },
  {
    kind: "candidate",
    when: "GET /q/search?types=urn:entity:artist&query=Tiny Act: several possible artists, none filled yet",
    code: `"results": [ …Qloo's results…, { "entity_id": "a68731a4-990d-55ea-8c49-99c60d66689b", "name": "Tiny Act", … } ],
"notonq": {
  "served_by": "needs_choice",
  "candidates": [{ "key": "lf:tiny-act", "name": "Tiny Act", "entity_id": "a68731a4-990d-55ea-8c49-99c60d66689b", … }],
  "a68731a4-990d-55ea-8c49-99c60d66689b": {
    "kind": "candidate", "key": "lf:tiny-act", "name": "Tiny Act",
    "next": "Send this entity_id to /entities, or as a signal, and NotOnQ fills the artist."
  }
}`,
  },
  {
    kind: "picked",
    when: "GET /q/v2/insights?filter.type=urn:entity:artist&filter.tags=urn:tag:genre:music:60s&signal.location.query=Lagos: a short era list",
    code: `"results": { "entities": [ …Qloo's results…, { "entity_id": "<Qloo's ID>", "name": "Known Act", … } ] },
"notonq": {
  "served_by": "mixed", "gap": { "kind": "G4" }, …,
  "<Qloo's ID>": { "kind": "picked", "ranked_by_qloo": false }
}`,
  },
  {
    kind: "matched",
    when: "GET /q/entities?external.spotify.ids=<id>: Qloo has the artist, not under that Spotify ID",
    code: `"results": [{ "entity_id": "<Qloo's ID>", "name": "…", … }],
"notonq": {
  "served_by": "fallback", "spotify": [{ "spotify_id": "<id>", "via": "musicbrainz_in_qloo", "entity_id": "<Qloo's ID>" }], …,
  "<Qloo's ID>": { "kind": "matched", "spotify_id": "<id>", "via": "musicbrainz_in_qloo" }
}`,
  },
  {
    kind: "gaps",
    when: "GET /q/search?types=urn:entity:artist&query=Kitebird: Qloo's record, with no MusicBrainz ID, and fields Qloo leaves empty",
    code: `"results": [{ "entity_id": "<Qloo's ID>", "name": "Kitebird", "properties": { …, "notonq:home": { "name": "Osaka", "country": "Japan", … }, "notonq:languages": [ … ] }, … }],
"notonq": {
  "served_by": "mixed", "gap": { "kind": "G5" }, …,
  "<Qloo's ID>": {
    "kind": "gaps",
    "fields": ["musicbrainz_id", "wikidata_id", "home", "languages", "genres"],
    "provenance": { "properties.notonq:home": [{ "source": "musicbrainz", "record": "https://musicbrainz.org/artist/…", "licence": "CC0", "method": "copied", … }], … }
  }
}`,
  },
];

/** The plain statement every page carries with the examples. */
export const KEYED_ADDITIVE =
  "These blocks are additive: nothing that was in a response before was removed, renamed or changed, and a client that ignores them works exactly as it did.";
