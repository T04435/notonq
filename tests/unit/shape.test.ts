import { describe, expect, it } from "vitest";
import { genreTag, resolveArtist } from "@/server/engine/artist";
import { qlooClient } from "@/server/qloo/client";
import { fakeFetch, json, mbid, qlooArtist } from "./fixtures";
import { foreignKeys, QlooArtist } from "./qloo-shape";

const NEW = mbid(99);

// A Qloo-shaped artist exactly as the live API returns it (hand-made values, real key layout).
const qlooLike = {
  name: "Known Act",
  entity_id: "4E4F544F-0000-4000-8000-000000000001",
  types: ["urn:entity:artist"],
  properties: {
    akas: [],
    duration: {},
    external: { lastfm: { id: "Known Act", listeners: 10, scrobbles: 20 }, musicbrainz: { id: mbid(1) }, spotify: { id: "x" } },
    image: { url: "https://images.example/known.jpg" },
    short_description: "A band.",
  },
  popularity: 0.5,
  disambiguation: "AU",
  tags: [{ name: "Folk", tag_id: "urn:tag:genre:folk", type: "urn:tag:genre", value: "urn:tag:genre:folk" }],
};

const routes: [string, (u: URL) => Response][] = [
  ["hackathon.api.qloo.com/search", () => json(404, { message: "No results" })],
  [`musicbrainz.org/ws/2/artist/${NEW}`, () => json(200, { id: NEW, name: "Newact", country: "US", aliases: [{ name: "New Act" }] })],
  ["musicbrainz.org/ws/2/artist", () => json(200, { artists: [{ id: NEW, name: "Newact", score: 100, country: "US" }] })],
  [
    "query.wikidata.org",
    () =>
      json(200, {
        results: {
          bindings: [
            {
              item: { value: "http://www.wikidata.org/entity/Q1" },
              spotify: { value: "sp1" },
              instagram: { value: "newact" },
              image: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/New.jpg" },
              genres: { value: "indie pop|bedroom pop" },
            },
          ],
        },
      }),
  ],
  ["method=artist.search", () => json(200, { results: { artistmatches: { artist: [] } } })],
  ["method=artist.getinfo", () => json(200, { artist: { name: "Newact", url: "https://www.last.fm/music/Newact", stats: { listeners: "1000", playcount: "5000" } } })],
  ["method=artist.getsimilar", () => json(200, { similarartists: { artist: [] } })],
  ["api.deezer.com/search/artist", () => json(200, { data: [{ id: 9, name: "Newact", nb_fan: 12, link: "https://www.deezer.com/artist/9" }] })],
  ["api.deezer.com/artist/9/related", () => json(200, { data: [] })],
  ["api.deezer.com/artist/9", () => json(200, { id: 9, name: "Newact", nb_fan: 12, link: "https://www.deezer.com/artist/9" })],
];

describe("Qloo shape, 1:1", () => {
  it("the reference schema accepts a Qloo-shaped artist", () => {
    expect(QlooArtist.safeParse(qlooLike).success).toBe(true);
    expect(QlooArtist.safeParse(qlooArtist(1, "x")).success).toBe(false); // fixture lacks akas/tags: proves the schema is strict
  });

  it("a NotOnQ fallback entity fits Qloo's shape, with everything of ours prefixed notonq:", async () => {
    const { fetch } = fakeFetch(routes);
    const out = await resolveArtist("Newact", { qloo: qlooClient({ apiKey: "s1", fetch }), lastfmKey: "lf", fetch });
    if (out.servedBy !== "fallback" || !out.entity) throw new Error("expected a fill");
    const parsed = QlooArtist.safeParse(out.entity);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(foreignKeys(out.entity)).toEqual([]);
    expect(out.entity.entity_id.startsWith("notonq:")).toBe(true);
    expect(out.entity.tags.every((t) => t.tag_id.startsWith("notonq:urn:tag:genre:") && t.value === t.tag_id && t.type === "urn:tag:genre")).toBe(true);
    expect(out.entity.properties.external).toMatchObject({
      lastfm: { id: "Newact", listeners: 1000, scrobbles: 5000 },
      instagram: { id: "newact" },
      "notonq:deezer": { id: 9, fans: 12 },
    });
  });

  it("mints genre tag IDs under our prefix", () => {
    expect(genreTag("Bedroom Pop")).toEqual({
      name: "Bedroom Pop",
      tag_id: "notonq:urn:tag:genre:bedroom_pop",
      type: "urn:tag:genre",
      value: "notonq:urn:tag:genre:bedroom_pop",
    });
  });
});
