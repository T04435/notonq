import { describe, expect, it } from "vitest";
import { resolveArtist, withStandIns } from "@/server/engine/artist";
import { qlooClient } from "@/server/qloo/client";
import { fakeFetch, json, mbid, qid, qlooArtist } from "./fixtures";

const NEW = mbid(99);

const openData: [string, (u: URL) => Response][] = [
  [
    `musicbrainz.org/ws/2/artist/${NEW}`,
    () => json(200, { id: NEW, name: "Newact", country: "US", "begin-area": { name: "Seattle" }, disambiguation: "indie band", aliases: [{ name: "New Act" }], tags: [{ name: "indie pop", count: 3 }] }),
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
      entity_id: NEW,
      name: "Newact",
      types: ["urn:entity:artist"],
      disambiguation: "indie band, US",
      properties: {
        short_description: "Not in Qloo: filled by NotOnQ from open sources. Taste answers (recommendations, maps, audiences) use similar artists Qloo knows: Similar 1, Similar 2, Similar 3. From Seattle, United States (MusicBrainz). Newact is a band.",
        "notonq:home": { name: "Seattle", country: "United States", country_code: "US", source: "musicbrainz" },
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

  it("uses Qloo's own genre tag where Qloo has one by that exact name, NotOnQ's otherwise (v0.4.0)", async () => {
    const tags = (u: URL) =>
      json(200, { success: true, results: { tags: u.searchParams.get("filter.query") === "indie pop" ? [{ id: "urn:tag:genre:music:indie_pop", name: "Indie Pop", type: "urn:tag:genre:music" }, { id: "urn:tag:genre:music:pop", name: "Pop", type: "urn:tag:genre:music" }] : [{ id: "urn:tag:genre:music:rock", name: "Rock", type: "urn:tag:genre:music" }] } });
    const { fetch } = fakeFetch([["/search", () => json(404, { message: "No results" })], ["/v2/tags", tags], ...openData]);
    const out = await resolveArtist("Newact", { qloo: qlooClient({ apiKey: "k3", fetch }), lastfmKey: "lf", fetch });
    if (out.servedBy !== "fallback") throw new Error("expected a fallback");
    expect(out.entity?.tags).toEqual([
      { name: "alternative rock", tag_id: "notonq:urn:tag:genre:alternative_rock", type: "urn:tag:genre", value: "notonq:urn:tag:genre:alternative_rock" },
      { name: "Indie Pop", tag_id: "urn:tag:genre:music:indie_pop", type: "urn:tag:genre:music", value: "urn:tag:genre:music:indie_pop" },
    ]);
    expect(out.provenance.tags[0].note).toBe("1 of 2 genre names matched to Qloo's own tags by exact name (/v2/tags)");
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

  it("finds similar artists Qloo knows by name, from Last.fm and then Deezer, when MusicBrainz IDs don't match (v0.4.1)", async () => {
    const searched: string[] = [];
    const routes: [string, (u: URL) => Response][] = [
      [
        "hackathon.api.qloo.com/search",
        (u) => {
          const q = u.searchParams.get("query") ?? "";
          searched.push(q);
          return q === "Newact" ? json(404, { message: "No results" }) : q === "Named Act" ? json(200, { results: [qlooArtist(21, "Named Act")] }) : q === "Sixth Related" ? json(200, { results: [qlooArtist(22, "Sixth Related")] }) : json(200, { results: [] });
        },
      ],
      ["hackathon.api.qloo.com/entities", () => json(200, { results: [] })],
      ["method=artist.getsimilar", () => json(200, { similarartists: { artist: [{ name: "No Id Act", match: "0.9" }, { name: "Named Act", match: "0.8" }] } })],
      ["api.deezer.com/search/artist", () => json(200, { data: [{ id: 7, name: "Newact", nb_fan: 10 }] })],
      ["api.deezer.com/artist/7/related", () => json(200, { data: ["R1", "R2", "R3", "R4", "R5", "Sixth Related"].map((name, i) => ({ id: 100 + i, name })) })],
      ...openData.filter(([m]) => m !== "method=artist.getsimilar" && m !== "hackathon.api.qloo.com/entities"),
    ];
    const { fetch } = fakeFetch(routes);
    const out = await resolveArtist("Newact", { qloo: qlooClient({ apiKey: "k5", fetch }), lastfmKey: "lf", fetch });
    if (out.servedBy !== "fallback") throw new Error("expected a fallback");
    expect(out.standIns.map((s) => [s.name, s.source])).toEqual([
      ["Named Act", "lastfm"],
      ["Sixth Related", "deezer"],
    ]);
    expect(searched).toContain("Sixth Related");
    expect(out.provenance[`standIns.${qid(22)}`]?.[0].note).toBe("Deezer related artist #6; resolved in Qloo by exact name");
  });

  it("says why when there is no Last.fm key", async () => {
    const { fetch } = fakeFetch([["/search", () => json(404, { message: "No results" })], ...openData]);
    const out = await resolveArtist("Newact", { qloo: qlooClient({ apiKey: "k3", fetch }), fetch });
    if (out.servedBy !== "fallback") throw new Error("expected a fallback");
    expect(out.standIns).toEqual([]);
    expect(out.unavailable).toEqual(expect.arrayContaining(["standIns (no Last.fm key; tried Deezer related artists)", "popularity"]));
  });
});

describe("withStandIns", () => {
  const entity = { name: "Alter Boy", entity_id: "x", type: "urn:entity", subtype: "urn:entity:artist", properties: { akas: [], external: {}, short_description: "Not in Qloo: … use similar artists Qloo knows: A.GIRL, Hope D." }, tags: [] } as unknown as Parameters<typeof withStandIns>[0];

  it("lists the stand-ins as structured data, so names with dots or commas survive", () => {
    const out = withStandIns(entity, [{ entityId: "A1", name: "A.GIRL" }, { entityId: "B2", name: "Tyler, the Creator" }]);
    expect(out.properties["notonq:standIns"]).toEqual([{ entity_id: "A1", name: "A.GIRL" }, { entity_id: "B2", name: "Tyler, the Creator" }]);
    expect(out.properties.short_description).toBe(entity.properties.short_description);
    expect(entity.properties["notonq:standIns"]).toBeUndefined();
  });

  it("adds nothing when there are no stand-ins", () => {
    expect(withStandIns(entity, [])).toBe(entity);
  });
});
