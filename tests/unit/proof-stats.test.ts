import { beforeEach, describe, expect, it } from "vitest";
import { FILL_QUESTIONS } from "@/lib/benchmark";
import { memoryDb, type Sql } from "@/server/store/db";
import { proofStats } from "@/server/store/proof-stats";
import { saveRun } from "@/server/store/repo";

let sql: Sql;
beforeEach(async () => {
  sql = await memoryDb();
});

/** An artist search through /q, as the Ledger records it: the request, then NotOnQ's response. */
const search = (query: string, servedBy: string, gap: string | null, app = "ghostq", caller = "c1") =>
  saveRun(sql, {
    id: crypto.randomUUID(),
    kind: "api",
    title: `GET /q/search?query=${query.replace(/ /g, "+")}&types=urn:entity:artist`,
    servedBy,
    appLabel: app,
    callerHash: caller,
    events: [
      { t: 0, type: "request", params: { query: query.replace(/ /g, "+"), types: "urn:entity:artist" } },
      { t: 5, type: "response", body: { notonq: gap ? { gap: { kind: gap }, served_by: servedBy } : { served_by: servedBy } } },
    ],
  });

const ask = (title: string, servedBy: string | undefined, app = "ask") =>
  saveRun(sql, { id: crypto.randomUUID(), kind: "ask", title, servedBy, appLabel: app, callerHash: "a", events: [] });

const record = (nameKey: string, name: string, over: { home?: string; tags?: string[]; standIns?: string[]; image?: boolean; popularity?: number; description?: boolean; low?: boolean } = {}) =>
  sql(`INSERT INTO fallback_entities (id, name_key, name, gap_kind, entity, provenance, stand_ins, confidence) VALUES ($1,$2,$3,'G1',$4,$5,$6,$7)`, [
    `id-${nameKey}`,
    nameKey,
    name,
    JSON.stringify({
      name,
      entity_id: `id-${nameKey}`,
      properties: { akas: [], external: {}, ...(over.home ? { "notonq:home": { name: over.home, source: "musicbrainz" } } : {}), ...(over.image ? { image: { url: "https://x/y.jpg" } } : {}) },
      ...(over.popularity !== undefined ? { popularity: over.popularity } : {}),
      tags: (over.tags ?? []).map((t) => ({ name: t, tag_id: t, type: "genre", value: t })),
    }),
    JSON.stringify({
      name: [{ source: "musicbrainz", record: "https://musicbrainz.org/artist/x", licence: "CC0", method: "copied", retrievedAt: "" }],
      ...(over.description ? { "properties.short_description": [{ source: "wikipedia", record: "https://en.wikipedia.org/wiki/X", licence: "CC BY-SA", method: "copied", retrievedAt: "", note: "Wikipedia summary copied" }] } : {}),
    }),
    JSON.stringify((over.standIns ?? []).map((s) => ({ entityId: s, name: s }))),
    over.low ? "low" : null,
  ]);

describe("proofStats", () => {
  it("counts artists by their latest search, from the first lookup on", async () => {
    await search("Taylor Swift", "qloo", null);
    await search("Wampi", "fallback", "G1");
    await search("Wampi", "fallback", "G1", "busk-map", "c2");
    await search("sombr", "fallback", "G2");
    await record("wampi", "Wampi", { home: "La Habana", tags: ["reparto"], standIns: ["El Taiger"] });
    await record("sombr", "sombr", { home: "New York", image: true, popularity: 0.4, description: true });
    const s = await proofStats(sql);
    expect(s.lookups).toBe(4);
    expect(s.since).toBeDefined();
    expect(s.artists).toMatchObject({ total: 3, usable: 1, G1: 1, G2: 1 });
    expect(s.filled).toMatchObject({ artists: 2, home: 2, genres: 1, similar: 1, description: 1, image: 1, popularity: 1, lowConfidence: 0, G1: 1, G2: 1 });
    expect(s.filled.citedFields).toBe(1.5);
    expect(s.apps.find((a) => a.app === "ghostq")).toMatchObject({ lookups: 3, artists: 3 });
    expect(s.apps.find((a) => a.app === "busk-map")).toMatchObject({ lookups: 1, artists: 1 });
  });

  it("returns one row per artist we filled in, most looked up first, with the Ask questions about it linked to their runs", async () => {
    await search("Wampi", "fallback", "G1");
    await search("Wampi", "fallback", "G1", "ghostq", "c2");
    await search("sombr", "fallback", "G2");
    await record("wampi", "Wampi", { home: "La Habana", tags: ["reparto"], standIns: ["El Taiger"] });
    await record("sombr", "sombr", { home: "New York" });
    await ask(FILL_QUESTIONS.who("Wampi"), "notonq");
    await ask(FILL_QUESTIONS.ages("Wampi"), "notonq");
    await ask(FILL_QUESTIONS.map("Wampi"), undefined);
    await ask("Something else about Wampi", "notonq");

    const { artistRows } = await proofStats(sql);
    expect(artistRows.map((r) => [r.name, r.lookups, r.gap])).toEqual([
      ["Wampi", 2, "G1"],
      ["sombr", 1, "G2"],
    ]);
    const w = artistRows[0];
    expect(w.record).toEqual({ home: "La Habana", genres: ["reparto"], similar: ["El Taiger"], description: false, image: false, popularity: undefined });
    expect(Object.keys(w.ask).sort()).toEqual(["ages", "map", "who"]);
    expect(w.ask.who).toMatchObject({ answered: true });
    expect(w.ask.map).toMatchObject({ answered: false });
    const [run] = await sql<{ id: string }>(`SELECT id FROM runs WHERE title = $1`, [FILL_QUESTIONS.who("Wampi")]);
    expect(w.ask.who?.runId).toBe(run.id);
    expect(artistRows[1].ask).toEqual({});
  });

  it("scopes every count to one app when filtered; the benchmark batch is just the app benchmark", async () => {
    await search("Wampi", "fallback", "G1", "benchmark");
    await search("sombr", "fallback", "G2", "ghostq");
    await record("wampi", "Wampi");
    await record("sombr", "sombr");
    await ask(FILL_QUESTIONS.genre("Wampi"), "notonq", "benchmark");
    await ask(FILL_QUESTIONS.genre("sombr"), "notonq", "ask");
    const b = await proofStats(sql, "benchmark");
    expect(b.app).toBe("benchmark");
    expect(b.artistRows.map((r) => r.name)).toEqual(["Wampi"]);
    expect(b.artistRows[0].ask.genre).toBeDefined();
    expect(b.asks.total).toBe(1);
    const g = await proofStats(sql, "ghostq");
    expect(g.artistRows.map((r) => r.name)).toEqual(["sombr"]);
    expect(g.artistRows[0].ask).toEqual({});
  });
});
