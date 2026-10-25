import { beforeEach, describe, expect, it } from "vitest";
import { resolveArtist } from "@/server/engine/artist";
import { candidateFromKey, findCandidates, idForKey } from "@/server/engine/candidates";
import { qlooClient } from "@/server/qloo/client";
import { handleRest } from "@/server/rest";
import { memoryDb, type Sql } from "@/server/store/db";
import { importQueue } from "@/server/store/repo";
import { lookupArtist } from "@/server/service";
import { fakeFetch, json, mbid, qid, qlooArtist } from "./fixtures";

// A small artist: no exact MusicBrainz record (only a near miss), an exact Last.fm page and an exact Deezer page.
const smallArtist: [string, (u: URL) => Response][] = [
  ["musicbrainz.org/ws/2/artist", () => json(200, { artists: [{ id: mbid(7), name: "H.M. Tiny Act", score: 88, country: "GB" }] })],
  ["method=artist.search", () => json(200, { results: { artistmatches: { artist: [{ name: "Tiny Act", listeners: "4", mbid: "", url: "https://www.last.fm/music/Tiny+Act" }] } } })],
  ["method=artist.getinfo", () => json(200, { artist: { url: "https://www.last.fm/music/Tiny+Act", stats: { listeners: "4", playcount: "9" } } })],
  ["method=artist.getsimilar", () => json(200, { similarartists: { artist: [] } })],
  ["api.deezer.com/search/artist", () => json(200, { data: [{ id: 555, name: "Tiny Act", nb_fan: 2, picture_medium: "https://img/x.jpg", link: "https://www.deezer.com/artist/555" }] })],
  ["api.deezer.com/artist/555/related", () => json(200, { data: [{ id: 1, name: "Bigger Act" }, { id: 2, name: "Unknown To Qloo" }] })],
  ["api.deezer.com/artist/555", () => json(200, { id: 555, name: "Tiny Act", nb_fan: 2, picture_medium: "https://img/x.jpg", link: "https://www.deezer.com/artist/555" })],
];

const qloo404: [string, (u: URL) => Response][] = [
  [
    "hackathon.api.qloo.com/search",
    (u) => (u.searchParams.get("query") === "Bigger Act" ? json(200, { results: [qlooArtist(31, "Bigger Act", { popularity: 0.4 })] }) : json(404, { message: "No results" })),
  ],
];

describe("findCandidates", () => {
  it("merges the same artist across Last.fm and Deezer and does not auto-pick without a MusicBrainz record", async () => {
    const { fetch } = fakeFetch(smallArtist);
    const set = await findCandidates("tiny act", { lastfmKey: "lf", fetch });
    const exact = set.candidates.filter((c) => c.exact);
    expect(exact).toHaveLength(1);
    expect(exact[0]).toMatchObject({ key: "lf:tiny-act", listeners: 4, deezerId: 555, fans: 2 });
    expect(exact[0].links.map((l) => l.source)).toEqual(["lastfm", "deezer"]);
    expect(set.candidates.some((c) => c.name === "H.M. Tiny Act" && !c.exact)).toBe(true);
    expect(set.auto).toBeUndefined();
  });

  it("maps keys to cache IDs and back", () => {
    expect(idForKey(`mb:${mbid(1)}`)).toBe(mbid(1));
    // Not a MusicBrainz artist: a stable version 5 UUID, which the Qloo harness looks up by /entities like any Qloo ID.
    expect(idForKey("dz:555")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idForKey("dz:555")).toBe(idForKey("dz:555"));
    expect(candidateFromKey("dz:555", "Tiny Act")).toMatchObject({ deezerId: 555 });
    expect(candidateFromKey("mb:not-a-uuid", "x")).toBeNull();
  });
});

