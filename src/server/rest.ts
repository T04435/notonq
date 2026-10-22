// Drop-in REST: the same paths and parameters as Qloo under /q/*. Qloo answers first, with the caller's own key; the
// fallback is added beside Qloo's response only where Qloo had a gap. Anything NotOnQ doesn't handle passes through.
import type { Fetch } from "@/server/http";
import { ARTIST, entitiesOf, qlooClient, qlooMessage } from "@/server/qloo/client";
import { cachedQloo } from "@/server/qloo/cached";
import { readInsights, readSearch } from "@/server/qloo/gap";
import { blockFor, fallbackBlock, standInsOf } from "@/server/respond";
import type { Sql } from "@/server/store/db";
import { demandFor, findFallback, logRequest, type StoredFallback } from "@/server/store/repo";
import { type Ctx, fallbackForQlooId, hashCaller, lookupArtist } from "@/server/service";

export type RestRequest = {
  path: string;
  params: Record<string, string>;
  apiKey?: string;
  lastfmKey?: string;
  appLabel?: string;
};

export type RestDeps = { sql: Sql; baseUrl: string; salt: string; fetch?: Fetch };
export type RestResponse = { status: number; body: unknown; servedBy: "qloo" | "fallback" | "mixed" };

const NOTONQ_ID = /^notonq:/;

export async function handleRest(req: RestRequest, deps: RestDeps): Promise<RestResponse> {
  if (!req.apiKey) return { status: 401, body: { message: "No API key found in request" }, servedBy: "qloo" };
  const callerHash = hashCaller(req.apiKey, deps.salt);
  const qloo = cachedQloo(qlooClient({ apiKey: req.apiKey, baseUrl: deps.baseUrl, fetch: deps.fetch }), deps.sql, callerHash);
  const ctx: Ctx = { sql: deps.sql, qloo, lastfmKey: req.lastfmKey, callerHash, appLabel: req.appLabel, endpoint: `/${req.path}`, fetch: deps.fetch };
  const path = req.path.replace(/^\/+|\/+$/g, "");

  if (path === "search" && req.params.query && isArtistOnly(req.params.types)) return search(req, ctx);
  if (path === "entities" && (req.params.entity_ids ?? "").split(",").some((id) => NOTONQ_ID.test(id))) return entities(req, ctx);
  if (path === "v2/insights") return insights(req, ctx);

  const res = await qloo.get(`/${path}`, req.params);
  return { status: res.status || 502, body: res.json, servedBy: "qloo" };
}

const isArtistOnly = (types?: string) => !!types && types.split(",").every((t) => t.trim() === ARTIST);

async function search(req: RestRequest, ctx: Ctx): Promise<RestResponse> {
  const res = await ctx.qloo.get("/search", req.params);
  const outcome = res.status === 404 || res.ok ? readSearch(req.params.query, res) : null;
  if (!outcome || "found" in outcome) return { status: res.status || 502, body: res.json, servedBy: "qloo" };

  const l = await lookupArtist(req.params.query, ctx);
  if (l.servedBy === "qloo") return { status: res.status, body: res.json, servedBy: "qloo" };
  const qlooResults = res.ok ? entitiesOf(res.json) : [];
  const base = res.ok && res.json && typeof res.json === "object" ? (res.json as Record<string, unknown>) : { success: true };
  return {
    status: l.fallback.entity ? 200 : res.status,
    body: {
      ...base,
      results: [...(l.fallback.entity ? [l.fallback.entity] : []), ...qlooResults],
      notonq: { ...blockFor(l), served_by: qlooResults.length ? "mixed" : "fallback" },
    },
    servedBy: qlooResults.length ? "mixed" : "fallback",
  };
}

async function entities(req: RestRequest, ctx: Ctx): Promise<RestResponse> {
  const ids = req.params.entity_ids.split(",").map((s) => s.trim());
  const ours = ids.filter((id) => NOTONQ_ID.test(id));
  const theirs = ids.filter((id) => !NOTONQ_ID.test(id));
  const res = theirs.length ? await ctx.qloo.get("/entities", { ...req.params, entity_ids: theirs.join(",") }) : null;
  const found: StoredFallback[] = [];
  for (const id of ours) {
    const f = await findFallback(ctx.sql, { id });
    if (f) {
      found.push(f);
      await logRequest(ctx.sql, { nameKey: f.nameKey, entityId: f.id, endpoint: ctx.endpoint, servedBy: "fallback", gapKind: f.gapKind, callerHash: ctx.callerHash, appLabel: ctx.appLabel, cacheHit: true });
    }
  }
  const results = [...found.flatMap((f) => (f.entity ? [f.entity] : [])), ...(res ? entitiesOf(res.json) : [])];
  const notonq = Object.fromEntries(await Promise.all(found.map(async (f) => [f.id, fallbackBlock(f, await demandFor(ctx.sql, f.nameKey), { hit: true })])));
  return { status: results.length ? 200 : 404, body: { success: results.length > 0, results, notonq }, servedBy: theirs.length ? "mixed" : "fallback" };
}

async function insights(req: RestRequest, ctx: Ctx): Promise<RestResponse> {
  const signal = (req.params["signal.interests.entities"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const replaced = new Map<string, StoredFallback>();

  // notonq: IDs never reach Qloo: swap them for their stand-ins up front.
  for (const id of signal.filter((s) => NOTONQ_ID.test(s))) {
    const f = await findFallback(ctx.sql, { id });
    if (f) replaced.set(id, f);
  }
  let params = withSignal(req.params, signal, replaced);
  let res = await ctx.qloo.get("/v2/insights", params);

  // G2: Qloo knows these IDs but can't use them. Swap each for its stand-ins and ask once more.
  if (res.status === 400 && readInsightsSafe(res)) {
    for (const id of signal.filter((s) => !NOTONQ_ID.test(s) && !replaced.has(s))) {
      const f = await fallbackForQlooId(id, ctx);
      if (f?.standIns.length) replaced.set(id, f);
    }
    params = withSignal(req.params, signal, replaced);
    res = await ctx.qloo.get("/v2/insights", params);
  }

  if (!replaced.size) return { status: res.status || 502, body: res.json, servedBy: "qloo" };
  for (const f of replaced.values())
    await logRequest(ctx.sql, { nameKey: f.nameKey, entityId: f.id, endpoint: ctx.endpoint, servedBy: "mixed", gapKind: f.gapKind, callerHash: ctx.callerHash, appLabel: ctx.appLabel, cacheHit: true });
  const body = res.json && typeof res.json === "object" ? (res.json as Record<string, unknown>) : { message: qlooMessage(res.json) };
  return {
    status: res.status || 502,
    body: {
      ...body,
      notonq: {
        served_by: "mixed",
        proxy: {
          replaced: [...replaced.keys()],
          stand_ins: [...replaced.values()].flatMap(standInsOf),
        },
        note: "Results are Qloo's answer for the stand-ins listed, used in place of artists Qloo has no taste data for.",
      },
    },
    servedBy: "mixed",
  };
}

function withSignal(params: Record<string, string>, signal: string[], replaced: Map<string, StoredFallback>) {
  if (!signal.length) return params;
  const ids = [...new Set(signal.flatMap((id) => (replaced.has(id) ? replaced.get(id)!.standIns.map((s) => s.entityId) : [id])))];
  return { ...params, "signal.interests.entities": ids.join(",") };
}

function readInsightsSafe(res: Parameters<typeof readInsights>[0]) {
  try {
    return readInsights(res)?.kind === "G2";
  } catch {
    return false;
  }
}
