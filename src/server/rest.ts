// Drop-in REST: the same paths and parameters as Qloo under /q/*. Qloo answers first, with the caller's own key; the
// fallback is added after Qloo's response only where Qloo had a gap. Anything NotOnQ doesn't handle passes through.
// NotOnQ's entity IDs are UUIDs like Qloo's, so they are recognised by lookup (fills and offered candidates), not by form.
import type { ResolveOptions } from "@/server/engine/artist";
import { type Candidate, idForCandidate } from "@/server/engine/candidates";
import type { Fetch } from "@/server/http";
import { ARTIST, entitiesOf, qlooClient, qlooMessage } from "@/server/qloo/client";
import { cachedQloo, QlooBudgetExceeded } from "@/server/qloo/cached";
import { readInsights, readSearch, sameName } from "@/server/qloo/gap";
import { blockFor, fallbackBlock, standInsOf } from "@/server/respond";
import type { Sql } from "@/server/store/db";
import { demandFor, findOurIds, logRequest, saveCandidateRefs, type StoredFallback } from "@/server/store/repo";
import { type Ctx, fallbackForQlooId, hashCaller, lookupArtist } from "@/server/service";

export type RestRequest = {
  path: string;
  params: Record<string, string>;
  apiKey?: string;
  lastfmKey?: string;
  appLabel?: string;
  /** POST requests carry Qloo's parameters in a JSON body instead of the query string. */
  body?: Record<string, unknown>;
};

export type RestDeps = { sql: Sql; baseUrl: string; salt: string; fetch?: Fetch; defer?: Ctx["defer"]; research?: Ctx["research"] };
export type RestResponse = { status: number; body: unknown; servedBy: "qloo" | "fallback" | "mixed" };

export async function handleRest(req: RestRequest, deps: RestDeps): Promise<RestResponse> {
  if (!req.apiKey) return { status: 401, body: { message: "No API key found in request" }, servedBy: "qloo" };
  const callerHash = hashCaller(req.apiKey, deps.salt);
  const qloo = cachedQloo(qlooClient({ apiKey: req.apiKey, baseUrl: deps.baseUrl, fetch: deps.fetch }), deps.sql, callerHash);
  const ctx: Ctx = { sql: deps.sql, qloo, lastfmKey: req.lastfmKey, callerHash, appLabel: req.appLabel, endpoint: `/${req.path}`, fetch: deps.fetch, defer: deps.defer, research: deps.research };
  const path = req.path.replace(/^\/+|\/+$/g, "");
  // notonq.* parameters steer NotOnQ only; Qloo never sees them.
  const options = { candidateKey: req.params["notonq.candidate"] || undefined, choose: req.params["notonq.choose"] === "1" };
  req = { ...req, params: Object.fromEntries(Object.entries(req.params).filter(([k]) => !k.startsWith("notonq."))) };

  try {
    if (req.body) {
      if (path === "v2/insights") return await insightsPost(req.body, ctx);
      const res = await qloo.post(`/${path}`, req.body);
      return { status: res.status || 502, body: res.json, servedBy: "qloo" };
    }
    if (path === "search" && req.params.query && artistScope(req.params.types)) return await search(req, ctx, options);
    if (path === "entities" && req.params.entity_ids) return await entities(req, ctx);
    if (path === "v2/insights") return await insights(req, ctx);
    if (path === "v2/analysis/compare") return await compare(req, ctx);
    const res = await qloo.get(`/${path}`, req.params);
    return { status: res.status || 502, body: res.json, servedBy: "qloo" };
  } catch (e) {
    if (e instanceof QlooBudgetExceeded) return { status: 429, body: { message: e.message }, servedBy: "qloo" };
    throw e;
  }
}

/** Artist searches, and untyped ones (the Qloo harness searches without a type when the agent gives none). */
const artistScope = (types?: string) => !types || types.split(",").every((t) => t.trim() === ARTIST);

/** Qloo's results always come first, unchanged and in Qloo's order; NotOnQ's artists are added after them, so a client
 * (or the harness choosing by exact name) sees both and nothing of Qloo's is hidden. */
