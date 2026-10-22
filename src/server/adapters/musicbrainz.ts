// MusicBrainz: identity for an artist (CC0 core data). 1 request per second and a real User-Agent, per their API rules.
import { z } from "zod";
import { type Fetch, getJson, pacer } from "@/server/http";
import { sameName } from "@/server/qloo/gap";

const pace = pacer(1100);

const MbArtist = z.looseObject({
  id: z.string(),
  name: z.string(),
  score: z.number().optional(),
  type: z.string().nullish(),
  country: z.string().nullish(),
  disambiguation: z.string().nullish(),
  aliases: z.array(z.looseObject({ name: z.string() })).nullish(),
  tags: z.array(z.looseObject({ name: z.string(), count: z.number().optional() })).nullish(),
});

export type MbArtist = {
  mbid: string;
  name: string;
  type?: string;
  country?: string;
  disambiguation?: string;
  aliases: string[];
  tags: string[];
  record: string;
};

export const mbArtistUrl = (mbid: string) => `https://musicbrainz.org/artist/${mbid}`;

/** The best exact-name match, or null. MusicBrainz's own score must be ≥ 90 so we never adopt a lookalike. */
export async function findArtist(name: string, { fetch: f }: { fetch?: Fetch } = {}): Promise<MbArtist | null> {
  const q = encodeURIComponent(`artist:"${name.replace(/"/g, "")}"`);
  const call = () => pace(() => getJson(`https://musicbrainz.org/ws/2/artist?query=${q}&fmt=json&limit=5`, { fetch: f }));
  // MusicBrainz answers 503 when its global rate limit trips; one paced retry clears it in practice.
  const first = await call();
  const res = first.status === 503 ? await call() : first;
  const list = z.object({ artists: z.array(MbArtist) }).safeParse(res.json);
  if (!list.success) return null;
  const hit = list.data.artists.find(
    (a) => (a.score ?? 0) >= 90 && (sameName(a.name, name) || (a.aliases ?? []).some((al) => sameName(al.name, name))),
  );
  if (!hit) return null;
  return {
    mbid: hit.id,
    name: hit.name,
    type: hit.type ?? undefined,
    country: hit.country ?? undefined,
    disambiguation: hit.disambiguation || undefined,
    aliases: [...new Set((hit.aliases ?? []).map((a) => a.name).filter((n) => n !== hit.name))],
    tags: (hit.tags ?? [])
      .toSorted((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, 8)
      .map((t) => t.name),
    record: mbArtistUrl(hit.id),
  };
}
