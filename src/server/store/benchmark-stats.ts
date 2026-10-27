// Proof's benchmark numbers, counted from the latest benchmark batch's runs in the Ledger (scripts/benchmark.mts):
// one coverage visit per artist (X-NotOnQ-Trace "<batch>:<sample>:<artist>"), an Ask question per artist, and the
// fill questions about the artists we filled in. Nothing is stored apart from the runs themselves.
import { FILL_QUESTIONS, type FillQuestion } from "@/lib/benchmark";
import type { FallbackEntity } from "@/server/engine/artist";
import type { ProvenanceMap } from "@/server/provenance";
import { nameKey } from "@/server/qloo/gap";
import type { Sql } from "@/server/store/db";

export type CoverageStatus = "usable" | "G1" | "G2";
/** ambiguous: new to Qloo, and NotOnQ found more than one artist by that name (waiting for a caller to choose). */
export type CoveredArtist = { name: string; sample: "fresh" | "chart"; status: CoverageStatus; ambiguous: boolean; visitId: string };
export type FilledArtist = {
  name: string;
  visitId: string;
  /** What the filled-in record has, each with a source in its provenance. */
  record: { home: boolean; genres: boolean; similar: boolean; description: boolean; image: boolean; popularity: boolean };
  /** Per fill question: the Ask run, and whether its NotOnQ stage answered it with data. */
  asks: Partial<Record<FillQuestion, { runId: string; answered: boolean }>>;
};
export type BenchmarkStats = {
  batch: string;
  ranAt: string;
  coverage: Record<"fresh" | "chart", { artists: number; usable: number; G1: number; G2: number; ambiguous: number; gapPct: number }>;
  artists: CoveredArtist[];
  filled: FilledArtist[];
  /** Coverage Ask runs ("Recommend artists similar to …"), by who answered: Qloo alone, or NotOnQ. */
  coverageAsks: { runs: number; qloo: number; notonq: number };
};

const decodeName = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const parse = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : (v as T));

