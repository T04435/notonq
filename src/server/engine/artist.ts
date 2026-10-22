// Resolve one artist: Qloo first; on a gap, build a Qloo-shaped entity from open sources (tier 2) with provenance on
// every value, and pick the stand-ins Qloo can answer for. Tier 3 (research) and the cache/ledger wrap this later.
import * as lastfm from "@/server/adapters/lastfm";
import * as mb from "@/server/adapters/musicbrainz";
import * as wd from "@/server/adapters/wikidata";
import * as wp from "@/server/adapters/wikipedia";
import type { Fetch } from "@/server/http";
import { cite, LICENCES, type ProvenanceMap } from "@/server/provenance";
import { ARTIST, entitiesOf, type QlooClient, type QlooEntity } from "@/server/qloo/client";
import { type Gap, readInsights, readSearch } from "@/server/qloo/gap";
import { fitPopularity, type PopularityFit } from "@/server/engine/popularity";
import { type Candidate, lookupBatch, pickStandIns, type StandIn } from "@/server/engine/standins";

/** A Qloo-shaped artist entity built only from our own (open) data. */
export type FallbackEntity = {
  entity_id: string;
  name: string;
  types: [typeof ARTIST];
  popularity?: number;
  disambiguation?: string;
  properties: {
    short_description?: string;
    akas?: { value: string; languages: string[] }[];
    image?: { url: string };
    external: {
      musicbrainz?: { id: string };
      wikidata?: { id: string };
      spotify?: { id: string };
      lastfm?: { listeners?: number; scrobbles?: number };
    };
  };
  tags: { name: string; type: "urn:tag:genre:music"; source: string }[];
};

export type ArtistResult =
  | { servedBy: "qloo"; entity: QlooEntity }
  | {
      servedBy: "fallback";
      gap: Gap;
      /** The Qloo entity when Qloo can find the artist but not use it (G2). */
      qlooEntity?: QlooEntity;
      entity: FallbackEntity | null;
      standIns: StandIn[];
      popularity?: PopularityFit;
      provenance: ProvenanceMap;
      unavailable: string[];
    };

export type ResolveDeps = { qloo: QlooClient; lastfmKey?: string; fetch?: Fetch };

export async function resolveArtist(name: string, { qloo, lastfmKey, fetch: f }: ResolveDeps): Promise<ArtistResult> {
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
  return { servedBy: "fallback", gap, qlooEntity, ...(await buildFallback(name, { qloo, lastfmKey, fetch: f })) };
}

