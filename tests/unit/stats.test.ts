import { describe, expect, it } from "vitest";
import { memoryDb } from "@/server/store/db";
import { logRequest, saveFallback } from "@/server/store/repo";
import { liveStats } from "@/server/store/stats";

describe("liveStats", () => {
  it("counts each artist once by its latest lookup, and summarises fills, cache and apps", async () => {
    const sql = await memoryDb();
    const base = { endpoint: "playground", callerHash: "h", cacheHit: false };
    await saveFallback(sql, {
      id: "notonq:mbid:1",
      nameKey: "newact",
      name: "Newact",
      gapKind: "G1",
      entity: { name: "Newact", entity_id: "notonq:mbid:1", types: ["urn:entity:artist"], properties: { akas: [], external: {}, short_description: "A band." }, tags: [], popularity: 0.4 },
      provenance: { name: [], "properties.short_description": [], "standIns.X": [] },
      standIns: [{ entityId: "X", name: "X", weight: 1, source: "lastfm" }],
      unavailable: [],
    });
    await logRequest(sql, { ...base, nameKey: "known act", servedBy: "qloo", appLabel: "app-a" });
    await logRequest(sql, { ...base, nameKey: "newact", servedBy: "fallback", gapKind: "G1", entityId: "notonq:mbid:1", appLabel: "app-a" });
    await logRequest(sql, { ...base, nameKey: "newact", servedBy: "fallback", gapKind: "G1", entityId: "notonq:mbid:1", cacheHit: true, appLabel: "app-b" });
    await logRequest(sql, { ...base, nameKey: "tiny", servedBy: "needs_choice", gapKind: "G1" });
    await logRequest(sql, { ...base, nameKey: "newact", servedBy: "mixed", endpoint: "/v2/insights", entityId: "notonq:mbid:1" });

    const s = await liveStats(sql);
    expect(s).toMatchObject({ lookups: 4, artists: 3, inQloo: 1, gaps: 2, gapRatePct: 66.7, unknownG1: 2, awaitingChoice: 1, cacheHitPct: 50, standInSwaps: 1 });
    expect(s.filled).toMatchObject({ artists: 1, entityPct: 50, standInsPct: 100, descriptionPct: 100, popularityPct: 100, meanCitedFields: 2 });
    expect(s.apps.find((a) => a.app === "app-a")).toMatchObject({ lookups: 2, artists: 2, gapRatePct: 50 });
  });
});
