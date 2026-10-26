import { beforeEach, describe, expect, it } from "vitest";
import { handleRest } from "@/server/rest";
import { memoryDb, type Sql } from "@/server/store/db";
import { importQueue } from "@/server/store/repo";
import { fakeFetch, json, mbid, qid, qlooArtist } from "./fixtures";

const NEW = mbid(99);
const NOT_IN_GRAPH = { errors: [{ message: "All of the provided signal.interests.entities were invalid.", path: "signal.interests.entities" }] };

const openData: [string, (u: URL) => Response][] = [
  [`musicbrainz.org/ws/2/artist/${NEW}`, () => json(200, { id: NEW, name: "Newact", country: "US" })],
  ["musicbrainz.org/ws/2/artist", () => json(200, { artists: [{ id: NEW, name: "Newact", score: 100, country: "US" }] })],
  ["query.wikidata.org", () => json(200, { results: { bindings: [] } })],
  ["method=artist.getinfo", () => json(200, { artist: { stats: { listeners: "1000" } } })],
  [
    "method=artist.getsimilar",
    () => json(200, { similarartists: { artist: [1, 2].map((n) => ({ name: `Similar ${n}`, mbid: mbid(n), match: "0.9" })) } }),
  ],
];

const qlooRoutes = (counter: { search: number; insights: string[] }): [string, (u: URL) => Response][] => [
  [
    "/search",
    () => {
      counter.search++;
      return json(404, { message: "No results" });
    },
  ],
  [
    "/entities",
    (u) =>
      u.searchParams.get("entity_ids") === qid(50)
        ? json(200, { results: [qlooArtist(50, "Newact")] })
        : json(200, { results: [qlooArtist(1, "Similar 1", { mb: 1 }), qlooArtist(2, "Similar 2", { mb: 2 })] }),
  ],
  [
    "/v2/insights",
    (u) => {
      const sig = u.searchParams.get("signal.interests.entities") ?? "";
      counter.insights.push(sig);
      return sig.includes(qid(50)) ? json(400, NOT_IN_GRAPH) : json(200, { success: true, results: { entities: [qlooArtist(70, "Rec")] } });
    },
  ],
];

let sql: Sql;
beforeEach(async () => {
  sql = await memoryDb();
});

const deps = (fetch: typeof globalThis.fetch) => ({ sql, baseUrl: "https://hackathon.api.qloo.com", salt: "t", fetch });