export async function buildFallback(name: string, { qloo, lastfmKey, fetch: f }: ResolveDeps) {
  const provenance: ProvenanceMap = {};
  const unavailable: string[] = [];
  const artist = await mb.findArtist(name, { fetch: f });
  const [wiki, info, similar] = await Promise.all([
    artist ? wd.artistByMbid(artist.mbid, { fetch: f }) : null,
    lastfmKey ? lastfm.artistInfo(name, lastfmKey, { fetch: f }) : null,
    lastfmKey ? lastfm.similarArtists(name, lastfmKey, { fetch: f }) : [],
  ]);
  const summary = wiki?.enwiki ? await wp.summary(wiki.enwiki, { fetch: f }) : null;

  // Stand-ins: similar artists with MBIDs → one batch lookup in Qloo.
  const candidates: Candidate[] = similar.flatMap((s) => (s.mbid ? [{ name: s.name, mbid: s.mbid, match: s.match, source: "lastfm" }] : []));
  const batch = lookupBatch(candidates);
  const known = batch.length ? entitiesOf((await qloo.entitiesByMbids(batch)).json) : [];
  const standIns = pickStandIns(candidates, known);
  for (const s of standIns)
    cite(provenance, `standIns.${s.entityId}`, {
      source: "lastfm",
      record: lastfm.lastfmArtistUrl(name),
      licence: LICENCES.lastfm,
      method: "qloo_proxy",
      note: `Last.fm match ${s.weight.toFixed(2)}; resolved in Qloo by MusicBrainz ID ${s.mbid}`,
    });
  if (!lastfmKey) unavailable.push("standIns (no Last.fm key)");
  else if (!standIns.length) unavailable.push("standIns (no similar artist known to Qloo)");

  if (!artist) {
    unavailable.push("entity (no exact MusicBrainz match)");
    return { entity: null, standIns, provenance, unavailable };
  }

  const id = `notonq:mbid:${artist.mbid}`;
  const entity: FallbackEntity = {
    entity_id: id,
    name: artist.name,
    types: [ARTIST],
    disambiguation: [artist.disambiguation, artist.country].filter(Boolean).join(", ") || undefined,
    properties: { external: { musicbrainz: { id: artist.mbid } } },
    tags: [],
  };
  const mbCite = (path: string, note?: string) =>
    cite(provenance, path, { source: "musicbrainz", record: artist.record, licence: LICENCES.musicbrainz, method: "copied", note });
  mbCite("name");
  mbCite("properties.external.musicbrainz");
  if (entity.disambiguation) mbCite("disambiguation");
  if (artist.aliases.length) {
    entity.properties.akas = artist.aliases.map((value) => ({ value, languages: [] }));
    mbCite("properties.akas");
  }

  if (wiki) {
    const wdCite = (path: string) => cite(provenance, path, { source: "wikidata", record: wiki.record, licence: LICENCES.wikidata, method: "copied" });
    entity.properties.external.wikidata = { id: wiki.qid };
    wdCite("properties.external.wikidata");
    if (wiki.spotifyId) {
      entity.properties.external.spotify = { id: wiki.spotifyId };
      wdCite("properties.external.spotify");
    }
    if (wiki.image) {
      entity.properties.image = { url: wiki.image.url };
      cite(provenance, "properties.image", {
        source: "wikimedia-commons",
        record: wiki.image.page,
        licence: "see the Commons file page",
        method: "copied",
      });
    } else unavailable.push("properties.image");
  } else unavailable.push("properties.external.wikidata", "properties.image");

  if (summary) {
    entity.properties.short_description = summary.extract;
    cite(provenance, "properties.short_description", { source: "wikipedia", record: summary.url, licence: LICENCES.wikipedia, method: "copied" });
  } else unavailable.push("properties.short_description");

  const genres = wiki?.genres.length ? { list: wiki.genres, source: "wikidata", record: wiki.record, licence: LICENCES.wikidata } : null;
  if (genres) {
    entity.tags = genres.list.map((g) => ({ name: g, type: "urn:tag:genre:music" as const, source: genres.source }));
    cite(provenance, "tags", { source: genres.source, record: genres.record, licence: genres.licence, method: "copied" });
  } else if (artist.tags.length) {
    // MusicBrainz tags are supplementary data (CC BY-NC-SA): fine for this non-commercial tool, labelled as such.
    entity.tags = artist.tags.map((g) => ({ name: g, type: "urn:tag:genre:music" as const, source: "musicbrainz" }));
    cite(provenance, "tags", { source: "musicbrainz", record: artist.record, licence: "CC-BY-NC-SA-3.0", method: "copied" });
  } else unavailable.push("tags");

  if (info?.listeners !== undefined) {
    entity.properties.external.lastfm = { listeners: info.listeners, scrobbles: info.playcount };
    cite(provenance, "properties.external.lastfm", {
      source: "lastfm",
      record: info.url ?? lastfm.lastfmArtistUrl(name),
      licence: LICENCES.lastfm,
      method: "copied",
    });
  }

  const points = standIns.flatMap((s) => (s.listeners !== undefined && s.popularity !== undefined ? [{ listeners: s.listeners, popularity: s.popularity }] : []));
  const popularity = info?.listeners ? fitPopularity(points, info.listeners) ?? undefined : undefined;
  if (popularity) {
    entity.popularity = popularity.value;
    cite(provenance, "popularity", {
      source: "notonq",
      record: `stand-ins: ${standIns.map((s) => s.entityId).join(",")}`,
      licence: LICENCES.notonq,
      method: "derived",
      note: `log10(Last.fm listeners) → Qloo popularity, fitted on ${popularity.n} stand-ins, rmse ${popularity.rmse}`,
    });
  } else unavailable.push("popularity");

  return { entity, standIns, popularity, provenance, unavailable };
}
