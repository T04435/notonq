// Deezer: keyless artist search, fan counts, pictures and related artists. Its terms allow non-commercial use only
// (https://developers.deezer.com/termsofuse), which fits this tool; credited wherever its data shows. Deezer lists
// very small artists that MusicBrainz and Wikidata don't, which is exactly the long tail NotOnQ is for.
import { type Fetch, getJson } from "@/server/http";

export type DzArtist = { id: number; name: string; fans: number; picture?: string; link: string };

type DzJson = { id: number; name: string; nb_fan?: number; picture_medium?: string; link?: string };

const toArtist = (a: DzJson): DzArtist => ({
  id: a.id,
  name: a.name,
  fans: a.nb_fan ?? 0,
  picture: a.picture_medium && !a.picture_medium.includes("/artist//") ? a.picture_medium : undefined,
  link: a.link ?? `https://www.deezer.com/artist/${a.id}`,
});

export async function searchArtists(name: string, { fetch: f, limit = 6 }: { fetch?: Fetch; limit?: number } = {}): Promise<DzArtist[]> {
  const res = await getJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=${limit}`, { fetch: f });
  return ((res.json as { data?: DzJson[] } | null)?.data ?? []).map(toArtist);
}

export async function getArtist(id: number | string, { fetch: f }: { fetch?: Fetch } = {}): Promise<DzArtist | null> {
  const res = await getJson(`https://api.deezer.com/artist/${id}`, { fetch: f });
  const a = res.json as (DzJson & { error?: unknown }) | null;
  return a && !a.error && a.id ? toArtist(a) : null;
}

export async function relatedArtists(id: number | string, { fetch: f, limit = 10 }: { fetch?: Fetch; limit?: number } = {}): Promise<DzArtist[]> {
  const res = await getJson(`https://api.deezer.com/artist/${id}/related?limit=${limit}`, { fetch: f });
  return ((res.json as { data?: DzJson[] } | null)?.data ?? []).map(toArtist);
}
