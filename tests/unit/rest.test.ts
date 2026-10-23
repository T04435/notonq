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
});
