import { beforeEach, describe, expect, it } from "vitest";
import { eraQuery, parseMusicTag } from "@/server/engine/era";
import { wktSpaces } from "@/server/engine/geo";
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
    expect(parseMusicTag("urn:tag:genre:qloo:60s")).toEqual({ decade: 1960, genre: undefined });
    expect(parseMusicTag("urn:tag:subgenre:qloo:bolero")).toEqual({ decade: undefined, genre: "bolero" });
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
    // Qloo has nothing for the tag as a filter, but two artists for it as a taste signal.
    const { fetch, calls } = fakeFetch(
      openData((u) => json(200, { success: true, results: { entities: u.searchParams.get("signal.interests.tags") ? [qlooArtist(7, "Signal A"), qlooArtist(8, "Signal B")] : [] } })),
    );
    const out = await handleRest(
      { path: "v2/insights", params: { "filter.type": "urn:entity:artist", "filter.tags": "urn:tag:genre:music:60s", "signal.location.query": "Lagos", take: "10" }, apiKey: "k", lastfmKey: "lf" },
      deps(fetch),
    );
    expect(out.servedBy).toBe("fallback");
    const body = out.body as { results: { entities: { entity_id: string; name: string; properties?: { short_description?: string } }[] }; notonq: { request: { country: { code: string } } } };
    // Ranked by Last.fm listeners: the known act first, as Qloo's own entity.
    expect(body.results.entities.map((e) => e.name)).toEqual(["Known Act", "Old Band"]);
    expect(body.results.entities[0].entity_id).toBe(qid(5));
    // Qloo's own record, but picked by NotOnQ: labelled, so it can't pass for Qloo's answer to this request.
    expect(body.results.entities[0].properties?.short_description).toMatch(/^Picked by NotOnQ: Qloo returned 0 artists for this request; this is Qloo's own record \(MusicBrainz: Nigeria; active from 1938\)/);
    expect(body.results.entities[0].properties?.short_description).toContain("Qloo has 2 artists for this tag as a taste signal");
    expect(body.results.entities[1].entity_id).toBe(mbid(1));
    expect(body.results.entities[1].properties?.short_description).toMatch(/^Not in Qloo: found by NotOnQ for 1960s music from Nigeria/);
    expect(body.notonq.request.country.code).toBe("NG");
    // Honest about what Qloo has: the same tag as a signal, reported, never hidden.
    expect((out.body as { notonq: { gap: { qloo_as_signal: number }; note: string } }).notonq.gap.qloo_as_signal).toBe(2);
    expect((out.body as { notonq: { note: string } }).notonq.note).toContain("signal.interests.tags");
    expect(decodeURIComponent(calls.find((c) => c.includes("ws/2/artist?"))!)).toContain("country:NG");
  });

  it("adds nothing when the place can't be placed in a country, rather than artists from anywhere", async () => {
    const routes = openData(() => json(200, { success: true, results: { entities: [] } })).map(([m, r]): [string, (u: URL) => Response] =>
      m === "musicbrainz.org/ws/2/area?" ? [m, () => json(503, {})] : [m, r],
    );
    const { fetch, calls } = fakeFetch(routes);
    const out = await handleRest({ path: "v2/insights", params: { "filter.type": "urn:entity:artist", "filter.tags": "urn:tag:genre:music:60s", "signal.location.query": "Nowhereville" }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    const body = out.body as { results: { entities: unknown[] }; notonq: { note: string } };
    expect(body.results.entities).toEqual([]);
    expect(body.notonq.note).toContain('could not place "Nowhereville"');
    expect(calls.some((c) => c.includes("ws/2/artist?"))).toBe(false);
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

  it("fills a signalled era request too, and lets Qloo rank its own artists in the fill for that signal (v0.4.0)", async () => {
    const SEED = qid(40);
    const { fetch, calls } = fakeFetch(
      openData((u) => {
        // Qloo ranks the fill's Qloo artists for the signal when asked with filter.results.entities.
        if (u.searchParams.get("filter.results.entities")) return json(200, { success: true, results: { entities: [qlooArtist(5, "Known Act")] } });
        return json(200, { success: true, results: { entities: u.searchParams.get("filter.tags") ? [qlooArtist(9, "Qloo Pick")] : [] } });
      }),
    );
    const out = await handleRest(
      {
        path: "v2/insights",
        params: { "filter.type": "urn:entity:artist", "filter.tags": "urn:tag:genre:music:60s", "signal.interests.entities": SEED, "signal.location.query": "Lagos", take: "10" },
        apiKey: "k",
        lastfmKey: "lf",
      },
      deps(fetch),
    );
    expect(out.servedBy).toBe("mixed");
    const body = out.body as { results: { entities: { name: string; properties?: { short_description?: string } }[] }; notonq: { request: { taste_signal: boolean }; ranking: { by: string; ranked: number } } };
    expect(body.results.entities.map((e) => e.name)).toEqual(["Qloo Pick", "Known Act", "Old Band"]);
    expect(body.results.entities[1].properties?.short_description).toContain("Ranked by Qloo for this request's taste signal.");
    expect(body.notonq.request.taste_signal).toBe(true);
    expect(body.notonq.ranking).toMatchObject({ by: "qloo", ranked: 1 });
    // The ranking call keeps the signal and drops the era filter (the fill already applied it).
    const rank = new URL(calls.find((c) => c.includes("filter.results.entities"))!);
    expect(rank.searchParams.get("signal.interests.entities")).toBe(SEED);
    expect(rank.searchParams.get("filter.tags")).toBeNull();
    expect(rank.searchParams.get("signal.location.query")).toBeNull();
    // Only what Qloo ranked says so.
    expect(body.results.entities[2].properties?.short_description ?? "").not.toContain("Ranked by Qloo");
  });

  it("never returns the signal's own artist as one of the artists like it", async () => {
    const { fetch } = fakeFetch(openData(() => json(200, { success: true, results: { entities: [] } })));
    const out = await handleRest(
      { path: "v2/insights", params: { "filter.type": "urn:entity:artist", "filter.tags": "urn:tag:genre:music:60s", "signal.interests.entities": qid(5), "signal.location.query": "Lagos" }, apiKey: "k", lastfmKey: "lf" },
      deps(fetch),
    );
    expect((out.body as { results: { entities: { name: string }[] } }).results.entities.map((e) => e.name)).toEqual(["Old Band"]);
  });

  it("adds the era tag to a tag signal for the honesty check, keeping the caller's tags", async () => {
    const { fetch, calls } = fakeFetch(openData(() => json(200, { success: true, results: { entities: [] } })));
    await handleRest(
      { path: "v2/insights", params: { "filter.type": "urn:entity:artist", "filter.tags": "urn:tag:genre:music:60s", "signal.interests.tags": "urn:tag:genre:music:highlife", "signal.location.query": "Lagos" }, apiKey: "k", lastfmKey: "lf" },
      deps(fetch),
    );
    const check = calls.map((c) => new URL(c)).find((u) => u.pathname === "/v2/insights" && !u.searchParams.get("filter.tags") && !u.searchParams.get("filter.results.entities"));
    expect(check?.searchParams.get("signal.interests.tags")).toBe("urn:tag:genre:music:highlife,urn:tag:genre:music:60s");
  });

  it("places a request given as coordinates (POINT and a radius, as GhostQ sends) and fills for that country (v0.4.0)", async () => {
    const { fetch, calls } = fakeFetch([
      ["nominatim.openstreetmap.org/reverse", () => json(200, { osm_type: "relation", osm_id: 1, address: { city: "Lagos", country: "Nigeria", country_code: "ng" } })],
      ...openData(() => json(200, { success: true, results: { entities: [] } })),
    ]);
    const params = { "filter.type": "urn:entity:artist", "filter.tags": "urn:tag:genre:music:60s", "signal.location": "POINT(3.3792 6.5244)", "signal.location.radius": "15000", take: "10" };
    const out = await handleRest({ path: "v2/insights", params, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    const body = out.body as { results: { entities: { name: string }[] }; notonq: { request: { place: string; country: { code: string }; point: { lat: number } } } };
    expect(body.results.entities.map((e) => e.name)).toEqual(["Known Act", "Old Band"]);
    expect(body.notonq.request).toMatchObject({ place: "Lagos, Nigeria", country: { code: "NG" }, point: { lat: 6.52 } });
    expect(decodeURIComponent(calls.find((c) => c.includes("ws/2/artist?"))!)).toContain("country:NG");
    // The place at a point is looked up once.
    await handleRest({ path: "v2/insights", params, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    expect(calls.filter((c) => c.includes("nominatim")).length).toBe(1);
  });

  it("adds nothing for coordinates no one can name, and ignores areas too wide to be one place", async () => {
    const { fetch, calls } = fakeFetch([["nominatim.openstreetmap.org/reverse", () => json(200, { error: "Unable to geocode" })], ...openData(() => json(200, { success: true, results: { entities: [] } }))]);
    const sea = await handleRest({ path: "v2/insights", params: { "filter.type": "urn:entity:artist", "filter.tags": "urn:tag:genre:music:60s", "signal.location": "POINT(-30 0)" }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    expect((sea.body as { results: { entities: unknown[] } }).results.entities).toEqual([]);
    expect(calls.some((c) => c.includes("ws/2/area") || c.includes("ws/2/artist?"))).toBe(false);
    const world = await handleRest(
      { path: "v2/insights", params: { "filter.type": "urn:entity:artist", "filter.tags": "urn:tag:genre:music:60s", "filter.location": "POLYGON((-179 -60,179 -60,179 80,-179 80,-179 -60))" }, apiKey: "k", lastfmKey: "lf" },
      deps(fetch),
    );
    expect((world.body as { notonq: { request: { place?: string } } }).notonq.request.place).toBeUndefined();
  });
});

describe("map shapes", () => {
  it("turns literal plus signs inside a POINT or POLYGON back into spaces, and leaves other values alone", () => {
    expect(wktSpaces({ "filter.location": "POLYGON((-179+-60,+179+-60))", "signal.location": "POINT(144.96+-37.81)", query: "Taylor+Swift" })).toEqual({
      "filter.location": "POLYGON((-179 -60, 179 -60))",
      "signal.location": "POINT(144.96 -37.81)",
      query: "Taylor+Swift",
    });
  });
});

