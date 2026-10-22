// MusicBrainz: identity for an artist (CC0 core data). 1 request per second and a real User-Agent, per their API rules.
import { z } from "zod";
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
};

export const mbArtistUrl = (mbid: string) => `https://musicbrainz.org/artist/${mbid}`;

// MusicBrainz answers 503 when its global rate limit trips; one paced retry clears it in practice.
async function call(url: string, f?: Fetch) {
  const once = () => pace(() => getJson(url, { fetch: f }));
  const first = await once();
  return first.status === 503 ? once() : first;
}

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
});

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
