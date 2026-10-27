// Every number on /proof, counted from the runs in the Ledger: all apps alike (the benchmark batch is one of them), or
// one app when Proof is filtered. An artist counts once, by its latest artist search through /q.
import { FILL_QUESTIONS, type FillQuestion } from "@/lib/benchmark";
import type { FallbackEntity } from "@/server/engine/artist";
import type { ProvenanceMap } from "@/server/provenance";
import { nameKey } from "@/server/qloo/gap";
import type { Sql } from "@/server/store/db";

export type ArtistOutcome = "usable" | "G1" | "G2";
export type TasteQuestion = "similar" | "map" | "ages";

/** One Ask question about an artist (a FILL_QUESTIONS title), by its latest run. */
export type ArtistQuestion = { runId: string; answered: boolean };

/** One artist we filled in, as the Proof table shows it: its record's fields and the Ask questions about it. */
export type ProofArtist = {
  nameKey: string;
  name: string;
  lookups: number;
  gap: "G1" | "G2";
  lowConfidence: boolean;
  record: {
    home?: string;
    genres: string[];
    similar: string[];
    description: boolean;
    image: boolean;
    popularity?: number;
  };
  ask: Partial<Record<FillQuestion, ArtistQuestion>>;
};

export type ProofStats = {
  app?: string;
  /** The first artist lookup in scope: live counts start here (there is no time window). */
  since?: string;
  runs: number;
  /** Artist searches through /q in scope, every one counted. */
  lookups: number;
  /** Artists searched through /q, each by its latest search. */
  artists: { total: number; usable: number; G1: number; G2: number; ambiguous: number; gapPct: number };
  /** The records we filled in for those gap artists (each field has a source in its provenance). */
  filled: { artists: number; home: number; genres: number; similar: number; description: number; image: number; popularity: number; lowConfidence: number; citedFields: number; G1: number; G2: number };
  /** Research runs behind the filled-in records: claims checked against their sources. */
  research: { artists: number; verified: number; rejected: number };
  /** Insights calls Qloo answered for similar artists it knows, in place of an artist it has no taste data for. */
  standInCalls: number;
  /** Responses NotOnQ added to that came from its cache, of those that say. */
  cache: { hits: number; of: number };
  /** Ask questions: who answered, and taste questions NotOnQ's step got data for. */
  asks: { total: number; qloo: number; notonq: number; taste: Record<TasteQuestion, { asked: number; answered: number }> };
  apps: { app: string; runs: number; sharePct: number; lookups: number; artists: number; gapPct: number }[];
  /** The artists we filled in that callers searched for most. */
  mostAsked: { nameKey: string; name: string; searches: number }[];
  /** The artists we filled in, most looked up first (at most ARTIST_ROWS), and how many there are in all. */
  artistRows: ProofArtist[];
};

export const ARTIST_ROWS = 50;

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const parse = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : (v as T));
const ARTIST_SEARCH = `kind = 'api' AND title LIKE 'GET /q/search?%' AND coalesce(events->0->'params'->>'types', 'urn:entity:artist') LIKE '%urn:entity:artist%'`;

const TASTE_TOOL: Record<TasteQuestion, string> = { similar: "qloo_recommend", map: "qloo_where_popular", ages: "qloo_audience_demographics" };

