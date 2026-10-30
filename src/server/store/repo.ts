// Typed queries over the schema. Every function takes the Sql handle so tests run on an in-memory PGlite.
import { redactQlooIds } from "@/server/redact";
import { type Confidence, type FallbackEntity, withStandIns } from "@/server/engine/artist";
import type { PopularityFit } from "@/server/engine/popularity";
import type { StandIn } from "@/server/engine/standins";
import type { ProvenanceMap } from "@/server/provenance";
import type { Sql } from "@/server/store/db";

export type StoredFallback = {
  id: string;
  nameKey: string;
  name: string;
  mbid?: string;
  qid?: string;
  spotifyId?: string;
  gapKind: "G1" | "G2";
  qlooEntityId?: string;
  candidateKey?: string;
  /** Picked from candidates by someone: served for that ID, never as the default answer for the name. */
  chosen?: boolean;
  confidence?: Confidence;
  researchStatus?: "pending" | "done" | "failed" | "skipped";
  researchAt?: string;
  entity: FallbackEntity | null;
  provenance: ProvenanceMap;
  standIns: StandIn[];
  popularity?: PopularityFit;
  unavailable: string[];
  createdAt: string;
  refreshedAt: string;
  resolvedByQlooAt?: string;
};

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : undefined);
const json = <T>(v: unknown, fallback: T): T => (v === null || v === undefined ? fallback : typeof v === "string" ? JSON.parse(v) : (v as T));

function toFallback(r: Row): StoredFallback {
  const standIns = json<StandIn[]>(r.stand_ins, []);
  const entity = json<FallbackEntity | null>(r.entity, null);
  return {
    id: String(r.id),
    nameKey: String(r.name_key),
    name: String(r.name),
    mbid: (r.mbid as string) ?? undefined,
    qid: (r.qid as string) ?? undefined,
    spotifyId: (r.spotify_id as string) ?? undefined,
    gapKind: r.gap_kind as "G1" | "G2",
    qlooEntityId: (r.qloo_entity_id as string) ?? undefined,
    candidateKey: (r.candidate_key as string) ?? undefined,
    chosen: r.chosen === true,
    confidence: (r.confidence as Confidence) ?? undefined,
    researchStatus: (r.research_status as StoredFallback["researchStatus"]) ?? undefined,
    researchAt: iso(r.research_at),
    entity: entity && withStandIns(entity, standIns),
    provenance: json(r.provenance, {}),
    standIns,
    popularity: json(r.popularity, undefined),
    unavailable: json(r.unavailable, []),
    createdAt: iso(r.created_at)!,
    refreshedAt: iso(r.refreshed_at)!,
    resolvedByQlooAt: iso(r.resolved_by_qloo_at),
  };
}

export async function findFallback(sql: Sql, by: { nameKey?: string; id?: string; qlooEntityId?: string; mbid?: string; candidateKey?: string; spotifyId?: string }) {
  const [col, val] = by.id
    ? ["id", by.id]
    : by.spotifyId
      ? ["spotify_id", by.spotifyId]
    : by.candidateKey
      ? ["candidate_key", by.candidateKey]
    : by.qlooEntityId
      ? ["qloo_entity_id", by.qlooEntityId]
      : by.mbid
        ? ["mbid", by.mbid.toLowerCase()]
        : ["name_key", by.nameKey];
  const onlyDefault = col === "name_key" ? " AND NOT chosen" : "";
  const rows = await sql(`SELECT * FROM fallback_entities WHERE ${col} = $1${onlyDefault} ORDER BY refreshed_at DESC LIMIT 1`, [val]);
  return rows[0] ? toFallback(rows[0]) : null;
}

/** Records the Spotify ID an app asked for on a fill (found through MusicBrainz or by name), in the column and in the
 * entity's own external IDs, so the next /entities?external.spotify.ids= lookup is one query. */
