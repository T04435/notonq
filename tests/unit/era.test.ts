import { beforeEach, describe, expect, it } from "vitest";
import { eraQuery, parseMusicTag } from "@/server/engine/era";
import { handleRest } from "@/server/rest";
import { memoryDb, type Sql } from "@/server/store/db";
import { fakeFetch, json, mbid, qid, qlooArtist } from "./fixtures";

describe("parseMusicTag", () => {
  it("reads decades and genres from Qloo's music genre tags", () => {
    expect(parseMusicTag("urn:tag:genre:music:60s")).toEqual({ decade: 1960, genre: undefined });
    expect(parseMusicTag("urn:tag:genre:music:1950s")).toEqual({ decade: 1950, genre: undefined });
    expect(parseMusicTag("urn:tag:genre:music:rock_70s")).toEqual({ decade: 1970, genre: "rock" });
    expect(parseMusicTag("urn:tag:genre:music:rock_of_70s")).toEqual({ decade: 1970, genre: "rock" });
    expect(parseMusicTag("urn:tag:genre:music:bolero")).toEqual({ decade: undefined, genre: "bolero" });
    expect(parseMusicTag("urn:tag:genre:music:00s")).toEqual({ decade: 2000, genre: undefined });
    expect(parseMusicTag("urn:tag:keyword:qloo:1960s")).toBeNull();
  });

  it("asks MusicBrainz for groups active in the decade and people old enough to perform in it", () => {
    expect(eraQuery({ decade: 1960, genre: "soul" }, "NG")).toBe(
      'tag:"soul" AND country:NG AND ((type:group AND begin:[* TO 1969] AND (end:[1960 TO *] OR ended:false)) OR (type:person AND begin:[* TO 1951] AND (end:[1960 TO *] OR ended:false)))',
    );
    expect(eraQuery({ genre: "bolero" })).toBe('tag:"bolero" AND (type:group OR type:person)');
  });
});

describe("era, genre and place insights", () => {
  let sql: Sql;
  beforeEach(async () => {
    sql = await memoryDb();
  });
  const deps = (fetch: typeof globalThis.fetch) => ({ sql, baseUrl: "https://hackathon.api.qloo.com", salt: "t", fetch });
  const AREA = "11111111-0000-4000-a000-000000000001";
  const COUNTRY = "11111111-0000-4000-a000-000000000002";

  const openData = (qlooInsights: (u: URL) => Response): [string, (u: URL) => Response][] => [
    ["hackathon.api.qloo.com/v2/insights", qlooInsights],
    ["hackathon.api.qloo.com/entities", () => json(200, { results: [qlooArtist(5, "Known Act", { mb: 2 })] })],
    [`musicbrainz.org/ws/2/area/${AREA}`, () => json(200, { id: AREA, name: "Lagos", type: "City", relations: [{ type: "part of", direction: "backward", area: { id: COUNTRY, name: "Nigeria" } }] })],
    [`musicbrainz.org/ws/2/area/${COUNTRY}`, () => json(200, { id: COUNTRY, name: "Nigeria", type: "Country", "iso-3166-1-codes": ["NG"] })],
    ["musicbrainz.org/ws/2/area?", () => json(200, { areas: [{ id: AREA, name: "Lagos", type: "City" }] })],
    [
      "musicbrainz.org/ws/2/artist?",
      () =>
        json(200, {
          artists: [
            { id: mbid(1), name: "Old Band", type: "Group", area: { name: "Nigeria" }, "life-span": { begin: "1958", end: "1975" } },
            { id: mbid(2), name: "Known Act", type: "Person", area: { name: "Nigeria" }, "life-span": { begin: "1938" } },
          ],
        }),
    ],
    ["method=artist.getinfo", (u) => json(200, { artist: { stats: { listeners: u.searchParams.get("mbid") === mbid(2) ? "900" : "40" } } })],
  ];

  it("fills an empty Qloo answer with artists from that era and country, Qloo's known ones as Qloo entities", async () => {
    const { fetch, calls } = fakeFetch(openData(() => json(200, { success: true, results: { entities: [] } })));
    const out = await handleRest(
      { path: "v2/insights", params: { "filter.type": "urn:entity:artist", "filter.tags": "urn:tag:genre:music:60s", "signal.location.query": "Lagos", take: "10" }, apiKey: "k", lastfmKey: "lf" },
      deps(fetch),
    );
    expect(out.servedBy).toBe("fallback");
    const body = out.body as { results: { entities: { entity_id: string; name: string; properties?: { short_description?: string } }[] }; notonq: { request: { country: { code: string } } } };
    // Ranked by Last.fm listeners: the known act first, as Qloo's own entity.
    expect(body.results.entities.map((e) => e.name)).toEqual(["Known Act", "Old Band"]);
    expect(body.results.entities[0].entity_id).toBe(qid(5));
    expect(body.results.entities[1].entity_id).toBe(mbid(1));
    expect(body.results.entities[1].properties?.short_description).toMatch(/^Not in Qloo: found by NotOnQ for 1960s music from Nigeria/);
    expect(body.notonq.request.country.code).toBe("NG");
    expect(decodeURIComponent(calls.find((c) => c.includes("ws/2/artist?"))!)).toContain("country:NG");
  });

  it("leaves a full Qloo answer alone", async () => {
    const full = { success: true, results: { entities: [1, 2, 3, 4, 5, 6].map((n) => qlooArtist(n, `Act ${n}`)) } };
    const { fetch, calls } = fakeFetch(openData(() => json(200, full)));
    const out = await handleRest({ path: "v2/insights", params: { "filter.type": "urn:entity:artist", "filter.tags": "urn:tag:genre:music:80s", "signal.location.query": "Lagos" }, apiKey: "k" }, deps(fetch));
    expect(out).toMatchObject({ servedBy: "qloo", body: JSON.parse(JSON.stringify(full)) });
    expect(calls.some((c) => c.includes("musicbrainz"))).toBe(false);
  });

  it("keeps Qloo's few results first and adds NotOnQ's after", async () => {
    const { fetch } = fakeFetch(openData(() => json(200, { success: true, results: { entities: [qlooArtist(9, "Qloo Pick")] } })));
    const out = await handleRest(
      { path: "v2/insights", params: { "filter.type": "urn:entity:artist", "filter.tags": "urn:tag:genre:music:60s", "signal.location.query": "Lagos" }, apiKey: "k", lastfmKey: "lf" },
      deps(fetch),
    );
    expect(out.servedBy).toBe("mixed");
    expect((out.body as { results: { entities: { name: string }[] } }).results.entities.map((e) => e.name)).toEqual(["Qloo Pick", "Known Act", "Old Band"]);
  });
});
