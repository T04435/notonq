// Live numbers for /proof, computed from every artist lookup NotOnQ has handled (all doors: playground, REST, MCP).
// An artist counts once, by the outcome of its latest lookup.
import type { FallbackEntity } from "@/server/engine/artist";
import type { ProvenanceMap } from "@/server/provenance";
import type { Sql } from "@/server/store/db";

export type LiveStats = {
  since?: string;
  lookups: number;
  artists: number;
  inQloo: number;
  gaps: number;
  gapRatePct: number;
  unknownG1: number;
  notInTasteGraphG2: number;
  awaitingChoice: number;
  filled: { artists: number; entityPct: number; standInsPct: number; descriptionPct: number; genresPct: number; imagePct: number; popularityPct: number; meanCitedFields: number; lowConfidencePct: number };
  cacheHitPct: number;
  standInSwaps: number;
  research: { runs: number; verifiedClaims: number; rejectedClaims: number };
  apps: { app: string; lookups: number; artists: number; gapRatePct: number }[];
};

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const LOOKUP = `served_by IN ('qloo', 'fallback', 'needs_choice')`;

export async function liveStats(sql: Sql): Promise<LiveStats> {
  // Latest outcome per artist name.
  const latest = await sql(
    `SELECT DISTINCT ON (name_key) name_key, served_by, gap_kind, entity_id, app_label
     FROM requests WHERE ${LOOKUP} ORDER BY name_key, created_at DESC`,
  );
  const [counts] = await sql(
    `SELECT count(*) FILTER (WHERE ${LOOKUP})::int AS lookups,
            min(created_at) AS since,
            count(*) FILTER (WHERE served_by = 'fallback')::int AS fallback_requests,
            count(*) FILTER (WHERE served_by = 'fallback' AND cache_hit)::int AS fallback_cache_hits,
            count(*) FILTER (WHERE served_by = 'mixed')::int AS swaps
     FROM requests`,
  );
  const gapNames = latest.filter((r) => r.served_by !== "qloo");
  const entityIds = [...new Set(gapNames.map((r) => r.entity_id).filter(Boolean))] as string[];
  const fills = entityIds.length
    ? await sql(`SELECT id, entity, provenance, stand_ins, confidence FROM fallback_entities WHERE id = ANY($1) AND entity IS NOT NULL`, [entityIds])
    : [];
  const parse = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : (v as T));
  const ents = fills.map((f) => ({ e: parse<FallbackEntity>(f.entity), p: parse<ProvenanceMap>(f.provenance), s: parse<unknown[]>(f.stand_ins), low: f.confidence === "low" }));
  const n = ents.length;

  const [research] = await sql(
    `SELECT (SELECT count(*)::int FROM fallback_entities WHERE research_status IN ('done', 'failed')) AS runs,
            (SELECT count(*)::int FROM research_claims WHERE verified) AS verified,
            (SELECT count(*)::int FROM research_claims WHERE NOT verified) AS rejected`,
  );

  // Per app, the same rule: each artist counts once, by its latest lookup from that app.
  const byApp = new Map<string, { lookups: number; names: Set<string>; gaps: Set<string> }>();
  const appRows = await sql(
    `SELECT app, name_key, served_by, lookups FROM (
       SELECT coalesce(app_label, 'unlabelled') AS app, name_key, served_by,
              count(*) OVER (PARTITION BY coalesce(app_label, 'unlabelled'), name_key) AS lookups,
              row_number() OVER (PARTITION BY coalesce(app_label, 'unlabelled'), name_key ORDER BY created_at DESC) AS rn
       FROM requests WHERE ${LOOKUP}) x
     WHERE rn = 1`,
  );
  for (const r of appRows) {
    const a = byApp.get(String(r.app)) ?? byApp.set(String(r.app), { lookups: 0, names: new Set(), gaps: new Set() }).get(String(r.app))!;
    a.lookups += Number(r.lookups);
    a.names.add(String(r.name_key));
    if (r.served_by !== "qloo") a.gaps.add(String(r.name_key));
  }

  return {
    since: counts?.since ? new Date(counts.since as string).toISOString() : undefined,
    lookups: Number(counts?.lookups ?? 0),
    artists: latest.length,
    inQloo: latest.length - gapNames.length,
    gaps: gapNames.length,
    gapRatePct: pct(gapNames.length, latest.length),
    unknownG1: gapNames.filter((r) => r.gap_kind !== "G2").length,
    notInTasteGraphG2: gapNames.filter((r) => r.gap_kind === "G2").length,
    awaitingChoice: gapNames.filter((r) => r.served_by === "needs_choice").length,
    filled: {
      artists: n,
      entityPct: pct(n, gapNames.length),
      standInsPct: pct(ents.filter((x) => x.s.length > 0).length, n),
      descriptionPct: pct(ents.filter((x) => x.e.properties.short_description).length, n),
      genresPct: pct(ents.filter((x) => x.e.tags.length > 0).length, n),
      imagePct: pct(ents.filter((x) => x.e.properties.image).length, n),
      popularityPct: pct(ents.filter((x) => x.e.popularity !== undefined).length, n),
      meanCitedFields: n ? Math.round((ents.reduce((a, x) => a + Object.keys(x.p).filter((k) => !k.startsWith("standIns.")).length, 0) / n) * 10) / 10 : 0,
      lowConfidencePct: pct(ents.filter((x) => x.low).length, n),
    },
    cacheHitPct: pct(Number(counts?.fallback_cache_hits ?? 0), Number(counts?.fallback_requests ?? 0)),
    standInSwaps: Number(counts?.swaps ?? 0),
    research: { runs: Number(research?.runs ?? 0), verifiedClaims: Number(research?.verified ?? 0), rejectedClaims: Number(research?.rejected ?? 0) },
    apps: [...byApp.entries()]
      .map(([app, a]) => ({ app, lookups: a.lookups, artists: a.names.size, gapRatePct: pct(a.gaps.size, a.names.size) }))
      .sort((x, y) => y.lookups - x.lookups),
  };
}