export async function linkSpotify(sql: Sql, id: string, spotifyId: string) {
  await sql(
    `UPDATE fallback_entities SET spotify_id = $2,
       entity = CASE WHEN entity IS NULL THEN NULL ELSE jsonb_set(entity, '{properties,external,spotify}', jsonb_build_object('id', $2::text)) END
     WHERE id = $1`,
    [id, spotifyId],
  );
}

export async function saveFallback(sql: Sql, f: Omit<StoredFallback, "createdAt" | "refreshedAt" | "resolvedByQlooAt">) {
  const rows = await sql(
    `INSERT INTO fallback_entities (id, name_key, name, mbid, qid, spotify_id, gap_kind, qloo_entity_id, entity, provenance, stand_ins, popularity, unavailable, candidate_key, confidence, chosen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET
       name_key = EXCLUDED.name_key, name = EXCLUDED.name, candidate_key = EXCLUDED.candidate_key, chosen = fallback_entities.chosen AND EXCLUDED.chosen, confidence = EXCLUDED.confidence, mbid = EXCLUDED.mbid, qid = EXCLUDED.qid, spotify_id = EXCLUDED.spotify_id,
       gap_kind = EXCLUDED.gap_kind, qloo_entity_id = EXCLUDED.qloo_entity_id, entity = EXCLUDED.entity,
       provenance = EXCLUDED.provenance, stand_ins = EXCLUDED.stand_ins, popularity = EXCLUDED.popularity,
       unavailable = EXCLUDED.unavailable, refreshed_at = now()
     RETURNING *`,
    [
      f.id,
      f.nameKey,
      f.name,
      f.mbid?.toLowerCase() ?? null,
      f.qid ?? null,
      f.spotifyId ?? null,
      f.gapKind,
      f.qlooEntityId ?? null,
      f.entity ? JSON.stringify(f.entity) : null,
      JSON.stringify(f.provenance),
      JSON.stringify(f.standIns),
      f.popularity ? JSON.stringify(f.popularity) : null,
      JSON.stringify(f.unavailable),
      f.candidateKey ?? null,
      f.confidence ?? null,
      f.chosen ?? false,
    ],
  );
  return toFallback(rows[0]);
}

export async function saveCandidateRefs(sql: Sql, refs: { id: string; key: string; name: string }[]) {
  for (const r of refs)
    await sql(`INSERT INTO candidate_refs (id, key, name) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, name = EXCLUDED.name`, [r.id, r.key, r.name]);
}

export type OurId = { fill: StoredFallback } | { candidate: { key: string; name: string } };

/** Which of these IDs are NotOnQ's: a fill we hold, or a candidate we offered and haven't filled yet. */
export async function findOurIds(sql: Sql, ids: string[]): Promise<Map<string, OurId>> {
  const out = new Map<string, OurId>();
  if (!ids.length) return out;
  const lower = ids.map((i) => i.toLowerCase());
  const at = (id: string) => ids[lower.indexOf(id.toLowerCase())];
  for (const row of await sql(`SELECT DISTINCT ON (id) * FROM fallback_entities WHERE lower(id) = ANY($1) ORDER BY id, refreshed_at DESC`, [lower]))
    out.set(at(String(row.id)), { fill: toFallback(row) });
  for (const row of await sql(`SELECT id, key, name FROM candidate_refs WHERE lower(id) = ANY($1)`, [lower]))
    if (!out.has(at(String(row.id)))) out.set(at(String(row.id)), { candidate: { key: String(row.key), name: String(row.name) } });
  return out;
}

export async function updateFill(
  sql: Sql,
  id: string,
  u: Pick<StoredFallback, "entity" | "provenance" | "standIns" | "unavailable"> & { researchStatus: NonNullable<StoredFallback["researchStatus"]> },
) {
  await sql(
    `UPDATE fallback_entities SET entity = $2, provenance = $3, stand_ins = $4, unavailable = $5, research_status = $6, research_at = now() WHERE id = $1`,
    [id, u.entity ? JSON.stringify(u.entity) : null, JSON.stringify(u.provenance), JSON.stringify(u.standIns), JSON.stringify(u.unavailable), u.researchStatus],
  );
}