async function search(req: RestRequest, ctx: Ctx, options: ResolveOptions): Promise<RestResponse> {
  const query = req.params.query;
  const res = await ctx.qloo.get("/search", req.params);
  const qloo = { status: res.status || 502, body: res.json, servedBy: "qloo" as const };
  if (res.status !== 404 && !res.ok) return qloo;
  const qlooResults = res.ok ? entitiesOf(res.json) : [];
  // Untyped: anything Qloo has under exactly this name (a place, a book) is Qloo's answer. Typed: an exact artist is.
  if (req.params.types ? "found" in readSearch(query, res) : qlooResults.some((e) => sameName(e.name, query))) return qloo;

  const l = await lookupArtist(query, ctx, options);
  const base = res.ok && res.json && typeof res.json === "object" ? (res.json as Record<string, unknown>) : {};
  const withQloo = (ours: unknown[]) => [...qlooResults, ...ours.filter((o) => !qlooResults.some((q) => q.entity_id === (o as { entity_id: string }).entity_id))];

  // The chosen candidate is an artist Qloo knows under another spelling ("eminim" → Eminem): Qloo's own entity.
  if (l.servedBy === "qloo") return { status: 200, body: { ...base, results: withQloo([l.entity]), notonq: { served_by: "qloo", attribution: [] } }, servedBy: "qloo" };
  // Ambiguous: every possible artist as a Qloo-shaped entry; sending one's ID back (to /entities or as a signal) fills it.
  if (l.servedBy === "needs_choice") {
    const offered = l.candidates.filter((c) => !c.inQloo);
    await saveCandidateRefs(ctx.sql, offered.map((c) => ({ id: idForCandidate(c), key: c.key, name: c.name })));
    return { status: 200, body: { ...base, results: withQloo(offered.map(candidateEntity)), notonq: blockFor(l) }, servedBy: "fallback" };
  }
  return {
    status: l.fallback.entity ? 200 : res.status,
    body: {
      ...base,
      results: withQloo(l.fallback.entity ? [l.fallback.entity] : []),
      notonq: { ...blockFor(l), served_by: qlooResults.length ? "mixed" : "fallback" },
    },
    servedBy: qlooResults.length ? "mixed" : "fallback",
  };
}

/** A candidate as a search result: Qloo's keys, a UUID, and a short_description saying what it is and where from. */
export function candidateEntity(c: Candidate) {
  const facts = [
    c.type,
    c.country,
    c.disambiguation,
    c.listeners !== undefined && `${c.listeners.toLocaleString("en")} Last.fm listeners`,
    c.fans !== undefined && `${c.fans.toLocaleString("en")} Deezer fans`,
  ].filter(Boolean);
  const sources = [...new Set(c.links.map((l) => l.source))].join(", ");
  return {
    entity_id: idForCandidate(c),
    name: c.name,
    types: [ARTIST],
    ...(c.disambiguation ? { disambiguation: c.disambiguation } : {}),
    properties: {
      akas: [],
      external: { ...(c.mbid ? { musicbrainz: { id: c.mbid } } : {}), ...(c.deezerId ? { "notonq:deezer": { id: c.deezerId, fans: c.fans ?? 0 } } : {}) },
      ...(c.image ? { image: { url: c.image } } : {}),
      short_description: `Not in Qloo: a possible match NotOnQ found on ${sources || "open sources"}${facts.length ? ` (${facts.join(", ")})` : ""}. Choose this ID and NotOnQ fills the artist.`,
    },
    tags: [],
  };
}

/** NotOnQ's fills for these IDs: ones we hold, and candidates we offered, filled now. */
async function oursFor(ids: string[], ctx: Ctx): Promise<Map<string, StoredFallback>> {
  const found = new Map<string, StoredFallback>();
  for (const [id, hit] of await findOurIds(ctx.sql, ids)) {
    if ("fill" in hit) found.set(id, hit.fill);
    else {
      const l = await lookupArtist(hit.candidate.name, ctx, { candidateKey: hit.candidate.key });
      if (l.servedBy === "fallback") found.set(id, l.fallback);
    }
  }
  return found;
}

async function entities(req: RestRequest, ctx: Ctx): Promise<RestResponse> {
  const ids = req.params.entity_ids.split(",").map((s) => s.trim());
  const ours = await oursFor(ids, ctx);
  if (!ours.size) {
    const res = await ctx.qloo.get("/entities", req.params);
    return { status: res.status || 502, body: res.json, servedBy: "qloo" };
  }
  const theirs = ids.filter((id) => !ours.has(id));
  const res = theirs.length ? await ctx.qloo.get("/entities", { ...req.params, entity_ids: theirs.join(",") }) : null;
  const found = [...ours.values()];
  for (const f of found)
    await logRequest(ctx.sql, { nameKey: f.nameKey, entityId: f.id, endpoint: ctx.endpoint, servedBy: "fallback", gapKind: f.gapKind, callerHash: ctx.callerHash, appLabel: ctx.appLabel, cacheHit: true });
  const results = [...(res ? entitiesOf(res.json) : []), ...found.flatMap((f) => (f.entity ? [f.entity] : []))];
  const notonq = Object.fromEntries(await Promise.all(found.map(async (f) => [f.id, fallbackBlock(f, await demandFor(ctx.sql, f.nameKey), { hit: true })])));
  return { status: results.length ? 200 : 404, body: { results, notonq }, servedBy: theirs.length ? "mixed" : "fallback" };
}

