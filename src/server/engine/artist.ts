// Resolve one artist: Qloo first. On a gap, find who the name could be across MusicBrainz, Last.fm and Deezer; continue
// on its own only with a single confident exact MusicBrainz match, otherwise hand the candidates back to choose from.
// The fill is then anchored on the chosen candidate, so small artists with no MusicBrainz record still get an entity.
import * as deezer from "@/server/adapters/deezer";
import * as lastfm from "@/server/adapters/lastfm";
import * as mb from "@/server/adapters/musicbrainz";
import * as wd from "@/server/adapters/wikidata";
import * as wp from "@/server/adapters/wikipedia";
import { type Candidate, candidateFromKey, findCandidates, idForKey, slug } from "@/server/engine/candidates";
import { fitPopularity, type PopularityFit } from "@/server/engine/popularity";
import { externalOf, lookupBatch, pickStandIns, type Similar, type StandIn } from "@/server/engine/standins";
import type { Fetch } from "@/server/http";
import { cite, LICENCES, type ProvenanceMap } from "@/server/provenance";
import { ARTIST, entitiesOf, type QlooClient, type QlooEntity } from "@/server/qloo/client";
import { type Gap, readInsights, readSearch, sameName } from "@/server/qloo/gap";

/** Marks an unavailable field whose source failed (not "found nothing"): such fills are retried sooner. */
export const SOURCE_ERROR = "source error";

/** NotOnQ's own values and keys carry this prefix; everything else is exactly what Qloo would put there. */
export const NS = "notonq:";

/** One artist, field for field the shape Qloo's /search and /entities return (live, 15–23 Oct 2026), built only from
 * our own (open) data. Values NotOnQ mints (entity and tag IDs) and keys Qloo doesn't have start with "notonq:". */
export type FallbackEntity = {
  name: string;
  entity_id: string;
  types: [typeof ARTIST];
  properties: {
    akas: { value: string; languages: string[] }[];
    external: {
      facebook?: { id: string };
      instagram?: { id: string };
      lastfm?: { id: string; listeners: number; scrobbles?: number };
      musicbrainz?: { id: string };
      spotify?: { id: string };
      twitter?: { id: string };
      wikidata?: { id: string };
      "notonq:deezer"?: { id: number; fans: number };
    };
    image?: { url: string };
    short_description?: string;
  };
  popularity?: number;
  disambiguation?: string;
  tags: { name: string; tag_id: string; type: "urn:tag:genre"; value: string }[];
};

/** A genre as a Qloo-shaped tag. The ID is ours (prefixed), never passed off as one of Qloo's tag IDs. */
export const genreTag = (name: string): FallbackEntity["tags"][number] => {
  const id = `${NS}urn:tag:genre:${slug(name).replace(/-/g, "_")}`;
  return { name, tag_id: id, type: "urn:tag:genre", value: id };
};

/** high: a MusicBrainz record. low: only Last.fm and/or Deezer know the artist. */
export type Confidence = "high" | "low";

export type Fill = {
  entity: FallbackEntity | null;
  candidateKey?: string;
  confidence?: Confidence;
  standIns: StandIn[];
  popularity?: PopularityFit;
  provenance: ProvenanceMap;
  unavailable: string[];
};

export type ArtistResult =
  | { servedBy: "qloo"; entity: QlooEntity }
  | { servedBy: "needs_choice"; gap: Gap; qlooEntity?: QlooEntity; candidates: Candidate[] }
  | ({ servedBy: "fallback"; gap: Gap; qlooEntity?: QlooEntity } & Fill);

export type ResolveDeps = { qloo: QlooClient; lastfmKey?: string; fetch?: Fetch };
export type ResolveOptions = { candidateKey?: string; choose?: boolean };