export async function proofStats(sql: Sql, app?: string): Promise<ProofStats> {
  const scope = app ? `AND coalesce(app_label, 'unlabelled') = $1` : "";
  const args = app ? [app] : [];

  const [totals] = await sql(
    `SELECT count(*)::int AS runs, min(created_at) FILTER (WHERE ${ARTIST_SEARCH}) AS since, count(*) FILTER (WHERE ${ARTIST_SEARCH})::int AS lookups FROM runs WHERE true ${scope}`,
    args,
  );

  // Artists: the latest artist search for each name, and what it said.
  const searches = await sql(
    `SELECT coalesce(app_label, 'unlabelled') AS app, served_by, created_at,
            events->0->'params'->>'query' AS query,
            events->1->'body'->'notonq'->'gap'->>'kind' AS gap,
            events->1->'body'->'notonq'->>'served_by' AS answered_by
     FROM runs WHERE ${ARTIST_SEARCH} ${scope} ORDER BY created_at`,
    args,
  );
  type Seen = { name: string; outcome: ArtistOutcome; ambiguous: boolean; searches: number; apps: Set<string>; perApp: Map<string, number> };
  const byName = new Map<string, Seen>();
  for (const s of searches) {
    const name = String(s.query ?? "").replace(/\+/g, " ").trim();
    if (!name) continue;
    const key = nameKey(name);
    const ambiguous = s.answered_by === "needs_choice" || s.served_by === "needs_choice";
    const outcome: ArtistOutcome = s.gap === "G1" || s.gap === "G2" ? (s.gap as ArtistOutcome) : s.served_by === "qloo" ? "usable" : "G1";
    const prev = byName.get(key);
    const perApp = prev?.perApp ?? new Map<string, number>();
    perApp.set(String(s.app), (perApp.get(String(s.app)) ?? 0) + 1);
    byName.set(key, { name, outcome, ambiguous, searches: (prev?.searches ?? 0) + 1, apps: (prev?.apps ?? new Set()).add(String(s.app)), perApp });
  }
  const seen = [...byName.entries()];
  const gaps = seen.filter(([, v]) => v.outcome !== "usable");
  const n = (o: ArtistOutcome) => seen.filter(([, v]) => v.outcome === o).length;

  // The filled-in records behind the gap artists.
  const records = gaps.length
    ? await sql(
        `SELECT DISTINCT ON (name_key) id, name_key, name, entity, provenance, stand_ins, confidence FROM fallback_entities WHERE name_key = ANY($1) AND entity IS NOT NULL ORDER BY name_key, refreshed_at DESC`,
        [gaps.map(([k]) => k)],
      )
    : [];
  const recs = records.map((r) => ({
    id: String(r.id),
    key: String(r.name_key),
    name: String(r.name),
    e: parse<FallbackEntity>(r.entity),
    p: parse<ProvenanceMap>(r.provenance),
    s: parse<{ name: string }[]>(r.stand_ins),
    low: r.confidence === "low",
  }));
  const count = (f: (r: (typeof recs)[number]) => boolean) => recs.filter(f).length;

  const [proxy] = await sql(
    `SELECT count(*) FILTER (WHERE served_by = 'mixed' AND title LIKE 'GET /q/v2/insights%')::int AS stand_in_calls,
            count(*) FILTER (WHERE events->1->'body'->'notonq'->'cache'->>'hit' = 'true')::int AS cache_hits,
            count(*) FILTER (WHERE events->1->'body'->'notonq'->'cache' IS NOT NULL)::int AS cache_of
     FROM runs WHERE kind = 'api' ${scope}`,
    args,
  );

  // Research runs behind those records: each claim checked against its source.
  const [claims] = recs.length
    ? await sql(
        `SELECT count(DISTINCT entity_id)::int AS artists, count(*) FILTER (WHERE verified)::int AS verified, count(*) FILTER (WHERE NOT verified)::int AS rejected FROM research_claims WHERE entity_id = ANY($1)`,
        [recs.map((r) => r.id)],
      )
    : [{ artists: 0, verified: 0, rejected: 0 }];

  // Ask questions, and the calls NotOnQ's step made in each (Qloo's own step is left out).
  const asks = await sql(
    `SELECT id, title, served_by, created_at, (SELECT coalesce(jsonb_agg(jsonb_build_object('tool', e->>'tool', 'status', e->>'status', 'n', jsonb_array_length(coalesce(e->'results', '[]'::jsonb)))), '[]'::jsonb)
                        FROM jsonb_array_elements(events) e WHERE e->>'type' = 'call' AND e->>'stage' <> 'qloo') AS calls
     FROM runs WHERE kind = 'ask' ${scope} ORDER BY created_at`,
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
    const app = String(r.app);
    const mine = seen.filter(([, v]) => v.apps.has(app));
    return {
      app,
      runs: Number(r.runs),
      sharePct: pct(Number(r.runs), allRuns),
      lookups: mine.reduce((a, [, v]) => a + (v.perApp.get(app) ?? 0), 0),
      artists: mine.length,
      gapPct: pct(mine.filter(([, v]) => v.outcome !== "usable").length, mine.length),
    };
  });

  // Per artist we filled in: the record's fields, and the Ask questions about it (the fill questions, by title).
  const askByTitle = new Map<string, ArtistQuestion>();
  for (const a of asks) askByTitle.set(String(a.title).trim().toLowerCase(), { runId: String(a.id), answered: !!a.served_by });
  const recByKey = new Map(recs.map((r) => [r.key, r]));
  const artistRows: ProofArtist[] = gaps
    .filter(([key]) => recByKey.has(key))
    .sort(([ka, a], [kb, b]) => b.searches - a.searches || ka.localeCompare(kb))
    .slice(0, ARTIST_ROWS)
    .map(([key, v]) => {
      const r = recByKey.get(key)!;
      const names = [...new Set([r.name, v.name])];
      const ask = Object.fromEntries(
        (Object.keys(FILL_QUESTIONS) as FillQuestion[])
          .map((k) => [k, names.map((n) => askByTitle.get(FILL_QUESTIONS[k](n).toLowerCase())).find(Boolean)] as const)
          .filter(([, q]) => q),
      ) as ProofArtist["ask"];
      return {
        nameKey: key,
        name: r.name,
        lookups: v.searches,
        gap: v.outcome === "G2" ? "G2" : "G1",
        lowConfidence: r.low,
        record: {
          home: r.e.properties["notonq:home"]?.name,
          genres: r.e.tags.map((t) => t.name),
          similar: r.s.map((x) => x.name),
          description: hasDescription(r.p),
          image: !!r.e.properties.image,
          popularity: r.e.popularity,
        },
        ask,
      };
    });

  return {
    app,
    since: totals?.since ? new Date(totals.since as string).toISOString() : undefined,
    runs: Number(totals?.runs ?? 0),
    lookups: Number(totals?.lookups ?? 0),
    artists: { total: seen.length, usable: n("usable"), G1: n("G1"), G2: n("G2"), ambiguous: gaps.filter(([, v]) => v.ambiguous).length, gapPct: pct(gaps.length, seen.length) },
    filled: {
      artists: recs.length,
      home: count((r) => !!r.e.properties["notonq:home"]),
      genres: count((r) => r.e.tags.length > 0),
      similar: count((r) => r.s.length > 0),
      description: count((r) => hasDescription(r.p)),
      image: count((r) => !!r.e.properties.image),
      popularity: count((r) => r.e.popularity !== undefined),
      lowConfidence: count((r) => r.low),
      G1: count((r) => byName.get(r.key)?.outcome !== "G2"),
      G2: count((r) => byName.get(r.key)?.outcome === "G2"),
      citedFields: recs.length ? Math.round((recs.reduce((a, r) => a + Object.keys(r.p).length, 0) / recs.length) * 10) / 10 : 0,
    },
    research: { artists: Number(claims?.artists ?? 0), verified: Number(claims?.verified ?? 0), rejected: Number(claims?.rejected ?? 0) },
    standInCalls: Number(proxy?.stand_in_calls ?? 0),
    cache: { hits: Number(proxy?.cache_hits ?? 0), of: Number(proxy?.cache_of ?? 0) },
    asks: { total: asks.length, qloo: asks.filter((a) => a.served_by === "qloo").length, notonq: asks.filter((a) => a.served_by && a.served_by !== "qloo").length, taste },
    apps,
    mostAsked: gaps
      .sort(([, a], [, b]) => b.searches - a.searches)
      .slice(0, 5)
      .map(([key, v]) => ({ nameKey: key, name: v.name, searches: v.searches })),
    artistRows,
  };
}

/** A description we copied from Wikipedia (the label NotOnQ writes into every record doesn't count). */
const hasDescription = (p: ProvenanceMap) => !!p["properties.short_description"]?.some((c) => c.note?.includes("Wikipedia summary copied"));
