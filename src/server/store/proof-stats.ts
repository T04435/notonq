// Every number on /proof, counted from the runs in the Ledger: all apps alike (the benchmark batch is one of them), or
// one app when Proof is filtered. An artist counts once, by its latest artist search through /q.
import type { FallbackEntity } from "@/server/engine/artist";
import type { ProvenanceMap } from "@/server/provenance";
import { nameKey } from "@/server/qloo/gap";
import type { Sql } from "@/server/store/db";

export type ArtistOutcome = "usable" | "G1" | "G2";
export type TasteQuestion = "similar" | "map" | "ages";

export type ProofStats = {
  app?: string;
  since?: string;
  runs: number;
  /** Artists searched through /q, each by its latest search. */
  artists: { total: number; usable: number; G1: number; G2: number; ambiguous: number; gapPct: number };
  /** The records we filled in for those gap artists (each field has a source in its provenance). */
  filled: { artists: number; home: number; genres: number; similar: number; description: number; image: number; popularity: number; lowConfidence: number };
  /** Insights calls Qloo answered for similar artists it knows, in place of an artist it has no taste data for. */
  standInCalls: number;
  /** Responses NotOnQ added to that came from its cache, of those that say. */
  cache: { hits: number; of: number };
  /** Ask questions: who answered, and taste questions NotOnQ's step got data for. */
  asks: { total: number; qloo: number; notonq: number; taste: Record<TasteQuestion, { asked: number; answered: number }> };
  apps: { app: string; runs: number; sharePct: number; artists: number; gapPct: number }[];
  /** The artists we filled in that callers searched for most. */
  mostAsked: { nameKey: string; name: string; searches: number }[];
};

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const parse = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : (v as T));
const ARTIST_SEARCH = `kind = 'api' AND title LIKE 'GET /q/search?%' AND coalesce(events->0->'params'->>'types', 'urn:entity:artist') LIKE '%urn:entity:artist%'`;

const TASTE_TOOL: Record<TasteQuestion, string> = { similar: "qloo_recommend", map: "qloo_where_popular", ages: "qloo_audience_demographics" };