export async function resolveArtist(name: string, deps: ResolveDeps, opts: ResolveOptions = {}): Promise<ArtistResult> {
  const { qloo } = deps;
  const search = readSearch(name, await qloo.searchArtist(name));
  let gap: Gap;
  let qlooEntity: QlooEntity | undefined;
  if ("found" in search) {
    const probe = await qloo.insights({ "filter.type": ARTIST, "signal.interests.entities": search.found.entity_id, take: 1 });
    const g2 = readInsights(probe);
    if (!g2) return { servedBy: "qloo", entity: search.found };
    gap = g2;
    qlooEntity = search.found;
  } else {
    gap = search.gap;
  }

  const set = await findCandidates(name, deps);
  const known = await markInQloo(set.candidates, qloo);
  let anchor: Candidate | undefined;
  if (opts.candidateKey) {
    anchor = set.candidates.find((c) => c.key === opts.candidateKey) ?? candidateFromKey(opts.candidateKey, name) ?? undefined;
    if (!anchor) return { servedBy: "needs_choice", gap, qlooEntity, candidates: set.candidates };
  } else if (set.auto && !opts.choose) {
    anchor = set.auto;
  } else if (set.candidates.length) {
    return { servedBy: "needs_choice", gap, qlooEntity, candidates: set.candidates };
  }

  // The chosen artist may be one Qloo knows under another spelling ("eminim" → Eminem): then Qloo answers, not us.
  if (anchor?.mbid && !anchor.inQloo) await markInQloo([anchor], qloo, known);
  const hit = anchor?.inQloo && known.get(anchor.inQloo.entityId);
  if (hit && !readInsights(await qloo.insights({ "filter.type": ARTIST, "signal.interests.entities": hit.entity_id, take: 1 }))) return { servedBy: "qloo", entity: hit };

  return { servedBy: "fallback", gap, qlooEntity, ...(await buildFallback(name, deps, anchor)) };
}

/** One batch lookup by MusicBrainz ID: flags the candidates Qloo already has, and returns those Qloo entities. */
async function markInQloo(candidates: Candidate[], qloo: QlooClient, known = new Map<string, QlooEntity>()) {
  const mbids = [...new Set(candidates.flatMap((c) => (c.mbid ? [c.mbid.toLowerCase()] : [])))].slice(0, 25);
  if (!mbids.length) return known;
  const rows = entitiesOf((await qloo.entitiesByMbids(mbids)).json);
  for (const c of candidates) {
    const e = c.mbid ? rows.find((r) => externalOf(r, "musicbrainz").some((m) => String(m.id).toLowerCase() === c.mbid!.toLowerCase())) : undefined;
    if (!e) continue;
    c.inQloo = { entityId: e.entity_id, name: e.name };
    known.set(e.entity_id, e);
  }
  return known;
}

