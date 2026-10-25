// Artists by era, genre and place (v0.3.0). For a Qloo insights request like filter.type=urn:entity:artist with
// filter.tags=urn:tag:genre:music:60s and signal.location.query=Lagos, which Qloo answers with nothing or little
// (46% of decade/genre × place requests in our 25 Oct run): find artists active then, in that genre, from that
// country, in MusicBrainz; rank them by Last.fm listeners; return the ones Qloo knows as Qloo's own entities and the
// rest labelled and cited. Same request, same response shape; no new endpoint.
import * as lastfm from "@/server/adapters/lastfm";
import * as mb from "@/server/adapters/musicbrainz";
import { genreTag } from "@/server/engine/artist";
import { externalOf } from "@/server/engine/standins";
import type { Fetch } from "@/server/http";
import { cite, LICENCES, type ProvenanceMap } from "@/server/provenance";
import { ARTIST, entitiesOf, type QlooClient, type QlooEntity } from "@/server/qloo/client";

export type MusicTag = { decade?: number; genre?: string };

/** Qloo's music genre tags, read for a decade and/or a genre: "60s", "1950s", "rock_70s", "rock_of_70s", "bolero". */
export function parseMusicTag(tag: string): MusicTag | null {
  const m = /^urn:tag:genre:music:([a-z0-9_]+)$/i.exec(tag.trim());
  if (!m) return null;
  let decade: number | undefined;
  const words: string[] = [];
  for (const token of m[1].toLowerCase().split("_")) {
    const d = /^(\d{2}|\d{4})s$/.exec(token);
    if (d && decade === undefined) {
      const n = Number(d[1]);
      decade = n >= 100 ? n : n >= 30 ? 1900 + n : 2000 + n;
    } else if (token !== "of" && token) words.push(token);
  }
  const genre = words.join(" ") || undefined;
  return decade !== undefined || genre ? { decade, genre } : null;
}

/** The MusicBrainz search for an era: groups active in the decade, people old enough to perform in it (18+). */
export function eraQuery({ decade, genre }: MusicTag, country?: string): string {
  const parts: string[] = [];
  if (genre) parts.push(`tag:"${genre.replace(/"/g, "")}"`);
  if (country) parts.push(`country:${country}`);
  if (decade !== undefined) {
    const last = decade + 9;
    const active = `(end:[${decade} TO *] OR ended:false)`;
    parts.push(`((type:group AND begin:[* TO ${last}] AND ${active}) OR (type:person AND begin:[* TO ${last - 18}] AND ${active}))`);
  } else parts.push("(type:group OR type:person)");
  return parts.join(" AND ");
}

export type EraFill = { entities: unknown[]; provenance: ProvenanceMap; country?: { code: string; name: string }; query: string; known: number };
export type EraDeps = { qloo: QlooClient; lastfmKey?: string; fetch?: Fetch };

const SEARCH = 25;
const RANKED = 15;

export async function fillEra(tag: string, place: string | undefined, take: number, deps: EraDeps): Promise<EraFill> {
  const parsed = parseMusicTag(tag);
  const provenance: ProvenanceMap = {};
  if (!parsed) return { entities: [], provenance, query: "", known: 0 };
  const country = place ? ((await mb.countryOf(place, { fetch: deps.fetch })) ?? undefined) : undefined;
  const query = eraQuery(parsed, country?.code);
  const found = await mb.searchByQuery(query, { fetch: deps.fetch, limit: SEARCH });

  // Popularity: Last.fm listeners for the first few MusicBrainz matches (MusicBrainz order has no popularity), looked
  // up by MBID so a namesake's numbers never count (by name, Australia's Brian May got Queen's guitarist's listeners).
  const listeners = new Map<string, lastfm.LfInfo>();
  if (deps.lastfmKey)
    await Promise.all(
      found.slice(0, RANKED).map(async (a) => {
        const info = await lastfm.artistInfoByMbid(a.mbid, deps.lastfmKey!, { fetch: deps.fetch });
        if (info?.listeners !== undefined) listeners.set(a.mbid, info);
      }),
    );
  const ranked = found.slice(0, RANKED).toSorted((a, b) => (listeners.get(b.mbid)?.listeners ?? -1) - (listeners.get(a.mbid)?.listeners ?? -1));

  // The ones Qloo already knows answer as Qloo's own entities.
  const known = new Map<string, QlooEntity>();
  if (ranked.length) {
    const rows = entitiesOf((await deps.qloo.entitiesByMbids(ranked.map((a) => a.mbid.toLowerCase()))).json);
    for (const a of ranked) {
      const hit = rows.find((r) => externalOf(r, "musicbrainz").some((m) => String(m.id).toLowerCase() === a.mbid.toLowerCase()));
      if (hit) known.set(a.mbid, hit);
    }
  }

  const what = [parsed.decade !== undefined && `${parsed.decade}s`, parsed.genre, "music", country && `from ${country.name}`].filter(Boolean).join(" ");
  // Artists Qloo knows go first, by Qloo's own popularity; the rest follow by Last.fm listeners. (Last.fm sometimes
  // ties a small artist's MBID to a famous namesake's page, so its numbers only order the ones Qloo can't vouch for.)
  const pop = (a: mb.MbArtist) => known.get(a.mbid)?.popularity ?? 0;
  const chosen = [...ranked.filter((a) => known.has(a.mbid)).toSorted((a, b) => pop(b) - pop(a)), ...ranked.filter((a) => !known.has(a.mbid))].slice(0, take);
  const entities = chosen.map((a) => {
    const q = known.get(a.mbid);
    if (q) return q;
    const id = a.mbid.toLowerCase();
    const info = listeners.get(a.mbid);
    const span = [a.begin && `from ${a.begin.slice(0, 4)}`, a.end && `to ${a.end.slice(0, 4)}`].filter(Boolean).join(" ");
    const facts = [a.area, span && `active ${span}`, info?.listeners !== undefined && `${info.listeners.toLocaleString("en")} Last.fm listeners`].filter(Boolean).join("; ");
    cite(provenance, `${id}.name`, { source: "musicbrainz", record: a.record, licence: LICENCES.musicbrainz, method: "copied" });
    cite(provenance, `${id}.selection`, {
      source: "notonq",
      record: a.record,
      licence: LICENCES.notonq,
      method: "derived",
      note: `Chosen for ${tag}${place ? ` in ${place}` : ""}: MusicBrainz search ${query}${info ? ", ranked by Last.fm listeners" : ""}`,
    });
    if (info?.listeners !== undefined)
      cite(provenance, `${id}.properties.external.lastfm`, { source: "lastfm", record: info.url ?? lastfm.lastfmArtistUrl(a.name), licence: LICENCES.lastfm, method: "copied" });
    return {
      entity_id: id,
      name: a.name,
      types: [ARTIST],
      type: "urn:entity",
      subtype: ARTIST,
      ...(a.disambiguation ? { disambiguation: a.disambiguation } : {}),
      properties: {
        akas: [],
        external: { musicbrainz: { id }, ...(info?.listeners !== undefined ? { lastfm: { id: info.name ?? a.name, listeners: info.listeners } } : {}) },
        short_description: `Not in Qloo: found by NotOnQ for ${what}${facts ? ` (MusicBrainz: ${facts})` : ""}.`,
      },
      tags: parsed.genre ? [genreTag(parsed.genre)] : [],
    };
  });
  return { entities, provenance, country, query, known: chosen.filter((a) => known.has(a.mbid)).length };
}
