// The service every door uses (playground, REST, MCP): look up an artist with the cache in front, record demand,
// and close the loop when Qloo finally knows an artist we were filling in.
import { createHash } from "node:crypto";
import { resolveArtist } from "@/server/engine/artist";
import type { Fetch } from "@/server/http";
import { entitiesOf, type QlooClient, type QlooEntity } from "@/server/qloo/client";
import { type Gap, nameKey } from "@/server/qloo/gap";
import type { Sql } from "@/server/store/db";
import { type Demand, demandFor, findFallback, logRequest, markResolvedByQloo, saveFallback, type StoredFallback } from "@/server/store/repo";

export type Ctx = {
  sql: Sql;
  qloo: QlooClient;
  lastfmKey?: string;
  callerHash: string;
  appLabel?: string;
  endpoint: string;
  fetch?: Fetch;
};

export type Lookup =
  | { servedBy: "qloo"; nameKey: string; entity: QlooEntity }
  | { servedBy: "fallback"; nameKey: string; cacheHit: boolean; gap: Pick<Gap, "kind"> & Partial<Gap>; fallback: StoredFallback; demand: Demand };

/** Fallback data is ours (open sources), so it is shared across callers; refreshed weekly. */
export const FALLBACK_TTL_MS = 7 * 24 * 3600 * 1000;

export const hashCaller = (key: string, salt: string) => createHash("sha256").update(`${salt}:${key}`).digest("hex").slice(0, 32);

export async function lookupArtist(name: string, ctx: Ctx): Promise<Lookup> {
  const key = nameKey(name);
  const cached = await findFallback(ctx.sql, { nameKey: key });
  const fresh = cached && !cached.resolvedByQlooAt && Date.now() - Date.parse(cached.refreshedAt) < FALLBACK_TTL_MS;

  if (cached && fresh) {
    await log(ctx, key, cached, true);
    return { servedBy: "fallback", nameKey: key, cacheHit: true, gap: { kind: cached.gapKind }, fallback: cached, demand: await demandFor(ctx.sql, key) };
  }

  const r = await resolveArtist(name, { qloo: ctx.qloo, lastfmKey: ctx.lastfmKey, fetch: ctx.fetch });
  if (r.servedBy === "qloo") {
    // Qloo now knows an artist we used to fill in: close the ticket and step aside.
    if (cached && !cached.resolvedByQlooAt) await markResolvedByQloo(ctx.sql, cached.id, r.entity.entity_id);
    await logRequest(ctx.sql, { nameKey: key, entityId: r.entity.entity_id, endpoint: ctx.endpoint, servedBy: "qloo", callerHash: ctx.callerHash, appLabel: ctx.appLabel, cacheHit: false });
    return { servedBy: "qloo", nameKey: key, entity: r.entity };
  }

  const stored = await saveFallback(ctx.sql, {
    id: r.entity?.entity_id ?? `notonq:name:${key.replace(/\s+/g, "-")}`,
    nameKey: key,
    name: r.entity?.name ?? name,
    mbid: r.entity?.properties.external.musicbrainz?.id,
    qid: r.entity?.properties.external.wikidata?.id,
    spotifyId: r.entity?.properties.external.spotify?.id,
    gapKind: r.gap.kind === "G2" ? "G2" : "G1",
    qlooEntityId: r.qlooEntity?.entity_id,
    entity: r.entity,
    provenance: r.provenance,
    standIns: r.standIns,
    popularity: r.popularity,
    unavailable: r.unavailable,
  });
  await log(ctx, key, stored, false);
  return { servedBy: "fallback", nameKey: key, cacheHit: false, gap: r.gap, fallback: stored, demand: await demandFor(ctx.sql, key) };
}

function log(ctx: Ctx, key: string, f: StoredFallback, cacheHit: boolean) {
  return logRequest(ctx.sql, {
    nameKey: key,
    entityId: f.id,
    endpoint: ctx.endpoint,
    servedBy: "fallback",
    gapKind: f.gapKind,
    callerHash: ctx.callerHash,
    appLabel: ctx.appLabel,
    cacheHit,
  });
}

/** For a G2 Qloo ID (Qloo finds it but can't use it): our fallback for it, building one from Qloo's own name if needed. */
export async function fallbackForQlooId(qlooId: string, ctx: Ctx): Promise<StoredFallback | null> {
  const known = await findFallback(ctx.sql, { qlooEntityId: qlooId });
  if (known) return known;
  const lookup = await ctx.qloo.get("/entities", { entity_ids: qlooId });
  const name = entitiesOf(lookup.json)[0]?.name;
  if (!name) return null;
  const r = await lookupArtist(name, ctx);
  return r.servedBy === "fallback" ? r.fallback : null;
}