export async function buildFallback(name: string, { qloo, lastfmKey, fetch: f }: ResolveDeps, anchor?: Candidate): Promise<Fill> {
  const provenance: ProvenanceMap = {};
  const unavailable: string[] = [];

  if (!anchor) {
    unavailable.push("entity (no source knows this name)");
    return { entity: null, standIns: [], provenance, unavailable };
  }

  const artist = anchor.mbid ? await mb.getArtist(anchor.mbid, { fetch: f }) : null;
  const lfName = anchor.lastfmName ?? artist?.name ?? anchor.name;
  // A source that fails (rather than finding nothing) is noted, so the fill is retried after a day, not a week.
  const soft = async <T>(label: string, run: () => Promise<T | null>): Promise<T | null> => {
    try {
      return await run();
    } catch (e) {
      if (!(e instanceof wd.SourceError)) throw e;
      unavailable.push(`${label} (${SOURCE_ERROR}: ${e.message})`);
      return null;
    }
  };
  const [wiki, info, similar, dz] = await Promise.all([
    artist ? soft("properties.external.wikidata", () => wd.artistByMbid(artist.mbid, { fetch: f })) : null,
    lastfmKey ? lastfm.artistInfo(lfName, lastfmKey, { fetch: f }) : null,
    lastfmKey ? lastfm.similarArtists(lfName, lastfmKey, { fetch: f }) : [],
    anchor.deezerId ? deezer.getArtist(anchor.deezerId, { fetch: f }) : null,
  ]);
  const summary = wiki?.enwiki ? await soft("properties.short_description", () => wp.summary(wiki.enwiki!, { fetch: f })) : null;
  const standIns = await findStandIns(lfName, similar, dz, qloo, provenance, f);
  if (!standIns.length) unavailable.push(lastfmKey || dz ? "standIns (no similar artist known to Qloo)" : "standIns (no Last.fm key)");

  const displayName = artist?.name ?? dz?.name ?? anchor.name;
  const entity: FallbackEntity = {
    entity_id: idForKey(artist ? `mb:${artist.mbid}` : anchor.deezerId ? `dz:${anchor.deezerId}` : `lf:${slug(lfName)}`),
    name: displayName,
    types: [ARTIST],
    properties: { akas: [], external: {} },
    tags: [],
  };

  if (artist) {
    entity.disambiguation = [artist.disambiguation, artist.country].filter(Boolean).join(", ") || undefined;
    entity.properties.external.musicbrainz = { id: artist.mbid };
    const mbCite = (path: string) => cite(provenance, path, { source: "musicbrainz", record: artist.record, licence: LICENCES.musicbrainz, method: "copied" });
    mbCite("name");
    mbCite("properties.external.musicbrainz");
    if (entity.disambiguation) mbCite("disambiguation");
    if (artist.aliases.length) {
      entity.properties.akas = artist.aliases.map((value) => ({ value, languages: [] }));
      mbCite("properties.akas");
    }
  } else {
    // No MusicBrainz record: the name comes from the source the user chose.
    const nameSource = dz ? { source: "deezer", record: dz.link, licence: LICENCES.deezer } : { source: "lastfm", record: info?.url ?? lastfm.lastfmArtistUrl(lfName), licence: LICENCES.lastfm };
    cite(provenance, "name", { ...nameSource, method: "copied", note: "No MusicBrainz record: low confidence, chosen from candidates" });
    unavailable.push("properties.external.musicbrainz");
  }

  if (dz) {
    entity.properties.external["notonq:deezer"] = { id: dz.id, fans: dz.fans };
    cite(provenance, "properties.external.notonq:deezer", { source: "deezer", record: dz.link, licence: LICENCES.deezer, method: "copied" });
  }

  if (wiki) {
    const wdCite = (path: string) => cite(provenance, path, { source: "wikidata", record: wiki.record, licence: LICENCES.wikidata, method: "copied" });
    entity.properties.external.wikidata = { id: wiki.qid };
    wdCite("properties.external.wikidata");
    for (const ns of ["spotify", "facebook", "instagram", "twitter"] as const) {
      const id = wiki.ids[ns];
      if (!id) continue;
      entity.properties.external[ns] = { id };
      wdCite(`properties.external.${ns}`);
    }
  } else if (!unavailable.some((u) => u.startsWith("properties.external.wikidata"))) unavailable.push("properties.external.wikidata");

  if (wiki?.image) {
    entity.properties.image = { url: wiki.image.url };
    cite(provenance, "properties.image", { source: "wikimedia-commons", record: wiki.image.page, licence: "see the Commons file page", method: "copied" });
  } else if (dz?.picture) {
    entity.properties.image = { url: dz.picture };
    cite(provenance, "properties.image", { source: "deezer", record: dz.link, licence: LICENCES.deezer, method: "copied" });
  } else unavailable.push("properties.image");

  if (summary) {
    entity.properties.short_description = summary.extract;
    cite(provenance, "properties.short_description", { source: "wikipedia", record: summary.url, licence: LICENCES.wikipedia, method: "copied" });
  } else if (!unavailable.some((u) => u.startsWith("properties.short_description"))) unavailable.push("properties.short_description");

  if (wiki?.genres.length) {
    entity.tags = wiki.genres.map(genreTag);
    cite(provenance, "tags", { source: "wikidata", record: wiki.record, licence: LICENCES.wikidata, method: "copied" });
  } else if (artist?.tags.length) {
    // MusicBrainz tags are supplementary data (CC BY-NC-SA): fine for this non-commercial tool, labelled as such.
    entity.tags = artist.tags.map(genreTag);
    cite(provenance, "tags", { source: "musicbrainz", record: artist.record, licence: "CC-BY-NC-SA-3.0", method: "copied" });
  } else unavailable.push("tags");

  if (info?.listeners !== undefined) {
    entity.properties.external.lastfm = { id: info.name ?? lfName, listeners: info.listeners, scrobbles: info.playcount };
    cite(provenance, "properties.external.lastfm", { source: "lastfm", record: info.url ?? lastfm.lastfmArtistUrl(lfName), licence: LICENCES.lastfm, method: "copied" });
  }

  const points = standIns.flatMap((s) => (s.listeners !== undefined && s.popularity !== undefined ? [{ listeners: s.listeners, popularity: s.popularity }] : []));
  const popularity = info?.listeners ? (fitPopularity(points, info.listeners) ?? undefined) : undefined;
  if (popularity) {
    entity.popularity = popularity.value;
    cite(provenance, "popularity", {
      source: "notonq",
      record: info?.url ?? lastfm.lastfmArtistUrl(lfName),
      licence: LICENCES.notonq,
      method: "derived",
      note: `log10(Last.fm listeners) → Qloo popularity, fitted on ${popularity.n} stand-ins (${standIns.map((s) => s.name).join(", ")}), rmse ${popularity.rmse}`,
    });
  } else unavailable.push("popularity");

  return { entity, candidateKey: anchor.key, confidence: artist ? "high" : "low", standIns, popularity, provenance, unavailable };
}

