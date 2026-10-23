import { describe, expect, it } from "vitest";
import { resolveArtist } from "@/server/engine/artist";
import { qlooClient } from "@/server/qloo/client";
import { fakeFetch, json, mbid, qid, qlooArtist } from "./fixtures";

const NEW = mbid(99);

const openData: [string, (u: URL) => Response][] = [
  [
    `musicbrainz.org/ws/2/artist/${NEW}`,
    () => json(200, { id: NEW, name: "Newact", country: "US", disambiguation: "indie band", aliases: [{ name: "New Act" }], tags: [{ name: "indie pop", count: 3 }] }),
  ],
  [
    "musicbrainz.org/ws/2/artist",
    () =>
      json(200, {
        artists: [
          { id: NEW, name: "Newact", score: 100, country: "US", disambiguation: "indie band", aliases: [{ name: "New Act" }], tags: [{ name: "indie pop", count: 3 }] },
        ],
      }),
  ],
  [
    "query.wikidata.org",
    () =>
      json(200, {
        results: {
          bindings: [
            {
              item: { value: "http://www.wikidata.org/entity/Q1" },
              article: { value: "https://en.wikipedia.org/wiki/Newact" },
              spotify: { value: "spotifyid1" },
              genres: { value: "alternative rock|indie pop" },
            },
          ],
        },
      }),
  ],
  ["en.wikipedia.org/api/rest_v1/page/summary", () => json(200, { type: "standard", extract: "Newact is a band.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Newact" } } })],
  [
    "method=artist.getinfo",
    () => json(200, { artist: { url: "https://www.last.fm/music/Newact", stats: { listeners: "316228", playcount: "9000000" } } }),
  ],
  [
    "method=artist.getsimilar",
    () =>
      json(200, {
        similarartists: {
          artist: [1, 2, 3, 4, 5, 6].map((n) => ({ name: `Similar ${n}`, mbid: mbid(n), match: String(1 - n / 10) })),
        },
      }),
  ],
  [
    "hackathon.api.qloo.com/entities",
    () =>
      json(200, {
        results: [
          qlooArtist(1, "Similar 1", { mb: 1, popularity: 0.3, listeners: 1_000 }),
          qlooArtist(2, "Similar 2", { mb: 2, popularity: 0.5, listeners: 10_000 }),
          qlooArtist(3, "Similar 3", { mb: 3, popularity: 0.7, listeners: 100_000 }),
          qlooArtist(4, "Similar 4", { mb: 4, popularity: 0.9, listeners: 1_000_000 }),
        ],
      }),
  ],
];

describe("resolveArtist", () => {
  it("passes Qloo's entity straight through when Qloo knows the artist", async () => {
    const { fetch, calls } = fakeFetch([
      ["/search", () => json(200, { results: [qlooArtist(7, "Known Act")] })],
      ["/v2/insights", () => json(200, { results: { entities: [qlooArtist(8, "Other")] } })],
    ]);
    const out = await resolveArtist("Known Act", { qloo: qlooClient({ apiKey: "k", fetch }), fetch });
    expect(out).toEqual({ servedBy: "qloo", entity: expect.objectContaining({ entity_id: qid(7) }) });
    expect(calls.some((c) => c.includes("musicbrainz"))).toBe(false);
  });

  it("builds a sourced Qloo-shaped entity and stand-ins for an unknown artist (G1)", async () => {
    const { fetch } = fakeFetch([["/search", () => json(404, { message: "No results" })], ...openData]);
    const out = await resolveArtist("Newact", { qloo: qlooClient({ apiKey: "k", fetch }), lastfmKey: "lf", fetch });
    if (out.servedBy !== "fallback") throw new Error("expected a fallback");
    expect(out.gap.kind).toBe("G1");
    expect(out.entity).toMatchObject({
      entity_id: `notonq:mbid:${NEW}`,
      name: "Newact",
      types: ["urn:entity:artist"],
      disambiguation: "indie band, US",
      properties: {
        short_description: "Newact is a band.",
        akas: [{ value: "New Act", languages: [] }],
        external: { musicbrainz: { id: NEW }, wikidata: { id: "Q1" }, spotify: { id: "spotifyid1" }, lastfm: { listeners: 316228 } },
      },
    });
    expect(out.entity?.tags.map((t) => t.name)).toEqual(["alternative rock", "indie pop"]);
    expect(out.standIns.map((s) => s.entityId)).toEqual([qid(1), qid(2), qid(3), qid(4)]);
    expect(out.popularity?.value).toBeCloseTo(0.8, 2);
    // Every value carries proof.
    for (const path of ["name", "properties.short_description", "properties.external.wikidata", "tags", "popularity"])
      expect(out.provenance[path]?.[0]?.record, path).toBeTruthy();
    expect(out.provenance.popularity[0].method).toBe("derived");
    expect(out.unavailable).toContain("properties.image");
  });

  it("keeps Qloo's entity and still builds the fallback when Qloo can't use it as a signal (G2)", async () => {
    const { fetch } = fakeFetch([
      ["/search", () => json(200, { results: [qlooArtist(9, "Newact")] })],
      ["/v2/insights", () => json(400, { message: "All of the provided signal.interests.entities were invalid" })],
      ...openData,
    ]);
    const out = await resolveArtist("Newact", { qloo: qlooClient({ apiKey: "k2", fetch }), lastfmKey: "lf", fetch });
    if (out.servedBy !== "fallback") throw new Error("expected a fallback");
    expect(out.gap.kind).toBe("G2");
    expect(out.qlooEntity?.entity_id).toBe(qid(9));
    expect(out.standIns.length).toBeGreaterThan(0);
  });

  it("marks a source that failed (not one that found nothing), so the fill is retried sooner", async () => {
    const down = openData.map(([m, r]) => [m, m === "query.wikidata.org" ? () => json(503, {}) : r] as [string, (u: URL) => Response]);
    const { fetch } = fakeFetch([["/search", () => json(404, { message: "No results" })], ...down]);
    const out = await resolveArtist("Newact", { qloo: qlooClient({ apiKey: "k4", fetch }), lastfmKey: "lf", fetch });
    if (out.servedBy !== "fallback") throw new Error("expected a fallback");
    expect(out.unavailable).toContain("properties.external.wikidata (source error: Wikidata HTTP 503)");
    expect(out.entity?.name).toBe("Newact");
  });

  it("says why when there is no Last.fm key", async () => {
    const { fetch } = fakeFetch([["/search", () => json(404, { message: "No results" })], ...openData]);
    const out = await resolveArtist("Newact", { qloo: qlooClient({ apiKey: "k3", fetch }), fetch });
    if (out.servedBy !== "fallback") throw new Error("expected a fallback");
    expect(out.standIns).toEqual([]);
    expect(out.unavailable).toEqual(expect.arrayContaining(["standIns (no Last.fm key)", "popularity"]));
  });
});
