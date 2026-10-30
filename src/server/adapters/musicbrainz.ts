// MusicBrainz: identity for an artist (CC0 core data). 1 request per second and a real User-Agent, per their API rules.
import { z } from "zod";
import { SourceError } from "@/server/adapters/wikidata";
import { type Fetch, getJson, pacer } from "@/server/http";
import { sameName } from "@/server/qloo/gap";

const pace = pacer(1100);

const MbArtistJson = z.looseObject({
  id: z.string(),
  name: z.string(),
  score: z.number().optional(),
  type: z.string().nullish(),
  country: z.string().nullish(),
  disambiguation: z.string().nullish(),
  aliases: z.array(z.looseObject({ name: z.string() })).nullish(),
  tags: z.array(z.looseObject({ name: z.string(), count: z.number().optional() })).nullish(),
  "life-span": z.looseObject({ begin: z.string().nullish(), end: z.string().nullish() }).nullish(),
  area: z.looseObject({ name: z.string() }).nullish(),
  "begin-area": z.looseObject({ name: z.string() }).nullish(),
});
type MbArtistJson = z.infer<typeof MbArtistJson>;

export type MbArtist = {
  mbid: string;
  name: string;
  score?: number;
  type?: string;
  country?: string;
  disambiguation?: string;
  aliases: string[];
  tags: string[];
  record: string;
  begin?: string;
  end?: string;
  area?: string;
  /** Where the artist started (a city, for most): MusicBrainz's begin area. */
  beginArea?: string;
};

export const mbArtistUrl = (mbid: string) => `https://musicbrainz.org/artist/${mbid}`;

// MusicBrainz answers 503 when its global rate limit trips; one paced retry clears it in practice.
async function call(url: string, f?: Fetch) {
  const once = () => pace(() => getJson(url, { fetch: f }));
  const first = await once();
  return first.status === 503 ? once() : first;
}

/** MusicBrainz didn't answer (still busy after the retry, timeout, 5xx): not the same as "nothing found". */
const answered = (res: Awaited<ReturnType<typeof call>>) => {
  if (res.status === 0 || res.status >= 500) throw new SourceError(`MusicBrainz ${res.status || res.error || "no answer"}`);
  return res;
};

const toArtist = (a: MbArtistJson): MbArtist => ({
  mbid: a.id,
  name: a.name,
  score: a.score,
  type: a.type ?? undefined,
  country: a.country ?? undefined,
  disambiguation: a.disambiguation || undefined,
  aliases: [...new Set((a.aliases ?? []).map((al) => al.name).filter((n) => n !== a.name))],
  tags: (a.tags ?? [])
    .toSorted((x, y) => (y.count ?? 0) - (x.count ?? 0))
    .slice(0, 8)
    .map((t) => t.name),
  record: mbArtistUrl(a.id),
  begin: a["life-span"]?.begin ?? undefined,
  end: a["life-span"]?.end ?? undefined,
  area: a.area?.name ?? undefined,
  beginArea: a["begin-area"]?.name ?? undefined,
});

/** A raw Lucene artist search (fields like tag:, country:, begin:, end:, type:), in MusicBrainz's own order. Throws
 * SourceError when MusicBrainz didn't answer. */
