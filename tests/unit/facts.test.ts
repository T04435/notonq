import { beforeEach, describe, expect, it } from "vitest";
import { withFacts } from "@/server/engine/facts";
import { handleRest } from "@/server/rest";
import { memoryDb, type Sql } from "@/server/store/db";
import { fakeFetch, json, mbid, qid, qlooArtist } from "./fixtures";

type Row = { entity_id: string; properties: Record<string, unknown> & { external: Record<string, unknown> }; tags: { tag_id: string }[] };
type Block = { served_by: string; gap: { kind: string }; facts: Record<string, { provenance: Record<string, unknown> }> };

// Field gaps (G5): an artist Qloo has, whose record lacks where they're from, their language, IDs or genres.
const MB = mbid(40);
const mbArtist = { id: MB, name: "Kitebird", score: 100, country: "JP", "begin-area": { name: "Osaka" } };
const musicbrainz: [string, (u: URL) => Response][] = [
  [`musicbrainz.org/ws/2/artist/${MB}`, () => json(200, { ...mbArtist, genres: [{ name: "emo", count: 3 }, { name: "indie rock", count: 2 }], relations: [{ type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q123" } }] })],
  ["musicbrainz.org/ws/2/release?artist=", () => json(200, { releases: [{ "text-representation": { language: "jpn" } }, { "text-representation": { language: "jpn" } }, { "text-representation": { language: "eng" } }] })],
  ["musicbrainz.org/ws/2/artist?query=", () => json(200, { artists: [mbArtist] })],
];
const qlooHas = (entity: unknown): [string, (u: URL) => Response] => ["hackathon.api.qloo.com/search", () => json(200, { results: [entity] })];

let sql: Sql;
beforeEach(async () => {
  sql = await memoryDb();
});
const deps = (fetch: typeof globalThis.fetch) => ({ sql, baseUrl: "https://hackathon.api.qloo.com", salt: "t", fetch });
const search = (fetch: typeof globalThis.fetch) => handleRest({ path: "search", params: { query: "Kitebird", types: "urn:entity:artist" }, apiKey: "k" }, deps(fetch));

describe("field gaps on an artist Qloo has (G5)", () => {
  it("adds home, languages, MusicBrainz and Wikidata IDs and genres, cited, keeping Qloo's record", async () => {
    const { fetch } = fakeFetch([qlooHas(qlooArtist(5, "Kitebird")), ...musicbrainz]);
    const out = await search(fetch);
    expect(out.servedBy).toBe("mixed");
    const body = out.body as { results: Row[]; notonq: Block };
    const e = body.results[0];
    expect(e.entity_id).toBe(qid(5));
    expect(e.properties["notonq:home"]).toEqual({ name: "Osaka", country: "Japan", country_code: "JP", source: "musicbrainz" });
    expect(e.properties["notonq:languages"]).toEqual([
      { code: "jpn", name: "Japanese", releases: 2 },
      { code: "eng", name: "English", releases: 1 },
    ]);
    expect(e.properties.external).toMatchObject({ "notonq:musicbrainz": { id: MB }, "notonq:wikidata": { id: "Q123" } });
    expect(e.tags.map((t) => t.tag_id)).toEqual(["notonq:urn:tag:genre:emo", "notonq:urn:tag:genre:indie_rock"]);
    expect(body.notonq).toMatchObject({ served_by: "mixed", gap: { kind: "G5" } });
    expect(Object.keys(body.notonq.facts[qid(5)].provenance)).toContain("properties.notonq:languages");
    // Keyed like every other NotOnQ result: Qloo's own record, with the fields NotOnQ added.
    expect((body.notonq as unknown as Record<string, unknown>)[qid(5)]).toMatchObject({
      kind: "gaps",
      fields: expect.arrayContaining(["home", "languages", "genres", "musicbrainz_id", "wikidata_id"]),
    });
  });

  it("serves the facts from the cache on the next call", async () => {
    const { fetch, calls } = fakeFetch([qlooHas(qlooArtist(5, "Kitebird")), ...musicbrainz]);
    await search(fetch);
    const mbCalls = calls.filter((c) => c.includes("musicbrainz")).length;
    expect((await search(fetch)).servedBy).toBe("mixed");
    expect(calls.filter((c) => c.includes("musicbrainz")).length).toBe(mbCalls);
  });

  it("adds nothing when several MusicBrainz artists share the name and Qloo has no MusicBrainz ID", async () => {
    const { fetch } = fakeFetch([
      qlooHas(qlooArtist(5, "Kitebird")),
      ["musicbrainz.org/ws/2/artist?query=", () => json(200, { artists: [mbArtist, { ...mbArtist, id: mbid(41), country: "FR" }] })],
    ]);
    const out = await search(fetch);
    expect(out.servedBy).toBe("qloo");
    expect((out.body as { notonq?: unknown }).notonq).toBeUndefined();
  });

  it("leaves an artist Qloo knows (its record has a MusicBrainz ID) as Qloo's answer alone, without asking MusicBrainz", async () => {
    // No Wikidata ID and no genre tag (Lady Gaga's search record, 29 Oct): still Qloo's artist, so nothing is added.
    const known = qlooArtist(6, "Kitebird", { mb: 40 });
    const { fetch, calls } = fakeFetch([qlooHas(known), ...musicbrainz]);
    expect((await search(fetch)).servedBy).toBe("qloo");
    expect(calls.some((c) => c.includes("musicbrainz"))).toBe(false);
  });

  it("never overwrites what Qloo has", () => {
    const e = { ...qlooArtist(5, "Kitebird", { mb: 40 }), tags: [{ tag_id: "urn:tag:genre:music:emo", type: "urn:tag:genre:music", name: "Emo" }] };
    e.properties.external = { ...e.properties.external, wikidata: { id: "Q9" } } as never;
    const { entity, provenance } = withFacts(e, { mbid: MB, record: `https://musicbrainz.org/artist/${MB}`, wikidata: "Q123", genres: ["punk"], retrievedAt: "2026-10-29T00:00:00Z" });
    expect(entity.properties?.external).toEqual(e.properties.external);
    expect((entity as unknown as { tags: unknown[] }).tags).toEqual(e.tags);
    expect(provenance).toEqual({});
  });

  it("answers an artist's empty demographics with Qloo's audience for its own genres", async () => {
    const asked: string[] = [];
    const { fetch } = fakeFetch([
      ["hackathon.api.qloo.com/entities", () => json(200, { results: [{ ...qlooArtist(5, "Kitebird"), tags: [{ tag_id: "urn:tag:genre:music:mathcore", type: "urn:tag:genre:music" }] }] })],
      [
        "hackathon.api.qloo.com/v2/insights",
        (u) => {
          asked.push(u.searchParams.toString());
          return u.searchParams.get("signal.interests.tags")
            ? json(200, { success: true, results: { demographics: [{ entity_id: "x", query: { age: { "24_and_younger": 0.3 } } }] } })
            : json(200, { success: true, results: { demographics: [] } });
        },
      ],
    ]);
    const out = await handleRest({ path: "v2/insights", params: { "filter.type": "urn:demographics", "signal.interests.entities": qid(5) }, apiKey: "k" }, deps(fetch));
    expect(out.servedBy).toBe("mixed");
    const body = out.body as { results: { demographics: Record<string, unknown>[] }; notonq: Block };
    expect(body.results.demographics[0]["notonq:basis"]).toEqual({ stand_ins: [], genres: ["urn:tag:genre:music:mathcore"] });
    expect(body.notonq).toMatchObject({ served_by: "mixed", gap: { kind: "G5" } });
    expect(asked.at(-1)).toContain("signal.interests.tags=urn%3Atag%3Agenre%3Amusic%3Amathcore");
  });
});
