// Drop-in REST: the same paths and parameters as Qloo under /q/*. Qloo answers first, with the caller's own key; the
// fallback is added after Qloo's response only where Qloo had a gap. Anything NotOnQ doesn't handle passes through.
// NotOnQ's entity IDs are UUIDs like Qloo's, so they are recognised by lookup (fills and offered candidates), not by form.
import type { ResolveOptions } from "@/server/engine/artist";
import { type Candidate, idForCandidate } from "@/server/engine/candidates";
import { type EraFill, fillEra, parseMusicTag } from "@/server/engine/era";
import type { Fetch } from "@/server/http";
import { ARTIST, entitiesOf, qlooClient, qlooMessage } from "@/server/qloo/client";
import { cachedQloo, QlooBudgetExceeded } from "@/server/qloo/cached";
import { readInsights, readSearch, sameName } from "@/server/qloo/gap";
import { blockFor, fallbackBlock, standInsOf } from "@/server/respond";
import type { Sql } from "@/server/store/db";
import * as mb from "@/server/adapters/musicbrainz";
import * as spotify from "@/server/adapters/spotify";
import { externalOf } from "@/server/engine/standins";
import { demandFor, findFallback, findOurIds, findShapeFill, linkSpotify, logRequest, saveCandidateRefs, saveShapeFill, type StoredFallback } from "@/server/store/repo";
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
    if (path === "entities" && req.params["external.spotify.ids"]) return await spotifyEntities(req, ctx);
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

  const l = await lookupArtist(query, ctx, { ...options, untyped: !req.params.types });
  const base = res.ok && res.json && typeof res.json === "object" ? (res.json as Record<string, unknown>) : {};
  const withQloo = (ours: unknown[]) => [...qlooResults, ...ours.filter((o) => !qlooResults.some((q) => q.entity_id === (o as { entity_id: string }).entity_id))];

  // The chosen candidate is an artist Qloo knows under another spelling ("eminim" → Eminem): Qloo's own entity.
  if (l.servedBy === "qloo") return { status: 200, body: { ...base, results: withQloo([l.entity]), notonq: { served_by: "qloo", attribution: [] } }, servedBy: "qloo" };
  // Ambiguous: every possible artist as a Qloo-shaped entry; sending one's ID back (to /entities or as a signal) fills it.
  if (l.servedBy === "needs_choice") {
    const offered = l.candidates.filter((c) => !c.inQloo);
    if (!offered.length) return qloo;
    await saveCandidateRefs(ctx.sql, offered.map((c) => ({ id: idForCandidate(c), key: c.key, name: c.name })));
    // A candidate already filled shows its fill (with its own label, e.g. "no similar artist Qloo knows yet").
    const filled = await findOurIds(ctx.sql, offered.map(idForCandidate));
    const entries = offered.map((c) => {
      const hit = filled.get(idForCandidate(c));
      return hit && "fill" in hit && hit.fill.entity ? hit.fill.entity : candidateEntity(c);
    });
    return { status: 200, body: { ...base, results: withQloo(entries), notonq: blockFor(l) }, servedBy: "fallback" };
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
      short_description: `Not in Qloo: a possible match NotOnQ found on ${sources || "open sources"}${facts.length ? ` (${facts.join(", ")})` : ""}. Choose this ID and NotOnQ fills the artist; taste answers then come from similar artists Qloo knows, and are empty if there are none.`,
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

/** How many Spotify IDs one request may resolve outside Qloo (each can cost a MusicBrainz call at 1 per second). */
const SPOTIFY_LOOKUPS = 5;

type SpotifyMatch = { spotify_id: string; via: "notonq" | "musicbrainz" | "musicbrainz_in_qloo" | "name" | "none"; entity_id?: string; note?: string };

/** /entities by Spotify ID (apps that pick artists on Spotify, like Busk Map and GhostQ). Qloo's own entities first,
 * unchanged. For each ID Qloo doesn't have: a NotOnQ fill already linked to it; else the artist MusicBrainz links to
 * that Spotify page (Qloo's own record when Qloo has that MusicBrainz ID, labelled, else NotOnQ's fill); else the name
 * on Spotify's public page, filled only when that name is one confident artist. */
async function spotifyEntities(req: RestRequest, ctx: Ctx): Promise<RestResponse> {
  const ids = req.params["external.spotify.ids"].split(",").map((s) => s.trim()).filter(Boolean);
  const res = await ctx.qloo.get("/entities", req.params);
  if (!res.ok && res.status !== 404) return { status: res.status || 502, body: res.json, servedBy: "qloo" };
  const qloo = res.ok ? entitiesOf(res.json) : [];
  const has = new Set(qloo.flatMap((e) => externalOf(e, "spotify").map((x) => String(x.id))));
  const missing = ids.filter((id) => !has.has(id) && spotify.isSpotifyId(id));
  if (!missing.length) return { status: res.status || 502, body: res.json, servedBy: "qloo" };

  const ours: unknown[] = [];
  const matches: SpotifyMatch[] = [];
  const found: StoredFallback[] = [];
  for (const id of missing.slice(0, SPOTIFY_LOOKUPS)) {
    const m = await matchSpotify(id, ctx);
    matches.push(m.match);
    if (m.entity) ours.push(m.entity);
    if (m.fill) found.push(m.fill);
  }
  for (const id of missing.slice(SPOTIFY_LOOKUPS)) matches.push({ spotify_id: id, via: "none", note: `Over ${SPOTIFY_LOOKUPS} lookups in one request: ask again for this ID.` });

  const servedBy = !ours.length ? "qloo" : qloo.length ? "mixed" : "fallback";
  const base = res.ok && res.json && typeof res.json === "object" ? (res.json as Record<string, unknown>) : {};
  const notonq: Record<string, unknown> = {
    served_by: servedBy,
    spotify: matches,
    note: "Artists after Qloo's own were matched by NotOnQ to Spotify IDs Qloo has no record for: through MusicBrainz's link to the Spotify page, or by the name on it when that name is one confident artist.",
  };
  for (const f of found) notonq[f.id] = fallbackBlock(f, await demandFor(ctx.sql, f.nameKey), { hit: true });
  return { status: ours.length || qloo.length ? 200 : res.status, body: { ...base, results: [...qloo, ...ours], notonq }, servedBy };
}

async function matchSpotify(id: string, ctx: Ctx): Promise<{ match: SpotifyMatch; entity?: unknown; fill?: StoredFallback }> {
  const linked = await findFallback(ctx.sql, { spotifyId: id });
  if (linked?.entity && !linked.resolvedByQlooAt) return { match: { spotify_id: id, via: "notonq", entity_id: linked.id }, entity: linked.entity, fill: linked };

  const fillFor = async (name: string, opts: ResolveOptions, via: SpotifyMatch["via"]) => {
    const l = await lookupArtist(name, ctx, opts);
    if (l.servedBy !== "fallback" || !l.fallback.entity) return null;
    await linkSpotify(ctx.sql, l.fallback.id, id);
    const entity = { ...l.fallback.entity, properties: { ...l.fallback.entity.properties, external: { ...l.fallback.entity.properties.external, spotify: { id } } } };
    return { match: { spotify_id: id, via, entity_id: l.fallback.id }, entity, fill: l.fallback };
  };

  const artist = await mb.artistForUrl(spotify.spotifyArtistUrl(id), { fetch: ctx.fetch });
  if (artist) {
    const inQloo = entitiesOf((await ctx.qloo.entitiesByMbids([artist.mbid])).json).find((e) => externalOf(e, "musicbrainz").some((x) => String(x.id).toLowerCase() === artist.mbid));
    if (inQloo) {
      const d = String(inQloo.properties?.short_description ?? "");
      const label = `Matched by NotOnQ: Qloo has this artist but not under this Spotify ID; MusicBrainz links the Spotify page to this record (${mb.mbArtistUrl(artist.mbid)}).`;
      return { match: { spotify_id: id, via: "musicbrainz_in_qloo", entity_id: inQloo.entity_id }, entity: { ...inQloo, properties: { ...inQloo.properties, short_description: d ? `${label} ${d}` : label } } };
    }
    const filled = await fillFor(artist.name, { candidateKey: `mb:${artist.mbid}` }, "musicbrainz");
    if (filled) return filled;
  }
  const name = await spotify.artistName(id, { fetch: ctx.fetch });
  if (name) {
    const filled = await fillFor(name, {}, "name");
    if (filled) return filled;
  }
  return { match: { spotify_id: id, via: "none", note: name ? `"${name}" is more than one artist (or one Qloo has under that name without this Spotify ID): search for it to choose.` : "Neither MusicBrainz nor Spotify's public page names this artist." } };
}

async function insights(req: RestRequest, ctx: Ctx): Promise<RestResponse> {
  const signal = (req.params["signal.interests.entities"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // NotOnQ's IDs never reach Qloo: swap them for their stand-ins up front.
  const replaced = await oursFor(signal, ctx);
  const ours = new Set(replaced.keys());
  let params = withSignal(req.params, signal, replaced);
  // Artists by era, genre and place (v0.3.0), also with a taste signal alongside (v0.4.0): see eraAnswer.
  const eraTag = req.params["filter.type"] === ARTIST ? (req.params["filter.tags"] ?? "").split(",").map((t) => t.trim()).find((t) => parseMusicTag(t)) : undefined;
  if (signal.length && !params["signal.interests.entities"]) {
    if (!eraTag) return noTasteData(replaced, ctx);
    // Only NotOnQ artists with no stand-ins: the era and place still stand on their own.
    params = Object.fromEntries(Object.entries(params).filter(([k]) => k !== "signal.interests.entities"));
  }
  // Ranking a given list (filter.results.entities, the harness's qloo_rank): Qloo can't score NotOnQ's artists, so they
  // leave the list Qloo sees and follow Qloo's ranking, labelled unranked.
  const options = (req.params["filter.results.entities"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const unranked = options.length ? await oursFor(options, ctx) : new Map<string, StoredFallback>();
  if (unranked.size) {
    const rest = options.filter((id) => !unranked.has(id));
    if (!rest.length) return unrankedAnswer(null, unranked, replaced, ctx);
    params = { ...params, "filter.results.entities": rest.join(",") };
  }
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

  if (eraTag) return eraAnswer(req, params, ctx, res, eraTag, replaced);
  if (unranked.size) return unrankedAnswer(res, unranked, replaced, ctx);

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

/** Qloo's ranking of the options it knows (or none, when every option is NotOnQ's), then NotOnQ's options, unranked:
 * Qloo has no taste data to score them with, and NotOnQ doesn't pretend to. */
async function unrankedAnswer(res: Awaited<ReturnType<Ctx["qloo"]["get"]>> | null, unranked: Map<string, StoredFallback>, replaced: Map<string, StoredFallback>, ctx: Ctx): Promise<RestResponse> {
  if (res && !res.ok) return { status: res.status || 502, body: res.json, servedBy: "qloo" };
  for (const f of [...unranked.values(), ...replaced.values()])
    await logRequest(ctx.sql, { nameKey: f.nameKey, entityId: f.id, endpoint: ctx.endpoint, servedBy: res ? "mixed" : "fallback", gapKind: f.gapKind, callerHash: ctx.callerHash, appLabel: ctx.appLabel, cacheHit: true });
  const base = res?.json && typeof res.json === "object" ? (res.json as Record<string, unknown>) : { success: true };
  const results = base.results && typeof base.results === "object" ? (base.results as Record<string, unknown>) : {};
  const qloo = res ? entitiesOf(res.json) : [];
  const ours = [...unranked.values()].flatMap((f) => (f.entity ? [f.entity] : []));
  return {
    status: 200,
    body: {
      ...base,
      results: { ...results, entities: [...qloo, ...ours] },
      notonq: {
        served_by: res ? "mixed" : "fallback",
        unranked: [...unranked.keys()],
        ...(replaced.size ? { proxy: { replaced: [...replaced.keys()], stand_ins: [...replaced.values()].flatMap(standInsOf) } } : {}),
        note: "Qloo ranked the options it knows; NotOnQ's artists follow, unranked: Qloo has no taste data to score them with.",
      },
    },
    servedBy: res ? "mixed" : "fallback",
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

/** Fewer artists than this from Qloo counts as a thin answer worth filling. */
export const THIN = 5;
const ERA_TTL_MS = 7 * 24 * 3600 * 1000;
const ERA_EMPTY_TTL_MS = 24 * 3600 * 1000;

/** Qloo's answer for an era/genre/place artist request, with NotOnQ's artists after Qloo's when Qloo had few or none,
 * or erred. Qloo's own entities stay first and unchanged; the Ledger records the gap by request shape.
 *
 * With a taste signal alongside (signal.interests.entities or .tags, as apps send for "artists like the family's
 * favourite, from her 1960s Lagos"), the era fill is the same, and Qloo itself ranks the Qloo artists in it for that
 * signal (filter.results.entities): NotOnQ picks who fits the era and place, Qloo says who fits the taste. `sent` is
 * what Qloo was asked, with NotOnQ's IDs already swapped for their stand-ins. */
async function eraAnswer(
  req: RestRequest,
  sent: Record<string, string>,
  ctx: Ctx,
  res: Awaited<ReturnType<Ctx["qloo"]["get"]>>,
  tag: string,
  replaced: Map<string, StoredFallback>,
): Promise<RestResponse> {
  const take = Math.max(1, Math.min(Number(req.params.take) || 20, 50));
  const qlooEntities = res.ok ? entitiesOf(res.json) : [];
  if (res.ok && qlooEntities.length >= Math.min(THIN, take)) return { status: res.status, body: res.json, servedBy: "qloo" };

  const place = req.params["signal.location.query"] || req.params["filter.location.query"] || undefined;
  // The version in the key retires fills made by older ranking rules.
  const key = `era:v4:${tag}|${(place ?? "").toLowerCase()}|${take}`;
  let fill = await findShapeFill<EraFill>(ctx.sql, key, ERA_TTL_MS);
  const cacheHit = !!fill && (fill.entities.length > 0 || !!(await findShapeFill<EraFill>(ctx.sql, key, ERA_EMPTY_TTL_MS)));
  if (!cacheHit) {
    fill = await fillEra(tag, place, take, { qloo: ctx.qloo, lastfmKey: ctx.lastfmKey, fetch: ctx.fetch });
    await saveShapeFill(ctx.sql, key, fill);
  }
  const f = fill!;
  const signalIds = new Set([...(sent["signal.interests.entities"] ?? "").split(","), ...replaced.keys()].map((s) => s.trim()).filter(Boolean));
  const hasSignal = signalIds.size > 0 || !!sent["signal.interests.tags"];
  const idOf = (e: unknown) => String((e as { entity_id?: string }).entity_id ?? "");
  const notInQloo = (e: unknown) => String((e as { properties?: { short_description?: string } }).properties?.short_description ?? "").startsWith("Not in Qloo");
  // Never the signal's own artists back as the answer to "artists like them".
  let ours = f.entities.filter((e) => !qlooEntities.some((q) => q.entity_id === idOf(e)) && !signalIds.has(idOf(e)));
  const rankedIds = new Set<string>();
  if (hasSignal) {
    const known = ours.filter((e) => !notInQloo(e)).map(idOf);
    if (known.length) {
      // Taste only: the fill already applied the era and place, and a location here makes Qloo drop artists it has
      // no location data for (checked 27 Oct 2026: 3 of 3 ranked without Lagos, 1 of 3 with it).
      const ranked = await ctx.qloo.get("/v2/insights", {
        ...Object.fromEntries(Object.entries(sent).filter(([k]) => k !== "filter.tags" && k !== "operator.filter.tags" && !/^(signal|filter)\.location/.test(k))),
        "filter.results.entities": known.join(","),
        take: String(known.length),
      });
      const order = ranked.ok ? entitiesOf(ranked.json).map((e) => e.entity_id) : [];
      for (const id of order) if (known.includes(id)) rankedIds.add(id);
      const pos = (e: unknown) => (order.includes(idOf(e)) ? order.indexOf(idOf(e)) : notInQloo(e) ? Infinity : order.length);
      ours = [...ours].sort((a, b) => pos(a) - pos(b));
    }
  }
  const filled = ours.filter(notInQloo);
  await saveCandidateRefs(ctx.sql, filled.map((e) => ({ id: (e as { entity_id: string }).entity_id, key: `mb:${(e as { entity_id: string }).entity_id}`, name: (e as { name: string }).name })));

  // Honesty check: Qloo may answer the same tag as a taste signal (signal.interests.tags) even when the filter is
  // empty. Report how many it has that way, so a client sees what Qloo offers before using NotOnQ's fill.
  const asSignal = await ctx.qloo.get("/v2/insights", {
    ...Object.fromEntries(Object.entries(sent).filter(([k]) => k !== "filter.tags" && k !== "operator.filter.tags")),
    "signal.interests.tags": sent["signal.interests.tags"] ? `${sent["signal.interests.tags"]},${tag}` : tag,
  });
  const qlooAsSignal = asSignal.ok ? entitiesOf(asSignal.json).length : undefined;

  // Every entity NotOnQ added says so where any client shows it (the harness passes only short_description on),
  // including Qloo's own records NotOnQ picked: Qloo did not return them for this request, so they must not pass
  // for Qloo's answer. The hint names what Qloo does have.
  const hint = qlooAsSignal ? ` Qloo has ${qlooAsSignal} artists for this tag as a taste signal (signal.interests.tags).` : "";
  const labelled = ours.map((e) => {
    const x = e as { properties?: Record<string, unknown> };
    const description = String(x.properties?.short_description ?? "");
    if (description.startsWith("Not in Qloo")) return { ...x, properties: { ...x.properties, short_description: `${description}${hint}` } };
    const evidence = f.facts?.[String((e as { entity_id?: string }).entity_id)];
    const rank = rankedIds.has(idOf(e)) ? " Ranked by Qloo for this request's taste signal." : "";
    const picked = `Picked by NotOnQ: Qloo returned ${qlooEntities.length} artists for this request; this is Qloo's own record${evidence ? ` (MusicBrainz: ${evidence})` : ""}.${rank}${hint}`;
    return { ...x, properties: { ...x.properties, short_description: description ? `${picked} ${description}` : picked } };
  });

  const label = [tag.split(":").pop(), place].filter(Boolean).join(" · ");
  const servedBy = !ours.length ? "qloo" : qlooEntities.length ? "mixed" : "fallback";
  await logRequest(ctx.sql, { nameKey: label, query: `${tag}${place ? ` @ ${place}` : ""}${hasSignal ? " + taste signal" : ""}`, endpoint: ctx.endpoint, servedBy: servedBy === "qloo" ? "fallback" : servedBy, gapKind: "G4", callerHash: ctx.callerHash, appLabel: ctx.appLabel, cacheHit });

  const base = res.ok && res.json && typeof res.json === "object" ? (res.json as Record<string, unknown>) : { success: true };
  const results = base.results && typeof base.results === "object" ? (base.results as Record<string, unknown>) : {};
  return {
    status: 200,
    body: {
      ...base,
      results: { ...results, entities: [...qlooEntities, ...labelled].slice(0, take) },
      notonq: {
        served_by: servedBy,
        gap: { kind: "G4", qloo_status: res.status, qloo_message: qlooMessage(res.json), reason: `Qloo returned ${qlooEntities.length} artists for ${tag}${place ? ` in ${place}` : ""}`, qloo_as_signal: qlooAsSignal },
        request: { tag, place, country: f.country, query: f.query, taste_signal: hasSignal },
        ...(hasSignal ? { ranking: { by: "qloo", ranked: rankedIds.size, note: "Qloo ranked its own artists in NotOnQ's era fill for this request's taste signal (filter.results.entities). Artists not in Qloo follow, by listeners." } } : {}),
        ...(replaced.size ? { proxy: { replaced: [...replaced.keys()], stand_ins: [...replaced.values()].flatMap(standInsOf) } } : {}),
        cache: { hit: cacheHit },
        provenance: f.provenance,
        note: [
          f.unresolvedPlace ? `NotOnQ could not place "${f.unresolvedPlace}" in a country, so it added nothing rather than artists from anywhere.` : "",
          ours.length
            ? "Artists after Qloo's own come from NotOnQ: ones Qloo knows are Qloo's entities; the rest are labelled Not in Qloo, with sources."
            : "No artist found in open data for this era, genre and place.",
          qlooAsSignal
            ? `Qloo does have ${qlooAsSignal} artists for this tag as a taste signal: send it as signal.interests.tags instead of filter.tags to get Qloo's own answer.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      },
    },
    servedBy: servedBy === "qloo" ? "qloo" : servedBy,
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
