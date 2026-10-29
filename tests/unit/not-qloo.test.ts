import { beforeEach, describe, expect, it } from "vitest";
import { sameStrictName } from "@/server/qloo/gap";
import { handleRest } from "@/server/rest";
import { memoryDb, type Sql } from "@/server/store/db";
import { fakeFetch, json, mbid, qid, qlooArtist } from "./fixtures";

// Qloo's "Newact" is one band; "Newact!" (MusicBrainz, a different record) is another: punctuation tells them apart.
const OURS = mbid(99);
const THEIRS = mbid(98);
const routes = (qlooSearch: () => Response): [string, (u: URL) => Response][] => [
  ["hackathon.api.qloo.com/search", qlooSearch],
  ["hackathon.api.qloo.com/entities", () => json(200, { results: [qlooArtist(1, "Similar 1", { mb: 1 }), qlooArtist(2, "Similar 2", { mb: 2 })] })],
  ["hackathon.api.qloo.com/v2/insights", () => json(200, { success: true, results: { entities: [qlooArtist(70, "Rec")] } })],
  [`musicbrainz.org/ws/2/artist/${OURS}`, () => json(200, { id: OURS, name: "Newact!", country: "JP" })],
  [
    "musicbrainz.org/ws/2/artist?query=",
    () =>
      json(200, {
        artists: [
          { id: THEIRS, name: "Newact", score: 100, country: "GB" },
          { id: OURS, name: "Newact!", score: 100, country: "JP" },
        ],
      }),
  ],
  ["query.wikidata.org", () => json(200, { results: { bindings: [] } })],
  ["method=artist.getinfo", () => json(200, { artist: { stats: { listeners: "1000" } } })],
  ["method=artist.getsimilar", () => json(200, { similarartists: { artist: [1, 2].map((n) => ({ name: `Similar ${n}`, mbid: mbid(n), match: "0.9" })) } })],
];
const qlooHasTheirs = () => json(200, { results: [qlooArtist(60, "Newact", { mb: 98 })] });

let sql: Sql;
beforeEach(async () => {
  sql = await memoryDb();
});
const deps = (fetch: typeof globalThis.fetch) => ({ sql, baseUrl: "https://hackathon.api.qloo.com", salt: "t", fetch });
const search = (fetch: typeof globalThis.fetch, query: string, extra: Record<string, string> = {}) =>
  handleRest({ path: "search", params: { query, types: "urn:entity:artist", ...extra }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));

describe("a same-named artist in Qloo that isn't the one asked for", () => {
  it("keeps punctuation in the strict name only", () => {
    expect(sameStrictName("ANORAK!", "anorak!")).toBe(true);
    expect(sameStrictName("ANORAK!", "Anorak")).toBe(false);
    expect(sameStrictName("Beyoncé", "Beyonce")).toBe(true);
  });

  it("fills the artist named exactly as asked, after Qloo's unchanged result, when only punctuation matched Qloo's", async () => {
    const { fetch } = fakeFetch(routes(qlooHasTheirs));
    const out = await search(fetch, "Newact!");
    const body = out.body as { results: { entity_id: string; name: string }[]; notonq: { served_by: string; gap: { kind: string } } };
    expect(body.results[0].entity_id).toBe(qid(60));
    expect(body.results.map((r) => r.entity_id)).toContain(OURS);
    expect(body.notonq).toMatchObject({ served_by: "mixed", gap: { kind: "G1" } });
  });

  it("picks the MusicBrainz record when the same band also arrives from Deezer, and fills its release languages", async () => {
    const { fetch } = fakeFetch([
      ["api.deezer.com/search/artist", () => json(200, { data: [{ id: 555, name: "Newact!", nb_fan: 3, link: "https://www.deezer.com/artist/555" }] })],
      ["api.deezer.com/artist/555", () => json(200, { data: [] })],
      ["musicbrainz.org/ws/2/release?artist=", () => json(200, { releases: [{ "text-representation": { language: "jpn" } }] })],
      ...routes(qlooHasTheirs),
    ]);
    const out = await search(fetch, "Newact!");
    const ours = (out.body as { results: { entity_id: string; properties: Record<string, unknown> }[] }).results.find((r) => r.entity_id === OURS);
    expect(ours?.properties["notonq:home"]).toMatchObject({ country_code: "JP" });
    expect(ours?.properties["notonq:languages"]).toEqual([{ code: "jpn", name: "Japanese", releases: 1 }]);
  });

  it("leaves Qloo's answer alone when the name matches as written", async () => {
    const { fetch } = fakeFetch(routes(qlooHasTheirs));
    expect((await search(fetch, "Newact")).body).not.toHaveProperty("notonq.gap");
  });

  it("looks past Qloo's same name when asked to (notonq.not_qloo=1, Ask after Jev rejects it)", async () => {
    const { fetch } = fakeFetch(routes(() => json(200, { results: [qlooArtist(60, "Newact!", { mb: 98 })] })));
    const out = await search(fetch, "Newact!", { "notonq.not_qloo": "1" });
    expect((out.body as { results: { entity_id: string }[] }).results.map((r) => r.entity_id)).toContain(OURS);
  });
});
