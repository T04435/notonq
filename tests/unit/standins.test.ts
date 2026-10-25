import { describe, expect, it } from "vitest";
import { fitPopularity } from "@/server/engine/popularity";
import { lookupBatch, pickStandIns } from "@/server/engine/standins";
import { mbid, qid, qlooArtist } from "./fixtures";

const cand = (n: number, match: number) => ({ name: `Artist ${n}`, mbid: mbid(n), match, source: "lastfm" });

describe("pickStandIns", () => {
  it("keeps only candidates Qloo resolved, best match first, one row per MBID", () => {
    const known = [
      qlooArtist(1, "Artist 1", { mb: 1, popularity: 0.5 }),
      qlooArtist(11, "Artist 1 (dupe)", { mb: 1, popularity: 0.9 }),
      qlooArtist(3, "Artist 3", { mb: 3, popularity: 0.7, listeners: 1000 }),
    ];
    const out = pickStandIns([cand(1, 0.4), cand(2, 0.99), cand(3, 0.8)], known);
    expect(out.map((s) => s.entityId)).toEqual([qid(3), qid(11)]);
    expect(out[0]).toMatchObject({ weight: 0.8, listeners: 1000, popularity: 0.7 });
  });

  it("reads the insights shape (external.<ns> as a list) too", () => {
    const e = { entity_id: qid(5), name: "Five", external: { musicbrainz: [{ id: mbid(5).toUpperCase() }] } };
    expect(pickStandIns([cand(5, 0.5)], [e])).toHaveLength(1);
  });

  it("caps at take", () => {
    const known = [1, 2, 3, 4, 5, 6].map((n) => qlooArtist(n, `A${n}`, { mb: n }));
    expect(pickStandIns([1, 2, 3, 4, 5, 6].map((n) => cand(n, n / 10)), known, 3)).toHaveLength(3);
  });
});

describe("lookupBatch", () => {
  it("dedupes, sorts by match and caps", () => {
    expect(lookupBatch([cand(1, 0.1), cand(2, 0.9), cand(2, 0.8)], 1)).toEqual([mbid(2)]);
  });
});

describe("fitPopularity", () => {
  const pts = [
    { listeners: 1_000, popularity: 0.3 },
    { listeners: 10_000, popularity: 0.5 },
    { listeners: 100_000, popularity: 0.7 },
    { listeners: 1_000_000, popularity: 0.9 },
  ];

  it("fits log10(listeners) → popularity and predicts", () => {
    const fit = fitPopularity(pts, 316_228)!;
    expect(fit.n).toBe(4);
    expect(fit.rmse).toBe(0);
    expect(fit.value).toBeCloseTo(0.8, 2);
  });

  it("clamps to 0..1", () => {
    expect(fitPopularity(pts, 1e12)!.value).toBe(1);
  });

  it("refuses with too few points or no listeners", () => {
    expect(fitPopularity(pts.slice(0, 3), 1000)).toBeNull();
    expect(fitPopularity(pts, 0)).toBeNull();
  });
});