/** Claim the research slot for an entity (only one run at a time); false if another run already holds it. */
export async function startResearch(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql(`UPDATE fallback_entities SET research_status = 'pending', research_at = now() WHERE id = $1 AND research_status IS NULL RETURNING id`, [id]);
  return rows.length > 0;
}

export async function setResearchStatus(sql: Sql, id: string, status: NonNullable<StoredFallback["researchStatus"]>) {
  await sql(`UPDATE fallback_entities SET research_status = $2, research_at = now() WHERE id = $1`, [id, status]);
}

export async function researchRunsToday(sql: Sql): Promise<number> {
  const [r] = await sql(`SELECT count(*)::int AS n FROM fallback_entities WHERE research_at > now() - interval '1 day' AND research_status IN ('pending','done','failed')`);
  return Number(r?.n ?? 0);
}

export type StoredClaim = { field: string; value: string; sourceUrl: string; quote: string; verified: boolean; confidence?: string; reason?: string };

export async function saveClaims(sql: Sql, entityId: string, claims: StoredClaim[]) {
  for (const c of claims)
    await sql(`INSERT INTO research_claims (entity_id, field, value, source_url, quote, verified, confidence, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
      entityId,
      c.field,
      c.value,
      c.sourceUrl,
      c.quote,
      c.verified,
      c.confidence ?? null,
      c.reason ?? null,
    ]);
}

export async function claimsFor(sql: Sql, entityId: string): Promise<StoredClaim[]> {
  const rows = await sql(`SELECT * FROM research_claims WHERE entity_id = $1 ORDER BY verified DESC, id`, [entityId]);
  return rows.map((r) => ({
    field: String(r.field),
    value: String(r.value),
    sourceUrl: String(r.source_url),
    quote: String(r.quote),
    verified: Boolean(r.verified),
    confidence: (r.confidence as string) ?? undefined,
    reason: (r.reason as string) ?? undefined,
  }));
}

export async function markResolvedByQloo(sql: Sql, id: string, qlooEntityId: string) {
  await sql(`UPDATE fallback_entities SET resolved_by_qloo_at = now(), qloo_entity_id = $2 WHERE id = $1`, [id, qlooEntityId]);
}

export type RequestLog = {
  nameKey: string;
  query?: string;
  entityId?: string;
  endpoint: string;
  servedBy: "qloo" | "fallback" | "mixed" | "needs_choice";
  gapKind?: string;
  callerHash: string;
  appLabel?: string;
  cacheHit: boolean;
};

export async function logRequest(sql: Sql, r: RequestLog) {
  await sql(
    `INSERT INTO requests (name_key, query, entity_id, endpoint, served_by, gap_kind, caller_hash, app_label, cache_hit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [r.nameKey, r.query ?? null, r.entityId ?? null, r.endpoint, r.servedBy, r.gapKind ?? null, r.callerHash, r.appLabel ?? null, r.cacheHit],
  );
}

export type Demand = { requests: number; callers: number; apps: number };

export async function demandFor(sql: Sql, nameKey: string): Promise<Demand> {
  const [r] = await sql(
    `SELECT count(*)::int AS requests, count(DISTINCT caller_hash)::int AS callers, count(DISTINCT app_label)::int AS apps
     FROM requests WHERE name_key = $1 AND served_by <> 'qloo'`,
    [nameKey],
  );
  return { requests: Number(r?.requests ?? 0), callers: Number(r?.callers ?? 0), apps: Number(r?.apps ?? 0) };
}

export type QueueRow = {
  nameKey: string;
  query: string;
  name?: string;
  entityId?: string;
  mbid?: string;
  qid?: string;
  spotifyId?: string;
  confidence?: Confidence;
  gapKind?: string;
  standIns: StandIn[];
  requests: number;
  callers: number;
  apps: number;
  askedToChoose: boolean;
  lastRequested?: string;
  firstSeen: string;
  resolvedByQlooAt?: string;
};

/** The Ledger: every name Qloo had a gap for, ranked by distinct callers, then requests, then recency, with
 * the entity NotOnQ filled for it (if any). Names nobody could fill are kept: demand without data is the point. */
export async function importQueue(sql: Sql, limit = 50): Promise<QueueRow[]> {
  const rows = await sql(
    `SELECT q.*, f.name, f.mbid, f.qid, f.spotify_id, f.confidence, f.stand_ins, f.resolved_by_qloo_at, f.entity IS NOT NULL AS filled
     FROM import_queue q LEFT JOIN fallback_entities f ON f.id = q.entity_id
     ORDER BY f.resolved_by_qloo_at IS NOT NULL, q.callers DESC, q.requests DESC, q.last_requested DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    nameKey: String(r.name_key),
    query: String(r.query ?? r.name_key),
    name: r.filled ? ((r.name as string) ?? undefined) : undefined,
    entityId: r.filled ? ((r.entity_id as string) ?? undefined) : undefined,
    mbid: (r.mbid as string) ?? undefined,
    qid: (r.qid as string) ?? undefined,
    spotifyId: (r.spotify_id as string) ?? undefined,
    confidence: (r.confidence as Confidence) ?? undefined,
    gapKind: (r.gap_kind as string) ?? undefined,
    standIns: json(r.stand_ins, []),
    requests: Number(r.requests),
    callers: Number(r.callers),
    apps: Number(r.apps),
    askedToChoose: Boolean(r.asked_to_choose),
    lastRequested: iso(r.last_requested),
    firstSeen: iso(r.first_seen)!,
    resolvedByQlooAt: iso(r.resolved_by_qloo_at),
  }));
}

export type Answer = "notonq" | "qloo" | "choice" | "none";

export type LedgerRow = {
  nameKey: string;
  name: string;
  answer: Answer;
  entityId?: string;
  confidence?: Confidence;
  standIns: StandIn[];
  requests: number;
  callers: number;
  apps: string[];
  lastRequested: string;
  resolvedByQlooAt?: string;
  /** Position in the filtered list, in the order asked for (1 = first). */
  rank: number;
};

/** The Ledger: every artist looked up through NotOnQ (any door) and how its latest lookup was answered: by NotOnQ,
 * by Qloo, waiting for someone to choose which artist, or nothing found yet. Newest first. */
export type ArtistFilters = {
  app?: string[];
  result?: Answer;
  q?: string;
  /** recent: latest lookup first, paged by "<lastRequested>~<nameKey>"; asked: most lookups first, paged by "<lookups>~<nameKey>". */
  order?: "recent" | "asked";
  before?: string;
  limit?: number;
};

/** Artists looked up, newest first, filtered as the Ledger's URL says; total is the count before paging. */
export async function ledger(sql: Sql, f: ArtistFilters = {}): Promise<LedgerRow[] & { total?: number; filled?: number }> {
  const args: unknown[] = [];
  const arg = (v: unknown) => `$${args.push(v)}`;
  const where: string[] = [];
  if (f.app?.length) where.push(`a.apps && ${arg(f.app)}::text[]`);
  if (f.result === "qloo") where.push(`l.outcome = 'qloo'`);
  if (f.result === "choice") where.push(`l.outcome = 'needs_choice'`);
  if (f.result === "notonq") where.push(`l.outcome = 'fallback' AND f.entity IS NOT NULL`);
  if (f.result === "none") where.push(`l.outcome = 'fallback' AND f.entity IS NULL`);
  if (f.q) where.push(`(a.name_key ILIKE ${arg(`%${f.q}%`)} OR f.name ILIKE ${arg(`%${f.q}%`)} OR l.query ILIKE ${arg(`%${f.q}%`)})`);
  const all = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await sql(
    `WITH lk AS (
       SELECT * FROM requests WHERE served_by IN ('qloo', 'fallback', 'needs_choice', 'mixed')
     ), latest AS (
       SELECT DISTINCT ON (name_key) name_key, served_by AS outcome, entity_id, query
       FROM lk WHERE served_by IN ('qloo', 'fallback', 'needs_choice') ORDER BY name_key, created_at DESC
     ), agg AS (
       SELECT name_key, count(*)::int AS requests, count(DISTINCT caller_hash)::int AS callers,
              array_agg(DISTINCT coalesce(app_label, 'unlabelled')) AS apps, max(created_at) AS last
       FROM lk GROUP BY name_key
     )
     SELECT a.*, l.outcome, l.entity_id, l.query, f.name, f.confidence, f.stand_ins, f.resolved_by_qloo_at, f.entity IS NOT NULL AS filled,
            count(*) OVER ()::int AS total,
            count(*) FILTER (WHERE l.outcome = 'fallback' AND f.entity IS NOT NULL) OVER ()::int AS filled_total
     FROM agg a JOIN latest l USING (name_key) LEFT JOIN fallback_entities f ON f.id = l.entity_id
     ${all}
     ORDER BY ${f.order === "asked" ? "a.requests DESC, a.name_key ASC" : "a.last DESC, a.name_key DESC"}`,
    args,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  const filled = rows.length ? Number(rows[0].filled_total) : 0;
  // Paging after the count, so the total is the filtered total whatever page this is.
  const [bAt, bKey] = f.before?.split("~") ?? [];
  const after =
    f.order === "asked"
      ? (r: Record<string, unknown>) => Number(r.requests) < Number(bAt) || (Number(r.requests) === Number(bAt) && String(r.name_key) > bKey)
      : (r: Record<string, unknown>) => iso(r.last)! < bAt || (iso(r.last) === bAt && String(r.name_key) < bKey);
  const paged = (bAt ? rows.filter(after) : rows).slice(0, f.limit ?? 50);
  const out = paged.map((r) => {
    const outcome = String(r.outcome);
    const answer: Answer = outcome === "qloo" ? "qloo" : outcome === "needs_choice" ? "choice" : r.filled ? "notonq" : "none";
    return {
      nameKey: String(r.name_key),
      name: (answer === "notonq" ? (r.name as string) : undefined) ?? String(r.query ?? r.name_key),
      answer,
      entityId: answer === "notonq" ? ((r.entity_id as string) ?? undefined) : undefined,
      confidence: (r.confidence as Confidence) ?? undefined,
      standIns: answer === "notonq" ? json(r.stand_ins, []) : [],
      requests: Number(r.requests),
      callers: Number(r.callers),
      apps: (Array.isArray(r.apps) ? r.apps : json<string[]>(r.apps, [])).map(String),
      lastRequested: iso(r.last)!,
      resolvedByQlooAt: iso(r.resolved_by_qloo_at),
      rank: rows.indexOf(r) + 1,
    };
  });
  return Object.assign(out, { total, filled });
}

/** The cursor for the page after this row, in the order the rows were listed. */
export const artistCursor = (r: Pick<LedgerRow, "requests" | "lastRequested" | "nameKey">, order: ArtistFilters["order"] = "recent") =>
  order === "asked" ? `${r.requests}~${r.nameKey}` : `${r.lastRequested}~${r.nameKey}`;

export async function totals(sql: Sql) {
  const [r] = await sql(
    `SELECT (SELECT count(DISTINCT name_key)::int FROM requests WHERE served_by <> 'qloo') AS entities,
            (SELECT count(*)::int FROM requests WHERE served_by <> 'qloo') AS gap_requests,
            (SELECT count(*)::int FROM requests WHERE served_by <> 'qloo' AND cache_hit) AS cache_hits,
            (SELECT count(DISTINCT caller_hash)::int FROM requests WHERE served_by <> 'qloo') AS callers`,
  );
  return { entities: Number(r.entities), gapRequests: Number(r.gap_requests), cacheHits: Number(r.cache_hits), callers: Number(r.callers) };
}

/** Where one artist's demand came from: lookups per app, plus the name as last typed. */
export async function demandByApp(sql: Sql, nameKey: string) {
  const rows = await sql(
    `SELECT coalesce(app_label, 'unlabelled') AS app, count(*)::int AS requests, count(DISTINCT caller_hash)::int AS callers, max(created_at) AS last
     FROM requests WHERE name_key = $1 GROUP BY 1 ORDER BY 2 DESC`,
    [nameKey],
  );
  const [q] = await sql(`SELECT query FROM requests WHERE name_key = $1 AND query IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [nameKey]);
  const [o] = await sql(
    `SELECT served_by FROM requests WHERE name_key = $1 AND served_by IN ('qloo', 'fallback', 'needs_choice') ORDER BY created_at DESC LIMIT 1`,
    [nameKey],
  );
  return {
    query: (q?.query as string) ?? nameKey,
    latest: (o?.served_by as string) ?? undefined,
    apps: rows.map((r) => ({ app: String(r.app), requests: Number(r.requests), callers: Number(r.callers), last: iso(r.last) })),
  };
}

/** Real Qloo calls made today for one caller (cache hits don't count). */
export async function qlooCallsToday(sql: Sql, callerHash: string): Promise<number> {
  const [r] = await sql(`SELECT calls FROM qloo_usage WHERE caller_hash = $1 AND day = current_date`, [callerHash]);
  return Number(r?.calls ?? 0);
}

export async function countQlooCall(sql: Sql, callerHash: string) {
  await sql(
    `INSERT INTO qloo_usage (caller_hash, day, calls) VALUES ($1, current_date, 1)
     ON CONFLICT (caller_hash, day) DO UPDATE SET calls = qloo_usage.calls + 1`,
    [callerHash],
  );
}

export async function qlooCacheGet(sql: Sql, callerHash: string, reqHash: string) {
  const [r] = await sql(`SELECT status, body FROM qloo_cache WHERE caller_hash = $1 AND req_hash = $2 AND expires_at > now()`, [callerHash, reqHash]);
  return r ? { status: Number(r.status), body: json<unknown>(r.body, null) } : null;
}

export async function qlooCachePut(sql: Sql, callerHash: string, reqHash: string, status: number, body: unknown, ttlHours = 24) {
  await sql(
    `INSERT INTO qloo_cache (caller_hash, req_hash, status, body, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)
     ON CONFLICT (caller_hash, req_hash) DO UPDATE SET status = EXCLUDED.status, body = EXCLUDED.body, expires_at = EXCLUDED.expires_at`,
    [callerHash, reqHash, status, JSON.stringify(body), String(ttlHours)],
  );
}

export async function findShapeFill<T>(sql: Sql, key: string, maxAgeMs: number): Promise<T | null> {
  const [r] = await sql(`SELECT body, refreshed_at FROM shape_fills WHERE key = $1`, [key]);
  if (!r || Date.now() - Date.parse(String(iso(r.refreshed_at))) > maxAgeMs) return null;
  return json<T | null>(r.body, null);
}

export async function saveShapeFill(sql: Sql, key: string, body: unknown) {
  await sql(`INSERT INTO shape_fills (key, body) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, refreshed_at = now()`, [key, JSON.stringify(body)]);
}

/** One recorded step of a run, at `t` ms after it started. */
export type RunEvent = { t: number } & Record<string, unknown>;
export type Run = { id: string; kind: "ask" | "api"; title: string; summary?: string; servedBy?: string; appLabel?: string; ms?: number; createdAt: string; events: RunEvent[] };

/** NotOnQ added or swapped data in this call (an API call it filled, picked, matched or proxied; an Ask answer not
 * simply Qloo's). */
export const isHelped = (kind: Run["kind"], servedBy?: string) =>
  kind === "api" ? servedBy === "fallback" || servedBy === "mixed" || servedBy === "needs_choice" : !!servedBy && servedBy !== "qloo";

/** Window in which calls from one app and caller count as one visit (when they send no X-NotOnQ-Trace). */
export const VISIT_GAP = "2 minutes";

/** Records a run in its visit: the open visit for this app and caller (or trace), else a new one. Returns the visit. */
export async function saveRun(sql: Sql, r: Omit<Run, "createdAt"> & { callerHash: string; trace?: string; subject?: string }) {
  const helped = isHelped(r.kind, r.servedBy);
  const { createHash } = await import("node:crypto");
  const traced = r.trace ? `v-${createHash("sha256").update(`${r.appLabel ?? ""}|${r.callerHash}|${r.trace}`).digest("hex").slice(0, 32)}` : null;
  const [v] = await sql<{ id: string }>(
    `WITH open AS (
       SELECT id FROM visits
       WHERE $1 <> 'ask' AND $4::text IS NULL AND kind = $1 AND app_label IS NOT DISTINCT FROM $2 AND caller_hash = $3 AND trace IS NULL
         AND last_at > now() - interval '${VISIT_GAP}'
       ORDER BY last_at DESC LIMIT 1
     )
     INSERT INTO visits (id, kind, app_label, caller_hash, trace, subject, title, calls, helped)
     VALUES (coalesce($5, (SELECT id FROM open), $6), $1, $2, $3, $4, $7, $8, 1, $9)
     ON CONFLICT (id) DO UPDATE SET calls = visits.calls + 1, helped = visits.helped + EXCLUDED.helped, last_at = now(),
       subject = coalesce(visits.subject, EXCLUDED.subject)
     RETURNING id`,
    [r.kind, r.appLabel ?? null, r.callerHash, r.trace ?? null, traced, crypto.randomUUID(), r.subject?.replace(/\+/g, " ").trim().slice(0, 200) || null, r.title.slice(0, 500), helped ? 1 : 0],
  );
  await sql(
    `INSERT INTO runs (id, kind, title, summary, served_by, app_label, caller_hash, events, ms, visit_id, helped) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
    [r.id, r.kind, r.title.slice(0, 500), r.summary ?? null, r.servedBy ?? null, r.appLabel ?? null, r.callerHash, JSON.stringify(r.events), r.ms ?? null, v.id, helped],
  );
  return v.id;
}

// Qloo entity IDs in a call's request line and params (signal.interests.entities=…) are Qloo's data too: redacted on
// read, so runs stored before this are covered as well.
const toRun = (r: Row, withEvents: boolean): Run => ({
  id: String(r.id),
  kind: r.kind as Run["kind"],
  title: redactQlooIds(String(r.title)),
  summary: (r.summary as string) ?? undefined,
  servedBy: (r.served_by as string) ?? undefined,
  appLabel: (r.app_label as string) ?? undefined,
  ms: r.ms === null || r.ms === undefined ? undefined : Number(r.ms),
  createdAt: iso(r.created_at)!,
  events: withEvents ? redactQlooIds(json(r.events, [])) : [],
});

export async function listRuns(sql: Sql, limit = 200): Promise<Run[]> {
  const rows = await sql(`SELECT id, kind, title, summary, served_by, app_label, ms, created_at FROM runs ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map((r) => toRun(r, false));
}

export async function getRun(sql: Sql, id: string): Promise<Run | null> {
  const [r] = await sql(`SELECT * FROM runs WHERE id = $1`, [id]);
  return r ? toRun(r, true) : null;
}