export async function searchByQuery(query: string, { fetch: f, limit = 25 }: { fetch?: Fetch; limit?: number } = {}): Promise<MbArtist[]> {
  const res = answered(await call(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`, f));
  const list = z.object({ artists: z.array(MbArtistJson) }).safeParse(res.json);
  return list.success ? list.data.artists.map(toArtist) : [];
}

const MbAreaJson = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string().nullish(),
  "iso-3166-1-codes": z.array(z.string()).nullish(),
  relations: z.array(z.looseObject({ type: z.string(), direction: z.string(), area: z.looseObject({ id: z.string(), name: z.string() }).nullish() })).nullish(),
});

/** The country a place is in, as MusicBrainz's ISO code and name: climbs "part of" from a city or region (a few hops).
 * null when MusicBrainz has no such place; throws SourceError when it didn't answer. */
export async function countryOf(place: string, { fetch: f }: { fetch?: Fetch } = {}): Promise<{ code: string; name: string } | null> {
  const found = answered(await call(`https://musicbrainz.org/ws/2/area?query=${encodeURIComponent(place.replace(/"/g, ""))}&fmt=json&limit=1`, f));
  let id = z.object({ areas: z.array(MbAreaJson) }).safeParse(found.json).data?.areas[0]?.id;
  for (let hop = 0; id && hop < 5; hop++) {
    const res = answered(await call(`https://musicbrainz.org/ws/2/area/${id}?inc=area-rels&fmt=json`, f));
    const area = MbAreaJson.safeParse(res.json).data;
    if (!area) return null;
    const code = area["iso-3166-1-codes"]?.[0];
    if (code) return { code, name: area.name };
    id = area.relations?.find((r) => r.type === "part of" && r.direction === "backward")?.area?.id;
  }
  return null;
}

/** Everything MusicBrainz thinks could be this name, best first (exact names and near misses). */
export async function searchArtists(name: string, { fetch: f, limit = 8 }: { fetch?: Fetch; limit?: number } = {}): Promise<MbArtist[]> {
  const res = await call(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(name.replace(/"/g, ""))}&fmt=json&limit=${limit}`, f);
  const list = z.object({ artists: z.array(MbArtistJson) }).safeParse(res.json);
  return list.success ? list.data.artists.map(toArtist) : [];
}

export const isExactMb = (a: MbArtist, name: string) => (a.score ?? 0) >= 90 && (sameName(a.name, name) || a.aliases.some((al) => sameName(al, name)));

/** The single confident exact-name match, or null. MusicBrainz's own score must be ≥ 90 so we never adopt a lookalike. */
export async function findArtist(name: string, opts: { fetch?: Fetch } = {}): Promise<MbArtist | null> {
  return (await searchArtists(name, opts)).find((a) => isExactMb(a, name)) ?? null;
}

/** One artist by MBID, with aliases and tags. */
export async function getArtist(mbid: string, { fetch: f }: { fetch?: Fetch } = {}): Promise<MbArtist | null> {
  if (!/^[0-9a-f-]{36}$/i.test(mbid)) return null;
  const res = await call(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=aliases+tags&fmt=json`, f);
  const a = MbArtistJson.safeParse(res.json);
  return a.success ? toArtist(a.data) : null;
}

const MbUrlJson = z.looseObject({ relations: z.array(z.looseObject({ artist: z.looseObject({ id: z.string(), name: z.string() }).nullish() })).nullish() });

/** The artist MusicBrainz links to a page (e.g. a Spotify artist URL), from its URL relations. One artist only:
 * a page linked to several artists is no identity. */
export async function artistForUrl(url: string, { fetch: f }: { fetch?: Fetch } = {}): Promise<{ mbid: string; name: string } | null> {
  const res = await call(`https://musicbrainz.org/ws/2/url?resource=${encodeURIComponent(url)}&inc=artist-rels&fmt=json`, f);
  const artists = [...new Map((MbUrlJson.safeParse(res.json).data?.relations ?? []).flatMap((r) => (r.artist ? [[r.artist.id, r.artist] as const] : []))).values()];
  return artists.length === 1 ? { mbid: artists[0].id, name: artists[0].name } : null;
}

const MbDetailsJson = MbArtistJson.extend({
  genres: z.array(z.looseObject({ name: z.string(), count: z.number().optional() })).nullish(),
  relations: z.array(z.looseObject({ type: z.string(), url: z.looseObject({ resource: z.string() }).nullish() })).nullish(),
});

/** One artist by MBID with what Qloo's records can lack: its Wikidata item (from the URL relations) and genres. */
export async function artistDetails(mbid: string, { fetch: f }: { fetch?: Fetch } = {}): Promise<(MbArtist & { wikidata?: string; genres: string[] }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(mbid)) return null;
  const res = await call(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=aliases+tags+genres+url-rels&fmt=json`, f);
  const a = MbDetailsJson.safeParse(res.json);
  if (!a.success) return null;
  const wikidata = a.data.relations?.map((r) => /wikidata\.org\/wiki\/(Q\d+)$/.exec(r.url?.resource ?? "")?.[1]).find(Boolean);
  const genres = (a.data.genres ?? []).toSorted((x, y) => (y.count ?? 0) - (x.count ?? 0)).map((g) => g.name).slice(0, 6);
  return { ...toArtist(a.data), ...(wikidata ? { wikidata } : {}), genres };
}

const MbReleasesJson = z.looseObject({ releases: z.array(z.looseObject({ "text-representation": z.looseObject({ language: z.string().nullish() }).nullish() })) });

/** The languages an artist's releases are written in (MusicBrainz's text representation, ISO 639-3), most used first. */
export async function releaseLanguages(mbid: string, { fetch: f }: { fetch?: Fetch } = {}): Promise<{ code: string; releases: number }[]> {
  if (!/^[0-9a-f-]{36}$/i.test(mbid)) return [];
  const res = await call(`https://musicbrainz.org/ws/2/release?artist=${mbid}&limit=100&fmt=json`, f);
  const counts = new Map<string, number>();
  for (const r of MbReleasesJson.safeParse(res.json).data?.releases ?? []) {
    const code = r["text-representation"]?.language;
    if (code && code !== "zxx" && code !== "mul") counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].map(([code, releases]) => ({ code, releases })).toSorted((a, b) => b.releases - a.releases);
}

// ISO 639-3 (MusicBrainz) to the 639-1 codes Intl names; anything else keeps its own code as its name.
const ISO1: Record<string, string> = {
  eng: "en", jpn: "ja", spa: "es", fra: "fr", deu: "de", por: "pt", ita: "it", kor: "ko", zho: "zh", rus: "ru", nld: "nl", swe: "sv",
  nor: "no", dan: "da", fin: "fi", pol: "pl", tur: "tr", ara: "ar", hin: "hi", ind: "id", tha: "th", vie: "vi", ukr: "uk", ces: "cs",
  ell: "el", heb: "he", hun: "hu", ron: "ro", cat: "ca", gle: "ga", cym: "cy", isl: "is", est: "et", lav: "lv", lit: "lt", tgl: "tl",
};
export const languageName = (code: string) => (ISO1[code] ? (new Intl.DisplayNames(["en"], { type: "language" }).of(ISO1[code]) ?? code) : code);
