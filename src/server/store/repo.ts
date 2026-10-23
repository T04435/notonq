// Typed queries over the schema. Every function takes the Sql handle so tests run on an in-memory PGlite.
import type { Confidence, FallbackEntity } from "@/server/engine/artist";
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
    confidence: (r.confidence as Confidence) ?? undefined,
    researchStatus: (r.research_status as StoredFallback["researchStatus"]) ?? undefined,
    researchAt: iso(r.research_at),
    entity: json(r.entity, null),
    provenance: json(r.provenance, {}),
    standIns: json(r.stand_ins, []),
    popularity: json(r.popularity, undefined),
    unavailable: json(r.unavailable, []),
    createdAt: iso(r.created_at)!,
    refreshedAt: iso(r.refreshed_at)!,
    resolvedByQlooAt: iso(r.resolved_by_qloo_at),
  };
}

export async function findFallback(sql: Sql, by: { nameKey?: string; id?: string; qlooEntityId?: string; mbid?: string; candidateKey?: string }) {
  const [col, val] = by.id
    ? ["id", by.id]
    : by.candidateKey
      ? ["candidate_key", by.candidateKey]
    : by.qlooEntityId
      ? ["qloo_entity_id", by.qlooEntityId]
      : by.mbid
        ? ["mbid", by.mbid.toLowerCase()]
        : ["name_key", by.nameKey];
  const rows = await sql(`SELECT * FROM fallback_entities WHERE ${col} = $1 ORDER BY refreshed_at DESC LIMIT 1`, [val]);
  return rows[0] ? toFallback(rows[0]) : null;
}

export async function saveFallback(sql: Sql, f: Omit<StoredFallback, "createdAt" | "refreshedAt" | "resolvedByQlooAt">) {
  const rows = await sql(
    `INSERT INTO fallback_entities (id, name_key, name, mbid, qid, spotify_id, gap_kind, qloo_entity_id, entity, provenance, stand_ins, popularity, unavailable, candidate_key, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (id) DO UPDATE SET
       name_key = EXCLUDED.name_key, name = EXCLUDED.name, candidate_key = EXCLUDED.candidate_key, confidence = EXCLUDED.confidence, mbid = EXCLUDED.mbid, qid = EXCLUDED.qid, spotify_id = EXCLUDED.spotify_id,
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
    ],
  );
  return toFallback(rows[0]);
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

/** The import queue: every name Qloo had a gap for, ranked by distinct callers, then requests, then recency, with
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

export async function totals(sql: Sql) {
  const [r] = await sql(
    `SELECT (SELECT count(DISTINCT name_key)::int FROM requests WHERE served_by <> 'qloo') AS entities,
            (SELECT count(*)::int FROM requests WHERE served_by <> 'qloo') AS gap_requests,
            (SELECT count(*)::int FROM requests WHERE served_by <> 'qloo' AND cache_hit) AS cache_hits,
            (SELECT count(DISTINCT caller_hash)::int FROM requests WHERE served_by <> 'qloo') AS callers`,
  );
  return { entities: Number(r.entities), gapRequests: Number(r.gap_requests), cacheHits: Number(r.cache_hits), callers: Number(r.callers) };
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