/** The latest batch's numbers, or null before any batch has run. */
export async function benchmarkStats(sql: Sql): Promise<BenchmarkStats | null> {
  const [latest] = await sql(
    `SELECT split_part(trace, ':', 1) AS batch, min(first_at) AS ran_at FROM visits
     WHERE app_label IN ('benchmark-fresh', 'benchmark-chart') AND trace LIKE 'b%:%' GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
  );
  if (!latest) return null;
  const batch = String(latest.batch);
  const ranAt = new Date(latest.ran_at as string).toISOString();

  // Each coverage visit's calls: the /search, and the /v2/insights signal check when Qloo found the artist.
  const calls = await sql(
    `SELECT v.id AS visit_id, v.trace, r.title, r.served_by, r.events->1->'body'->'notonq'->'gap'->>'kind' AS gap, r.events->1->'body'->'notonq'->>'served_by' AS answered_by
     FROM visits v JOIN runs r ON r.visit_id = v.id
     WHERE v.app_label IN ('benchmark-fresh', 'benchmark-chart') AND v.trace LIKE $1 AND r.kind = 'api'`,
    [`${batch}:%`],
  );
  const byVisit = new Map<string, { trace: string; rows: typeof calls }>();
  for (const c of calls) {
    const v = byVisit.get(String(c.visit_id)) ?? byVisit.set(String(c.visit_id), { trace: String(c.trace), rows: [] }).get(String(c.visit_id))!;
    v.rows.push(c);
  }
  const artists: CoveredArtist[] = [];
  for (const [visitId, v] of byVisit) {
    const [, sample, ...name] = v.trace.split(":");
    const search = v.rows.find((r) => String(r.title).startsWith("GET /q/search"));
    if (!search || (sample !== "fresh" && sample !== "chart")) continue;
    const status: CoverageStatus = search.gap === "G1" || search.gap === "G2" ? (search.gap as "G1" | "G2") : v.rows.some((r) => r.gap === "G2") ? "G2" : search.served_by === "qloo" ? "usable" : "G1";
    artists.push({ name: decodeName(name.join(":")), sample, status, ambiguous: search.answered_by === "needs_choice" || search.served_by === "needs_choice", visitId });
  }
  const coverage = Object.fromEntries(
    (["fresh", "chart"] as const).map((s) => {
      const xs = artists.filter((a) => a.sample === s);
      const n = (k: CoverageStatus) => xs.filter((a) => a.status === k).length;
      return [s, { artists: xs.length, usable: n("usable"), G1: n("G1"), G2: n("G2"), ambiguous: xs.filter((a) => a.ambiguous).length, gapPct: pct(n("G1") + n("G2"), xs.length) }];
    }),
  ) as BenchmarkStats["coverage"];

  // The Ask runs of this batch (saved after the coverage visits began).
  const asks = await sql(`SELECT id, title, app_label, served_by, events FROM runs WHERE kind = 'ask' AND app_label LIKE 'benchmark-%' AND created_at >= $1`, [ranAt]);
  const coverageRuns = asks.filter((a) => a.app_label !== "benchmark-fill");

  // Fill: the filled-in record behind each gap artist, and the fill questions asked about it.
  const gaps = artists.filter((a) => a.status === "G1" || a.status === "G2");
  const records = gaps.length
    ? await sql(`SELECT DISTINCT ON (name_key) name_key, entity, provenance, stand_ins FROM fallback_entities WHERE name_key = ANY($1) AND entity IS NOT NULL ORDER BY name_key, refreshed_at DESC`, [gaps.map((g) => nameKey(g.name))])
    : [];
  const recordOf = new Map(records.map((r) => [String(r.name_key), r]));
  const fillRuns = asks.filter((a) => a.app_label === "benchmark-fill");
  const filled: FilledArtist[] = [];
  for (const g of gaps) {
    const asked = Object.fromEntries(
      (Object.keys(FILL_QUESTIONS) as FillQuestion[]).flatMap((k) => {
        const run = fillRuns.find((r) => r.title === FILL_QUESTIONS[k](g.name));
        return run ? [[k, { runId: String(run.id), answered: answeredByNotOnQ(k, parse<Record<string, unknown>[]>(run.events)) }]] : [];
      }),
    ) as FilledArtist["asks"];
    if (!Object.keys(asked).length) continue;
    const r = recordOf.get(nameKey(g.name));
    const e = r ? parse<FallbackEntity>(r.entity) : undefined;
    const p = r ? parse<ProvenanceMap>(r.provenance) : {};
    filled.push({
      name: g.name,
      visitId: g.visitId,
      record: {
        home: !!e?.properties["notonq:home"],
        genres: (e?.tags.length ?? 0) > 0,
        similar: (r ? parse<unknown[]>(r.stand_ins) : []).length > 0,
        description: !!p["properties.short_description"]?.some((c) => c.note?.includes("Wikipedia summary copied")),
        image: !!e?.properties.image,
        popularity: e?.popularity !== undefined,
      },
      asks: asked,
    });
  }

  return {
    batch,
    ranAt,
    coverage,
    artists,
    filled,
    coverageAsks: { runs: coverageRuns.length, qloo: coverageRuns.filter((a) => a.served_by === "qloo").length, notonq: coverageRuns.filter((a) => a.served_by && a.served_by !== "qloo").length },
  };
}

const TOOL: Record<FillQuestion, string[]> = {
  who: ["qloo_describe"],
  genre: ["qloo_describe", "qloo_entity_tags"],
  similar: ["qloo_recommend"],
  map: ["qloo_where_popular"],
  ages: ["qloo_audience_demographics"],
};

/** Whether the run's NotOnQ stage got data back from the tool that answers this question. */
export function answeredByNotOnQ(question: FillQuestion, events: Record<string, unknown>[]): boolean {
  return events.some((e) => e.type === "call" && e.stage !== "qloo" && TOOL[question].includes(String(e.tool)) && e.status === "ok" && Array.isArray(e.results) && e.results.length > 0);
}
