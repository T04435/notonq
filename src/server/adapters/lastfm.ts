// Last.fm: similar artists (with MusicBrainz IDs) and listener counts. The API is non-commercial: a caller's own key
// (X-Lastfm-Key) is used when sent, otherwise ours for the hackathon demo. Credit and link are required wherever the
// data shows ("powered by AudioScrobbler"). Any failure (rate limit, outage, bad key) reads as "no Last.fm data".
import { type Fetch, getJson } from "@/server/http";

export type LfSimilar = { name: string; mbid?: string; match: number; url?: string };
export type LfInfo = { name?: string; listeners?: number; playcount?: number; url?: string; tags: string[] };

type LfInfoJson = { artist?: { name?: string; url?: string; stats?: { listeners?: string; playcount?: string }; tags?: { tag?: { name: string }[] | { name: string } } } };

/** Listeners' tags that aren't genres. */
const NOT_GENRE = /^(seen live|favorites?|favourites?|my favorites|under \d+ listeners|\d{2,4}s?)$/i;
/** Where an artist is from isn't its sound: country names and nationalities among the tags ("japan", "japanese"). */
const NATIONALITY = /^(american|british|english|scottish|welsh|irish|australian|canadian|japanese|korean|chinese|french|german|spanish|italian|swedish|norwegian|danish|finnish|dutch|belgian|polish|russian|ukrainian|mexican|brazilian|argentinian|chilean|colombian|portuguese|greek|turkish|indian|indonesian|filipino|thai|vietnamese|new zealand|south african|nigerian|icelandic|austrian|swiss|czech|hungarian|israeli)$/i;
const COUNTRIES = new Set(
  Array.from({ length: 26 * 26 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)))
    .map((code) => {
      try {
        return new Intl.DisplayNames(["en"], { type: "region" }).of(code)?.toLowerCase();
      } catch {
        return undefined;
      }
    })
    .filter((n): n is string => !!n && n.length > 2),
);
const isGenre = (t: string) => !NOT_GENRE.test(t) && !NATIONALITY.test(t) && !COUNTRIES.has(t.toLowerCase());

const infoOf = (json: unknown): LfInfo | null => {
  const a = (json as LfInfoJson | null)?.artist;
  if (!a) return null;
  const raw = a.tags?.tag;
  const tags = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((t) => t.name).filter(isGenre).slice(0, 5);
  return { name: a.name, listeners: num(a.stats?.listeners), playcount: num(a.stats?.playcount), url: a.url, tags };
};

const BASE = "https://ws.audioscrobbler.com/2.0/";
const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));

const call = (method: string, artist: string, apiKey: string, extra: Record<string, string> = {}, f?: Fetch) =>
  getJson(`${BASE}?${new URLSearchParams({ method, artist, api_key: apiKey, format: "json", autocorrect: "1", ...extra })}`, { fetch: f });

export async function artistInfo(artist: string, apiKey: string, { fetch: f }: { fetch?: Fetch } = {}): Promise<LfInfo | null> {
  return infoOf((await call("artist.getinfo", artist, apiKey, {}, f)).json);
}

/** Listener counts by MusicBrainz ID: unlike a name, an ID never picks up a famous namesake's numbers. */
export async function artistInfoByMbid(mbid: string, apiKey: string, { fetch: f }: { fetch?: Fetch } = {}): Promise<LfInfo | null> {
  return infoOf((await getJson(`${BASE}?${new URLSearchParams({ method: "artist.getinfo", mbid, api_key: apiKey, format: "json" })}`, { fetch: f })).json);
}

export async function similarArtists(artist: string, apiKey: string, { fetch: f, limit = 30 }: { fetch?: Fetch; limit?: number } = {}): Promise<LfSimilar[]> {
  const res = await call("artist.getsimilar", artist, apiKey, { limit: String(limit) }, f);
  const list = (res.json as { similarartists?: { artist?: { name: string; mbid?: string; match: string; url?: string }[] } } | null)
    ?.similarartists?.artist;
  return (list ?? []).map((a) => ({ name: a.name, mbid: a.mbid || undefined, match: Number(a.match) || 0, url: a.url }));
}

export type LfSearchHit = { name: string; listeners: number; mbid?: string; url: string };

/** Last.fm's own artist search: catches tiny artists with a handful of listeners. */
export async function searchArtists(artist: string, apiKey: string, { fetch: f, limit = 6 }: { fetch?: Fetch; limit?: number } = {}): Promise<LfSearchHit[]> {
  const res = await getJson(`${BASE}?${new URLSearchParams({ method: "artist.search", artist, api_key: apiKey, format: "json", limit: String(limit) })}`, { fetch: f });
  const list = (res.json as { results?: { artistmatches?: { artist?: { name: string; listeners?: string; mbid?: string; url: string }[] } } } | null)?.results
    ?.artistmatches?.artist;
  return (list ?? []).map((a) => ({ name: a.name, listeners: Number(a.listeners) || 0, mbid: a.mbid || undefined, url: a.url }));
}

export const lastfmArtistUrl = (name: string) => `https://www.last.fm/music/${encodeURIComponent(name).replace(/%20/g, "+")}`;