describe("small artists", () => {
  let sql: Sql;
  beforeEach(async () => {
    sql = await memoryDb();
  });

  it("asks which artist when no source has one confident match", async () => {
    const { fetch } = fakeFetch([...qloo404, ...smallArtist]);
    const out = await resolveArtist("Tiny Act", { qloo: qlooClient({ apiKey: "c1", fetch }), lastfmKey: "lf", fetch });
    expect(out.servedBy).toBe("needs_choice");
  });

  it("fills from the chosen Last.fm/Deezer candidate with low confidence and Deezer stand-ins", async () => {
    const { fetch } = fakeFetch([...qloo404, ...smallArtist]);
    const ctx = { sql, qloo: qlooClient({ apiKey: "c2", fetch }), lastfmKey: "lf", callerHash: "h", endpoint: "test", fetch };
    const first = await lookupArtist("Tiny Act", ctx);
    expect(first.servedBy).toBe("needs_choice");
    const picked = await lookupArtist("Tiny Act", ctx, { candidateKey: "lf:tiny-act" });
    if (picked.servedBy !== "fallback") throw new Error("expected a fill");
    expect(picked.fallback).toMatchObject({ id: idForKey("lf:tiny-act"), confidence: "low", chosen: true });
    expect(picked.fallback.entity?.properties.external).toMatchObject({ "notonq:deezer": { id: 555, fans: 2 }, lastfm: { listeners: 4 } });
    expect(picked.fallback.entity?.properties.image?.url).toBe("https://img/x.jpg");
    expect(picked.fallback.standIns).toEqual([expect.objectContaining({ entityId: qid(31), source: "deezer" })]);
    expect(picked.fallback.provenance.name[0]).toMatchObject({ source: "deezer", method: "copied" });

    // Choosing again comes from the cache; the name shows in the queue with its demand.
    const again = await lookupArtist("Tiny Act", ctx, { candidateKey: "lf:tiny-act" });
    expect(again.servedBy === "fallback" && again.cacheHit).toBe(true);
    const [row] = await importQueue(sql);
    expect(row).toMatchObject({ query: "Tiny Act", requests: 3, askedToChoose: true, confidence: "low" });
  });

  it("treats a chosen candidate Qloo already knows as a typo: Qloo answers, not NotOnQ", async () => {
    const KNOWN = mbid(42);
    const { fetch } = fakeFetch([
      ["hackathon.api.qloo.com/search", () => json(200, { results: [qlooArtist(40, "Someone Else")] })],
      ["hackathon.api.qloo.com/entities", (u) => (u.searchParams.get("external.musicbrainz.ids")?.includes(KNOWN) ? json(200, { results: [qlooArtist(41, "Famous Act", { mb: 42 })] }) : json(200, { results: [] }))],
      ["hackathon.api.qloo.com/v2/insights", () => json(200, { results: { entities: [] } })],
      ["musicbrainz.org/ws/2/artist", () => json(200, { artists: [{ id: KNOWN, name: "Famous Act", score: 80 }] })],
      ["api.deezer.com/search/artist", () => json(200, { data: [] })],
    ]);
    const deps = { qloo: qlooClient({ apiKey: "c4", fetch }), fetch };
    const asked = await resolveArtist("famus act", deps);
    if (asked.servedBy !== "needs_choice") throw new Error("expected candidates");
    expect(asked.candidates[0]).toMatchObject({ name: "Famous Act", inQloo: { entityId: qid(41), name: "Famous Act" } });
    const picked = await resolveArtist("famus act", deps, { candidateKey: asked.candidates[0].key });
    expect(picked).toEqual({ servedBy: "qloo", entity: expect.objectContaining({ entity_id: qid(41) }) });
  });

  it("keeps a name nobody knows in the queue as demand, without an entity", async () => {
    const { fetch } = fakeFetch([...qloo404]);
    const ctx = { sql, qloo: qlooClient({ apiKey: "c3", fetch }), callerHash: "h", endpoint: "test", fetch };
    const out = await lookupArtist("Nobody At All", ctx);
    expect(out.servedBy === "fallback" && out.fallback.entity).toBeNull();
    const [row] = await importQueue(sql);
    expect(row).toMatchObject({ query: "Nobody At All", requests: 1 });
    expect(row.entityId).toBeUndefined();
  });
});

// What the official Qloo harness sees when only its base URL points at NotOnQ: it reads `results`, picks an exact name,
// asks when several share it, and looks a chosen UUID up by /entities.
describe("search through the Qloo harness", () => {
  let sql: Sql;
  beforeEach(async () => {
    sql = await memoryDb();
  });
  const fuzzy = (u: URL) =>
    u.searchParams.get("query") === "Paris"
      ? json(200, { results: [qlooArtist(60, "Paris")] })
      : u.searchParams.get("query") === "Bigger Act"
        ? json(200, { results: [qlooArtist(31, "Bigger Act", { popularity: 0.4 })] })
        : json(200, { results: [qlooArtist(40, "Tiny Acts Club")] });
  const routes: [string, (u: URL) => Response][] = [["hackathon.api.qloo.com/search", fuzzy], ...smallArtist];
  const deps = (fetch: typeof globalThis.fetch) => ({ sql, baseUrl: "https://hackathon.api.qloo.com", salt: "t", fetch });

  it("keeps Qloo's results first and adds the possible artists after, labelled, under UUIDs that fill when sent back", async () => {
    const { fetch } = fakeFetch(routes);
    const out = await handleRest({ path: "search", params: { query: "Tiny Act", take: "5" }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    const results = (out.body as { results: { entity_id: string; name: string; properties: { short_description?: string } }[] }).results;
    expect(results[0].entity_id).toBe(qid(40));
    const ours = results.find((r) => r.name === "Tiny Act")!;
    expect(ours.entity_id).toBe(idForKey("lf:tiny-act"));
    expect(ours.properties.short_description).toMatch(/^Not in Qloo: a possible match NotOnQ found on lastfm, deezer \(4 Last\.fm listeners, 2 Deezer fans\)/);

    const chosen = await handleRest({ path: "entities", params: { entity_ids: ours.entity_id }, apiKey: "k", lastfmKey: "lf" }, deps(fetch));
    const filled = (chosen.body as { results: { entity_id: string; properties: { short_description: string } }[] }).results;
    expect(filled).toHaveLength(1);
    expect(filled[0].entity_id).toBe(ours.entity_id);
    expect(filled[0].properties.short_description).toMatch(/^Not in Qloo: filled by NotOnQ/);
  });

  it("leaves an untyped search alone when Qloo has something with exactly that name", async () => {
    const { fetch } = fakeFetch(routes);
    const out = await handleRest({ path: "search", params: { query: "Paris" }, apiKey: "k" }, deps(fetch));
    expect(out).toMatchObject({ servedBy: "qloo", body: { results: [{ entity_id: qid(60) }] } });
  });

  it("never serves a fill someone picked as the default answer for the name", async () => {
    const { fetch } = fakeFetch(routes);
    const ctx = { sql, qloo: qlooClient({ apiKey: "c3", fetch }), lastfmKey: "lf", callerHash: "h", endpoint: "test", fetch };
    await lookupArtist("Tiny Act", ctx, { candidateKey: "lf:tiny-act" });
    expect((await lookupArtist("Tiny Act", ctx)).servedBy).toBe("needs_choice");
  });
});
