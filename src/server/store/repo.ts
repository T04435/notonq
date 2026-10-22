// Typed queries over the schema. Every function takes the Sql handle so tests run on an in-memory PGlite.
import type { FallbackEntity } from "@/server/engine/artist";
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

export async function findFallback(sql: Sql, by: { nameKey?: string; id?: string; qlooEntityId?: string; mbid?: string }) {
  const [col, val] = by.id
    ? ["id", by.id]
    : by.qlooEntityId
      ? ["qloo_entity_id", by.qlooEntityId]
      : by.mbid
        ? ["mbid", by.mbid.toLowerCase()]
        : ["name_key", by.nameKey];
  const rows = await sql(`SELECT * FROM fallback_entities WHERE ${col} = $1 LIMIT 1`, [val]);
  return rows[0] ? toFallback(rows[0]) : null;
}

export async function saveFallback(sql: Sql, f: Omit<StoredFallback, "createdAt" | "refreshedAt" | "resolvedByQlooAt">) {
  const rows = await sql(
    `INSERT INTO fallback_entities (id, name_key, name, mbid, qid, spotify_id, gap_kind, qloo_entity_id, entity, provenance, stand_ins, popularity, unavailable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (name_key) DO UPDATE SET
       id = EXCLUDED.id, name = EXCLUDED.name, mbid = EXCLUDED.mbid, qid = EXCLUDED.qid, spotify_id = EXCLUDED.spotify_id,
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
      JSON.stringify(f.entity),
      JSON.stringify(f.provenance),
      JSON.stringify(f.standIns),
      f.popularity ? JSON.stringify(f.popularity) : null,
      JSON.stringify(f.unavailable),
    ],
  );
  return toFallback(rows[0]);
}

export async function markResolvedByQloo(sql: Sql, id: string, qlooEntityId: string) {
  await sql(`UPDATE fallback_entities SET resolved_by_qloo_at = now(), qloo_entity_id = $2 WHERE id = $1`, [id, qlooEntityId]);
}

export type RequestLog = {
  nameKey: string;
  entityId?: string;
  endpoint: string;
  servedBy: "qloo" | "fallback" | "mixed";
  gapKind?: string;
  callerHash: string;
  appLabel?: string;
  cacheHit: boolean;
};

export async function logRequest(sql: Sql, r: RequestLog) {
  await sql(
    `INSERT INTO requests (name_key, entity_id, endpoint, served_by, gap_kind, caller_hash, app_label, cache_hit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [r.nameKey, r.entityId ?? null, r.endpoint, r.servedBy, r.gapKind ?? null, r.callerHash, r.appLabel ?? null, r.cacheHit],
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
  id: string;
  name: string;
  mbid?: string;
  qid?: string;
  spotifyId?: string;
  gapKind: string;
  qlooEntityId?: string;
  standIns: StandIn[];
  requests: number;
  callers: number;
  apps: number;
  lastRequested?: string;
  firstSeen: string;
  resolvedByQlooAt?: string;
};

/** The import queue: missing artists ranked by distinct callers, then requests, then recency. */
export async function importQueue(sql: Sql, limit = 50): Promise<QueueRow[]> {
  const rows = await sql(
    `SELECT * FROM import_queue ORDER BY resolved_by_qloo_at IS NOT NULL, callers DESC, requests DESC, last_requested DESC NULLS LAST LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    mbid: (r.mbid as string) ?? undefined,
    qid: (r.qid as string) ?? undefined,
    spotifyId: (r.spotify_id as string) ?? undefined,
    gapKind: String(r.gap_kind),
    qlooEntityId: (r.qloo_entity_id as string) ?? undefined,
    standIns: json(r.stand_ins, []),
    requests: Number(r.requests),
    callers: Number(r.callers),
    apps: Number(r.apps),
    lastRequested: iso(r.last_requested),
    firstSeen: iso(r.first_seen)!,
    resolvedByQlooAt: iso(r.resolved_by_qloo_at),
  }));
}

export async function totals(sql: Sql) {
  const [r] = await sql(
    `SELECT (SELECT count(*)::int FROM fallback_entities) AS entities,
            (SELECT count(*)::int FROM requests WHERE served_by <> 'qloo') AS gap_requests,
            (SELECT count(*)::int FROM requests WHERE served_by <> 'qloo' AND cache_hit) AS cache_hits,
            (SELECT count(DISTINCT caller_hash)::int FROM requests) AS callers`,
  );
  return { entities: Number(r.entities), gapRequests: Number(r.gap_requests), cacheHits: Number(r.cache_hits), callers: Number(r.callers) };
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