async function insights(req: RestRequest, ctx: Ctx): Promise<RestResponse> {
  const signal = (req.params["signal.interests.entities"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // NotOnQ's IDs never reach Qloo: swap them for their stand-ins up front.
  const replaced = await oursFor(signal, ctx);
  const ours = new Set(replaced.keys());
  let params = withSignal(req.params, signal, replaced);
  if (signal.length && !params["signal.interests.entities"]) return noTasteData(replaced, ctx);
  let res = await ctx.qloo.get("/v2/insights", params);

  // G2: Qloo knows these IDs but can't use them. Swap each for its stand-ins and ask once more.
  if (res.status === 400 && readInsightsSafe(res)) {
    for (const id of signal.filter((s) => !ours.has(s) && !replaced.has(s))) {
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

/** Audience comparison: each group's NotOnQ artists become their stand-ins (Qloo would silently drop our IDs). */
async function compare(req: RestRequest, ctx: Ctx): Promise<RestResponse> {
  const groups = Object.keys(req.params).filter((k) => k.endsWith("signal.interests.entities"));
  const ids = groups.flatMap((k) => req.params[k].split(",").map((s) => s.trim()).filter(Boolean));
  const replaced = new Map([...(await oursFor(ids, ctx))].filter(([, f]) => f.standIns.length));
  const params = { ...req.params };
  for (const k of groups) params[k] = withSignal(req.params, req.params[k].split(",").map((s) => s.trim()).filter(Boolean), replaced)["signal.interests.entities"];
  const res = await ctx.qloo.get("/v2/analysis/compare", params);
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
        proxy: { replaced: [...replaced.keys()], stand_ins: [...replaced.values()].flatMap(standInsOf) },
        note: "Groups with NotOnQ artists were compared through their stand-ins, similar artists Qloo knows.",
      },
    },
    servedBy: "mixed",
  };
}

type SignalItem = string | { id: string; weight?: number };

/** POST /v2/insights: `signal.interests.entities` may be a list of IDs or of {id, weight} (Qloo's live format, checked
 * 23 Oct 2026: "an array of UUID strings and/or objects with an id property"). NotOnQ IDs, and Qloo IDs
 * Qloo can't use as a signal, become their stand-ins in the same form (weights scaled by each stand-in's match). */
async function insightsPost(body: Record<string, unknown>, ctx: Ctx): Promise<RestResponse> {
  const raw = body["signal.interests.entities"];
  const items: SignalItem[] = Array.isArray(raw) ? (raw as SignalItem[]) : typeof raw === "string" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const idOf = (i: SignalItem) => (typeof i === "string" ? i : i.id);
  const replaced = await oursFor(items.map(idOf), ctx);
  const ours = new Set(replaced.keys());
  const rewrite = () => {
    if (!items.length) return body;
    const out = items.flatMap((i) => {
      const f = replaced.get(idOf(i));
      if (!f) return [i];
      return f.standIns.map((s) => (typeof i === "string" ? s.entityId : { id: s.entityId, weight: Math.round((i.weight ?? 1) * s.weight * 1000) / 1000 }));
    });
    return { ...body, "signal.interests.entities": out };
  };
  const first = rewrite();
  if (items.length && !(first["signal.interests.entities"] as unknown[]).length) return noTasteData(replaced, ctx);
  let res = await ctx.qloo.post("/v2/insights", first);
  if (res.status === 400 && readInsightsSafe(res)) {
    for (const id of items.map(idOf).filter((s) => !ours.has(s) && !replaced.has(s))) {
      const f = await fallbackForQlooId(id, ctx);
      if (f?.standIns.length) replaced.set(id, f);
    }
    res = await ctx.qloo.post("/v2/insights", rewrite());
  }
  if (!replaced.size) return { status: res.status || 502, body: res.json, servedBy: "qloo" };
  for (const f of replaced.values())
    await logRequest(ctx.sql, { nameKey: f.nameKey, entityId: f.id, endpoint: ctx.endpoint, servedBy: "mixed", gapKind: f.gapKind, callerHash: ctx.callerHash, appLabel: ctx.appLabel, cacheHit: true });
  const resBody = res.json && typeof res.json === "object" ? (res.json as Record<string, unknown>) : { message: qlooMessage(res.json) };
  return {
    status: res.status || 502,
    body: {
      ...resBody,
      notonq: {
        served_by: "mixed",
        proxy: { replaced: [...replaced.keys()], stand_ins: [...replaced.values()].flatMap(standInsOf) },
        note: "Results are Qloo's answer for the stand-ins listed, used in place of artists Qloo has no taste data for.",
      },
    },
    servedBy: "mixed",
  };
}

/** Every signal is a NotOnQ artist with no similar artist Qloo knows: nothing to ask Qloo. An empty answer (never a
 * Qloo error for an ID Qloo was never sent), with the reason; the entity's own label says the same to the harness. */
async function noTasteData(replaced: Map<string, StoredFallback>, ctx: Ctx): Promise<RestResponse> {
  for (const f of replaced.values())
    await logRequest(ctx.sql, { nameKey: f.nameKey, entityId: f.id, endpoint: ctx.endpoint, servedBy: "fallback", gapKind: f.gapKind, callerHash: ctx.callerHash, appLabel: ctx.appLabel, cacheHit: true });
  const names = [...replaced.values()].map((f) => f.name).join(", ");
  return {
    status: 200,
    body: {
      success: true,
      results: {},
      notonq: { served_by: "fallback", proxy: { replaced: [...replaced.keys()], stand_ins: [] }, note: `No taste data: ${names} is not in Qloo and has no similar artist Qloo knows yet.` },
    },
    servedBy: "fallback",
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