export async function proofStats(sql: Sql, app?: string): Promise<ProofStats> {
  const scope = app ? `AND coalesce(app_label, 'unlabelled') = $1` : "";
  const args = app ? [app] : [];

  const [totals] = await sql(`SELECT count(*)::int AS runs, min(created_at) AS since FROM runs WHERE true ${scope}`, args);

  // Artists: the latest artist search for each name, and what it said.
  const searches = await sql(
    `SELECT coalesce(app_label, 'unlabelled') AS app, served_by, created_at,
            events->0->'params'->>'query' AS query,
            events->1->'body'->'notonq'->'gap'->>'kind' AS gap,
            events->1->'body'->'notonq'->>'served_by' AS answered_by
     FROM runs WHERE ${ARTIST_SEARCH} ${scope} ORDER BY created_at`,
    args,
  );
  type Seen = { name: string; outcome: ArtistOutcome; ambiguous: boolean; searches: number; apps: Set<string> };
  const byName = new Map<string, Seen>();
  for (const s of searches) {
    const name = String(s.query ?? "").replace(/\+/g, " ").trim();
    if (!name) continue;
    const key = nameKey(name);
    const ambiguous = s.answered_by === "needs_choice" || s.served_by === "needs_choice";
    const outcome: ArtistOutcome = s.gap === "G1" || s.gap === "G2" ? (s.gap as ArtistOutcome) : s.served_by === "qloo" ? "usable" : "G1";
    const prev = byName.get(key);
    byName.set(key, { name, outcome, ambiguous, searches: (prev?.searches ?? 0) + 1, apps: (prev?.apps ?? new Set()).add(String(s.app)) });
  }
  const seen = [...byName.entries()];
  const gaps = seen.filter(([, v]) => v.outcome !== "usable");
  const n = (o: ArtistOutcome) => seen.filter(([, v]) => v.outcome === o).length;

  // The filled-in records behind the gap artists.
  const records = gaps.length
    ? await sql(`SELECT DISTINCT ON (name_key) name_key, entity, provenance, stand_ins, confidence FROM fallback_entities WHERE name_key = ANY($1) AND entity IS NOT NULL ORDER BY name_key, refreshed_at DESC`, [gaps.map(([k]) => k)])
    : [];
  const recs = records.map((r) => ({ e: parse<FallbackEntity>(r.entity), p: parse<ProvenanceMap>(r.provenance), s: parse<unknown[]>(r.stand_ins), low: r.confidence === "low" }));
  const count = (f: (r: (typeof recs)[number]) => boolean) => recs.filter(f).length;

  const [proxy] = await sql(
    `SELECT count(*) FILTER (WHERE served_by = 'mixed' AND title LIKE 'GET /q/v2/insights%')::int AS stand_in_calls,
            count(*) FILTER (WHERE events->1->'body'->'notonq'->'cache'->>'hit' = 'true')::int AS cache_hits,
            count(*) FILTER (WHERE events->1->'body'->'notonq'->'cache' IS NOT NULL)::int AS cache_of
     FROM runs WHERE kind = 'api' ${scope}`,
    args,
  );

  // Ask questions, and the calls NotOnQ's step made in each (Qloo's own step is left out).
  const asks = await sql(
    `SELECT served_by, (SELECT coalesce(jsonb_agg(jsonb_build_object('tool', e->>'tool', 'status', e->>'status', 'n', jsonb_array_length(coalesce(e->'results', '[]'::jsonb)))), '[]'::jsonb)
                        FROM jsonb_array_elements(events) e WHERE e->>'type' = 'call' AND e->>'stage' <> 'qloo') AS calls
     FROM runs WHERE kind = 'ask' ${scope}`,
    args,
  );
  const taste = Object.fromEntries(
    (Object.keys(TASTE_TOOL) as TasteQuestion[]).map((k) => {
      const tool = TASTE_TOOL[k];
      const runs = asks.map((a) => parse<{ tool: string; status: string; n: number }[]>(a.calls).filter((c) => c.tool === tool)).filter((c) => c.length > 0);
      return [k, { asked: runs.length, answered: runs.filter((c) => c.some((x) => x.status === "ok" && x.n > 0)).length }];
    }),
  ) as ProofStats["asks"]["taste"];

  // Apps: every run counts toward its app's share; artists and gaps by each app's own searches.
  const appRuns = await sql(`SELECT coalesce(app_label, 'unlabelled') AS app, count(*)::int AS runs FROM runs GROUP BY 1 ORDER BY 2 DESC`);
  const allRuns = appRuns.reduce((a, r) => a + Number(r.runs), 0);
  const apps = appRuns.map((r) => {
    const mine = seen.filter(([, v]) => v.apps.has(String(r.app)));
    return { app: String(r.app), runs: Number(r.runs), sharePct: pct(Number(r.runs), allRuns), artists: mine.length, gapPct: pct(mine.filter(([, v]) => v.outcome !== "usable").length, mine.length) };
  });

  return {
    app,
    since: totals?.since ? new Date(totals.since as string).toISOString() : undefined,
    runs: Number(totals?.runs ?? 0),
    artists: { total: seen.length, usable: n("usable"), G1: n("G1"), G2: n("G2"), ambiguous: gaps.filter(([, v]) => v.ambiguous).length, gapPct: pct(gaps.length, seen.length) },
    filled: {
      artists: recs.length,
      home: count((r) => !!r.e.properties["notonq:home"]),
      genres: count((r) => r.e.tags.length > 0),
      similar: count((r) => r.s.length > 0),
      description: count((r) => !!r.p["properties.short_description"]?.some((c) => c.note?.includes("Wikipedia summary copied"))),
      image: count((r) => !!r.e.properties.image),
      popularity: count((r) => r.e.popularity !== undefined),
      lowConfidence: count((r) => r.low),
    },
    standInCalls: Number(proxy?.stand_in_calls ?? 0),
    cache: { hits: Number(proxy?.cache_hits ?? 0), of: Number(proxy?.cache_of ?? 0) },
    asks: { total: asks.length, qloo: asks.filter((a) => a.served_by === "qloo").length, notonq: asks.filter((a) => a.served_by && a.served_by !== "qloo").length, taste },
    apps,
    mostAsked: gaps
      .sort(([, a], [, b]) => b.searches - a.searches)
      .slice(0, 5)
      .map(([key, v]) => ({ nameKey: key, name: v.name, searches: v.searches })),
  };
}
