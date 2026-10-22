// The service every door uses (playground, REST, MCP): look up an artist with the cache in front, record demand,
// hand back candidates when the name is ambiguous, and close the loop when Qloo finally knows an artist we filled in.
import { createHash } from "node:crypto";
import { type ResolveOptions, resolveArtist } from "@/server/engine/artist";
import { type Candidate, idForKey, slug } from "@/server/engine/candidates";
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

type GapInfo = Pick<Gap, "kind"> & Partial<Gap>;

export type Lookup =
  | { servedBy: "qloo"; nameKey: string; entity: QlooEntity }
  | { servedBy: "needs_choice"; nameKey: string; gap: GapInfo; candidates: Candidate[]; demand: Demand }
  | { servedBy: "fallback"; nameKey: string; cacheHit: boolean; gap: GapInfo; fallback: StoredFallback; demand: Demand };

/** Fallback data is ours (open sources), so it is shared across callers. Filled entities refresh weekly; "nothing
 * found" is retried after a day, since small artists appear in sources all the time. */
export const FALLBACK_TTL_MS = 7 * 24 * 3600 * 1000;
export const EMPTY_TTL_MS = 24 * 3600 * 1000;

export const hashCaller = (key: string, salt: string) => createHash("sha256").update(`${salt}:${key}`).digest("hex").slice(0, 32);

const isFresh = (f: StoredFallback) => !f.resolvedByQlooAt && Date.now() - Date.parse(f.refreshedAt) < (f.entity ? FALLBACK_TTL_MS : EMPTY_TTL_MS);

export async function lookupArtist(name: string, ctx: Ctx, opts: ResolveOptions = {}): Promise<Lookup> {
  const key = nameKey(name);
  const cached = opts.candidateKey
    ? ((await findFallback(ctx.sql, { candidateKey: opts.candidateKey })) ?? (await findFallback(ctx.sql, { id: idForKey(opts.candidateKey) })))
    : opts.choose
      ? null
      : await findFallback(ctx.sql, { nameKey: key });

  if (cached && isFresh(cached)) {
    await log(ctx, name, key, cached, true);
    return { servedBy: "fallback", nameKey: key, cacheHit: true, gap: { kind: cached.gapKind }, fallback: cached, demand: await demandFor(ctx.sql, key) };
  }

  const r = await resolveArtist(name, { qloo: ctx.qloo, lastfmKey: ctx.lastfmKey, fetch: ctx.fetch }, opts);
  if (r.servedBy === "qloo") {
    // Qloo now knows an artist we used to fill in: close the ticket and step aside.
    if (cached && !cached.resolvedByQlooAt) await markResolvedByQloo(ctx.sql, cached.id, r.entity.entity_id);
    await logRequest(ctx.sql, { nameKey: key, query: name, entityId: r.entity.entity_id, endpoint: ctx.endpoint, servedBy: "qloo", callerHash: ctx.callerHash, appLabel: ctx.appLabel, cacheHit: false });
    return { servedBy: "qloo", nameKey: key, entity: r.entity };
  }

  if (r.servedBy === "needs_choice") {
    await logRequest(ctx.sql, { nameKey: key, query: name, endpoint: ctx.endpoint, servedBy: "needs_choice", gapKind: r.gap.kind, callerHash: ctx.callerHash, appLabel: ctx.appLabel, cacheHit: false });
    return { servedBy: "needs_choice", nameKey: key, gap: r.gap, candidates: r.candidates, demand: await demandFor(ctx.sql, key) };
  }

  const stored = await saveFallback(ctx.sql, {
    id: r.entity?.entity_id ?? `notonq:name:${slug(name)}`,
    nameKey: key,
    name: r.entity?.name ?? name,
    mbid: r.entity?.properties.external.musicbrainz?.id,
    qid: r.entity?.properties.external.wikidata?.id,
    spotifyId: r.entity?.properties.external.spotify?.id,
    gapKind: r.gap.kind === "G2" ? "G2" : "G1",
    qlooEntityId: r.qlooEntity?.entity_id,
    candidateKey: r.candidateKey,
    confidence: r.confidence,
    entity: r.entity,
    provenance: r.provenance,
    standIns: r.standIns,
    popularity: r.popularity,
    unavailable: r.unavailable,
  });
  await log(ctx, name, key, stored, false);
  return { servedBy: "fallback", nameKey: key, cacheHit: false, gap: r.gap, fallback: stored, demand: await demandFor(ctx.sql, key) };
}

function log(ctx: Ctx, query: string, key: string, f: StoredFallback, cacheHit: boolean) {
  return logRequest(ctx.sql, {
    nameKey: key,
    query,
    entityId: f.id,
    endpoint: ctx.endpoint,
    servedBy: "fallback",
    gapKind: f.gapKind,
    callerHash: ctx.callerHash,
    appLabel: ctx.appLabel,
    cacheHit,
  });
}

/** For a G2 Qloo ID (Qloo finds it but can't use it): our fallback for it, building one from Qloo's own name if needed.
 * Qloo's own record already pins down which artist it is, so an ambiguous name takes the best candidate. */
export async function fallbackForQlooId(qlooId: string, ctx: Ctx): Promise<StoredFallback | null> {
  const known = await findFallback(ctx.sql, { qlooEntityId: qlooId });
  if (known) return known;
  const lookup = await ctx.qloo.get("/entities", { entity_ids: qlooId });
  const name = entitiesOf(lookup.json)[0]?.name;
  if (!name) return null;
  const first = await lookupArtist(name, ctx);
  if (first.servedBy === "fallback") return first.fallback;
  if (first.servedBy === "needs_choice" && first.candidates[0]) {
    const picked = await lookupArtist(name, ctx, { candidateKey: first.candidates[0].key });
    return picked.servedBy === "fallback" ? picked.fallback : null;
  }
  return null;
}