describe("handleRest", () => {
  it("needs the caller's own key", async () => {
    const { fetch } = fakeFetch([]);
    expect((await handleRest({ path: "search", params: {} }, deps(fetch))).status).toBe(401);
  });

  it("fills a Qloo 404 search with a sourced entity, then serves it from cache and counts demand", async () => {
    const counter = { search: 0, insights: [] as string[] };
    const { fetch, calls } = fakeFetch([...qlooRoutes(counter), ...openData]);
    const req = { path: "search", params: { query: "Newact", types: "urn:entity:artist" }, apiKey: "team-a", lastfmKey: "lf", appLabel: "app-a" };

    const first = await handleRest(req, deps(fetch));
    expect(first.status).toBe(200);
    const body = first.body as { results: { entity_id: string }[]; notonq: { served_by: string; cache: { hit: boolean }; proxy: { stand_ins: unknown[] } } };
    expect(body.results[0].entity_id).toBe(NEW);
    expect(body.notonq).toMatchObject({ served_by: "fallback", cache: { hit: false } });
    expect(body.notonq.proxy.stand_ins).toHaveLength(2);

    const mbCalls = calls.filter((c) => c.includes("musicbrainz")).length;
    const second = await handleRest({ ...req, apiKey: "team-b", appLabel: "app-b" }, deps(fetch));
    expect((second.body as { notonq: { cache: { hit: boolean }; demand: { callers: number } } }).notonq).toMatchObject({ cache: { hit: true }, demand: { callers: 2 } });
    expect(calls.filter((c) => c.includes("musicbrainz")).length).toBe(mbCalls); // no open-data refetch

    const [row] = await importQueue(sql);
    expect(row).toMatchObject({ name: "Newact", requests: 2, callers: 2, apps: 2 });
  });

  it("rebuilds a fill made before v0.4.0 (no home, no note) once, on its next use", async () => {
    const counter = { search: 0, insights: [] as string[] };
    const { fetch, calls } = fakeFetch([...qlooRoutes(counter), ...openData]);
    const req = { path: "search", params: { query: "Newact", types: "urn:entity:artist" }, apiKey: "k", lastfmKey: "lf" };
    await handleRest(req, deps(fetch));
    // Make the stored fill look like one from v0.3.0: no home on the entity and nothing about it in unavailable.
    await sql(`UPDATE fallback_entities SET entity = entity #- '{properties,notonq:home}', unavailable = '[]'::jsonb`);
    const before = calls.filter((c) => c.includes("musicbrainz")).length;
    const again = await handleRest(req, deps(fetch));
    expect(calls.filter((c) => c.includes("musicbrainz")).length).toBeGreaterThan(before);
    expect((again.body as { results: { properties: { "notonq:home"?: unknown } }[] }).results[0].properties["notonq:home"]).toMatchObject({ source: "musicbrainz" });
  });

  it("swaps a notonq: ID for its stand-ins on insights and labels the answer", async () => {
    const counter = { search: 0, insights: [] as string[] };
    const { fetch } = fakeFetch([...qlooRoutes(counter), ...openData]);
    await handleRest({ path: "search", params: { query: "Newact", types: "urn:entity:artist" }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    const out = await handleRest(
      { path: "v2/insights", params: { "filter.type": "urn:entity:place", "signal.interests.entities": NEW }, apiKey: "k" },
      deps(fetch),
    );
    expect(out.servedBy).toBe("mixed");
    expect(counter.insights.at(-1)).toBe(`${qid(1)},${qid(2)}`);
    expect((out.body as { notonq: { proxy: { replaced: string[] } } }).notonq.proxy.replaced).toEqual([NEW]);
  });

  it("compares audiences through the stand-ins of a NotOnQ artist in either group", async () => {
    const counter = { search: 0, insights: [] as string[] };
    const seen: string[] = [];
    const { fetch } = fakeFetch([
      ["/v2/analysis/compare", (u) => (seen.push(u.searchParams.get("a.signal.interests.entities") ?? ""), json(200, { results: { a: [], b: [], tags: [] } }))],
      ...qlooRoutes(counter),
      ...openData,
    ]);
    await handleRest({ path: "search", params: { query: "Newact", types: "urn:entity:artist" }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    const out = await handleRest({ path: "v2/analysis/compare", params: { "a.signal.interests.entities": NEW, "b.signal.interests.entities": qid(9) }, apiKey: "k" }, deps(fetch));
    expect(out.servedBy).toBe("mixed");
    expect(seen.at(-1)).toBe(`${qid(1)},${qid(2)}`);
  });

  it("answers empty, without asking Qloo, when a NotOnQ artist has no stand-ins", async () => {
    const counter = { search: 0, insights: [] as string[] };
    const { fetch } = fakeFetch([...qlooRoutes(counter), ...openData.filter(([k]) => k !== "method=artist.getsimilar"), ["method=artist.getsimilar", () => json(200, { similarartists: { artist: [] } })]]);
    await handleRest({ path: "search", params: { query: "Newact", types: "urn:entity:artist" }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    const before = counter.insights.length;
    const out = await handleRest({ path: "v2/insights", params: { "filter.type": "urn:heatmap", "signal.interests.entities": NEW }, apiKey: "k" }, deps(fetch));
    expect(out).toMatchObject({ status: 200, servedBy: "fallback", body: { success: true, results: {} } });
    expect(counter.insights.length).toBe(before);
  });

  it("still fills the artist when Last.fm fails (rate limit, outage or bad key)", async () => {
    const counter = { search: 0, insights: [] as string[] };
    const lastfmDown: [string, (u: URL) => Response][] = [["ws.audioscrobbler.com", () => json(200, { error: 29, message: "Rate limit exceeded" })]];
    const { fetch } = fakeFetch([...qlooRoutes(counter), ...lastfmDown, ...openData]);
    const out = await handleRest({ path: "search", params: { query: "Newact", types: "urn:entity:artist" }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    expect(out.status).toBe(200);
    expect((out.body as { results: { entity_id: string }[] }).results.map((r) => r.entity_id)).toContain(NEW);
  });

  it("recovers a G2 Qloo ID by building its fallback and retrying with stand-ins", async () => {
    const counter = { search: 0, insights: [] as string[] };
    const { fetch } = fakeFetch([
      ["/search", () => json(200, { results: [qlooArtist(50, "Newact")] })],
      ...qlooRoutes(counter).slice(1),
      ...openData,
    ]);
    const out = await handleRest(
      { path: "v2/insights", params: { "filter.type": "urn:entity:artist", "signal.interests.entities": qid(50) }, apiKey: "k", lastfmKey: "lf" },
      deps(fetch),
    );
    expect(out.status).toBe(200);
    expect(out.servedBy).toBe("mixed");
    expect(counter.insights.at(-1)).toBe(`${qid(1)},${qid(2)}`);
  });

  it("swaps notonq: IDs in a POST /v2/insights body, keeping weighted objects weighted", async () => {
    const counter = { search: 0, insights: [] as string[] };
    const { fetch, bodies } = fakeFetch([...qlooRoutes(counter), ...openData]);
    await handleRest({ path: "search", params: { query: "Newact", types: "urn:entity:artist" }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    const out = await handleRest(
      {
        path: "v2/insights",
        params: {},
        apiKey: "k",
        body: { "filter.type": "urn:entity:place", "signal.interests.entities": [{ id: NEW, weight: 0.5 }, { id: qid(9), weight: 1 }] },
      },
      deps(fetch),
    );
    expect(out.servedBy).toBe("mixed");
    expect(bodies.at(-1)).toEqual({
      "filter.type": "urn:entity:place",
      "signal.interests.entities": [
        { id: qid(1), weight: 0.45 },
        { id: qid(2), weight: 0.45 },
        { id: qid(9), weight: 1 },
      ],
    });
  });

  it("passes anything else straight through", async () => {
    const { fetch } = fakeFetch([["/v2/tags", () => json(200, { results: { tags: [] } })]]);
    const out = await handleRest({ path: "v2/tags", params: { "filter.query": "folk" }, apiKey: "k" }, deps(fetch));
    expect(out).toEqual({ status: 200, body: { results: { tags: [] } }, servedBy: "qloo" });
  });

  // N6 (v0.4.0): every request shape the apps key on an artist works for a NotOnQ artist, through its stand-ins, and
  // NotOnQ's ID never reaches Qloo.
  describe.each(["urn:demographics", "urn:heatmap", "urn:audience", "urn:tag", "urn:entity:place", "urn:entity:artist", "urn:entity:movie"])("signal on %s", (type) => {
    it("asks Qloo for the stand-ins and labels the answer", async () => {
      const counter = { search: 0, insights: [] as string[] };
      const { fetch, calls } = fakeFetch([...qlooRoutes(counter), ...openData]);
      await handleRest({ path: "search", params: { query: "Newact", types: "urn:entity:artist" }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
      const from = calls.length; // the fill itself may look its MusicBrainz ID up on Qloo; the request below must not send it
      const extra: Record<string, string> = type === "urn:heatmap" ? { "filter.location": "POLYGON((-179 -60,179 -60,179 80,-179 80,-179 -60))" } : type === "urn:tag" ? { "filter.tag.types": "urn:tag:genre:music" } : {};
      const out = await handleRest({ path: "v2/insights", params: { "filter.type": type, "signal.interests.entities": NEW, ...extra }, apiKey: "k", appLabel: "app" }, deps(fetch));
      expect(out.servedBy).toBe("mixed");
      expect(counter.insights.at(-1)).toBe(`${qid(1)},${qid(2)}`);
      expect(calls.slice(from).filter((c) => c.includes("hackathon.api.qloo.com")).some((c) => c.includes(NEW))).toBe(false);
      expect((out.body as { notonq: { proxy: { replaced: string[] } } }).notonq.proxy.replaced).toEqual([NEW]);
    });
  });

  it("ranks a list with a NotOnQ artist in it: Qloo ranks the ones it knows, NotOnQ's follows, unranked", async () => {
    const counter = { search: 0, insights: [] as string[] };
    const sent: string[] = [];
    const { fetch } = fakeFetch([
      ["/v2/insights?filter.results", (u) => (sent.push(u.searchParams.get("filter.results.entities") ?? ""), json(200, { success: true, results: { entities: [qlooArtist(8, "B"), qlooArtist(7, "A")] } }))],
      ...qlooRoutes(counter),
      ...openData,
    ]);
    await handleRest({ path: "search", params: { query: "Newact", types: "urn:entity:artist" }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    const out = await handleRest(
      { path: "v2/insights", params: { "filter.results.entities": `${qid(7)},${NEW},${qid(8)}`, "filter.type": "urn:entity:artist", "signal.location": "POINT(144.96 -37.81)" }, apiKey: "k" },
      deps(fetch),
    );
    expect(sent.at(-1)).toBe(`${qid(7)},${qid(8)}`);
    const body = out.body as { results: { entities: { name: string }[] }; notonq: { unranked: string[] } };
    expect(body.results.entities.map((e) => e.name)).toEqual(["B", "A", "Newact"]);
    expect(body.notonq.unranked).toEqual([NEW]);
    expect(out.servedBy).toBe("mixed");
  });

  it("ranks a list of only NotOnQ artists without asking Qloo", async () => {
    const counter = { search: 0, insights: [] as string[] };
    const { fetch } = fakeFetch([...qlooRoutes(counter), ...openData]);
    await handleRest({ path: "search", params: { query: "Newact", types: "urn:entity:artist" }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    const before = counter.insights.length;
    const out = await handleRest({ path: "v2/insights", params: { "filter.results.entities": NEW, "filter.type": "urn:entity:artist" }, apiKey: "k" }, deps(fetch));
    expect(counter.insights.length).toBe(before);
    expect(out).toMatchObject({ status: 200, servedBy: "fallback" });
    expect((out.body as { results: { entities: { name: string }[] } }).results.entities.map((e) => e.name)).toEqual(["Newact"]);
  });

  // N3 (v0.4.0): /entities by Spotify ID for artists Qloo has no record of.
  describe("entities by Spotify ID", () => {
    const SP = "1234567890abcdefghijkl";
    const mbUrl = (artist: { id: string; name: string } | null): [string, (u: URL) => Response] => ["musicbrainz.org/ws/2/url", () => json(200, { relations: artist ? [{ artist }] : [] })];
    const noSpotifyInQloo: [string, (u: URL) => Response] = ["/entities?external.spotify.ids", () => json(200, { results: [] })];

    it("fills the artist MusicBrainz links to the Spotify page, then serves it from the link", async () => {
      const counter = { search: 0, insights: [] as string[] };
      const { fetch, calls } = fakeFetch([noSpotifyInQloo, mbUrl({ id: NEW, name: "Newact" }), ...qlooRoutes(counter), ...openData]);
      const req = { path: "entities", params: { "external.spotify.ids": SP }, apiKey: "k", lastfmKey: "lf", appLabel: "busk-map" };
      const first = await handleRest(req, deps(fetch));
      expect(first).toMatchObject({ status: 200, servedBy: "fallback" });
      const body = first.body as { results: { entity_id: string; properties: { external: { spotify?: { id: string } } } }[]; notonq: { spotify: { via: string }[] } };
      expect(body.results[0].entity_id).toBe(NEW);
      expect(body.results[0].properties.external.spotify).toEqual({ id: SP });
      expect(body.notonq.spotify[0]).toMatchObject({ via: "musicbrainz", entity_id: NEW });

      const urlCalls = calls.filter((c) => c.includes("ws/2/url")).length;
      const second = await handleRest(req, deps(fetch));
      expect((second.body as { notonq: { spotify: { via: string }[] } }).notonq.spotify[0].via).toBe("notonq");
      expect(calls.filter((c) => c.includes("ws/2/url")).length).toBe(urlCalls);
    });

    it("returns Qloo's own record, labelled, when Qloo has the MusicBrainz ID but not the Spotify ID", async () => {
      const counter = { search: 0, insights: [] as string[] };
      const { fetch } = fakeFetch([noSpotifyInQloo, mbUrl({ id: mbid(1), name: "Similar 1" }), ...qlooRoutes(counter), ...openData]);
      const out = await handleRest({ path: "entities", params: { "external.spotify.ids": SP }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
      const body = out.body as { results: { entity_id: string; properties: { short_description: string } }[]; notonq: { spotify: { via: string }[] } };
      expect(body.results[0].entity_id).toBe(qid(1));
      expect(body.results[0].properties.short_description).toMatch(/^Matched by NotOnQ: Qloo has this artist but not under this Spotify ID/);
      expect(body.notonq.spotify[0].via).toBe("musicbrainz_in_qloo");
    });

    it("leaves Qloo's answer alone when Qloo has every Spotify ID", async () => {
      const qlooHas = { results: [{ ...qlooArtist(3, "Known"), properties: { external: { spotify: { id: SP } } } }] };
      const { fetch, calls } = fakeFetch([["/entities?external.spotify.ids", () => json(200, qlooHas)]]);
      const out = await handleRest({ path: "entities", params: { "external.spotify.ids": SP }, apiKey: "k" }, deps(fetch));
      expect(out).toMatchObject({ servedBy: "qloo", body: JSON.parse(JSON.stringify(qlooHas)) });
      expect(calls.some((c) => c.includes("musicbrainz") || c.includes("spotify.com"))).toBe(false);
    });

    it("says so when no source names the artist", async () => {
      const { fetch } = fakeFetch([noSpotifyInQloo, mbUrl(null), ["open.spotify.com/oembed", () => json(404, {})]]);
      const out = await handleRest({ path: "entities", params: { "external.spotify.ids": SP }, apiKey: "k" }, deps(fetch));
      expect((out.body as { notonq: { spotify: { via: string }[] } }).notonq.spotify[0].via).toBe("none");
      expect(out.servedBy).toBe("qloo");
    });
  });
});