const DEEZER_LOOKUPS = 5;

/** Last.fm similar artists by MusicBrainz ID (one batch call); topped up from Deezer's related artists by exact
 * name (a few Qloo searches) when Last.fm has too few, which is the usual case for small artists. */
async function findStandIns(name: string, similar: lastfm.LfSimilar[], dz: deezer.DzArtist | null, qloo: QlooClient, provenance: ProvenanceMap, f?: Fetch) {
  const fromLastfm: Similar[] = similar.flatMap((s) => (s.mbid ? [{ name: s.name, mbid: s.mbid, match: s.match, source: "lastfm" }] : []));
  const batch = lookupBatch(fromLastfm);
  const known = batch.length ? entitiesOf((await qloo.entitiesByMbids(batch)).json) : [];
  const standIns = pickStandIns(fromLastfm, known);
  for (const s of standIns)
    cite(provenance, `standIns.${s.entityId}`, {
      source: "lastfm",
      record: lastfm.lastfmArtistUrl(name),
      licence: LICENCES.lastfm,
      method: "qloo_proxy",
      note: `Last.fm match ${s.weight.toFixed(2)}; resolved in Qloo by MusicBrainz ID ${s.mbid}`,
    });

  if (standIns.length >= 3 || !dz) return standIns;
  const related = await deezer.relatedArtists(dz.id, { fetch: f });
  const seen = new Set(standIns.map((s) => s.entityId));
  for (const [i, r] of related.slice(0, DEEZER_LOOKUPS).entries()) {
    const hit = entitiesOf((await qloo.searchArtist(r.name, 3)).json).find((e) => sameName(e.name, r.name));
    if (!hit || seen.has(hit.entity_id)) continue;
    seen.add(hit.entity_id);
    const weight = Math.round((0.9 - i * 0.1) * 100) / 100;
    standIns.push({ entityId: hit.entity_id, name: hit.name, weight, source: "deezer", popularity: hit.popularity ?? undefined });
    cite(provenance, `standIns.${hit.entity_id}`, {
      source: "deezer",
      record: `https://www.deezer.com/artist/${dz.id}`,
      licence: LICENCES.deezer,
      method: "qloo_proxy",
      note: `Deezer related artist #${i + 1}; resolved in Qloo by exact name`,
    });
    if (standIns.length === 5) break;
  }
  return standIns;
}
