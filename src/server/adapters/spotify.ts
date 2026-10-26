// Spotify: only the public oEmbed endpoint (no key, no account): the artist's name for a Spotify artist ID, for apps
// that hold Spotify IDs. Nothing else from Spotify is stored or shown.
import { type Fetch, getJson } from "@/server/http";

export const spotifyArtistUrl = (id: string) => `https://open.spotify.com/artist/${id}`;
export const isSpotifyId = (id: string) => /^[0-9A-Za-z]{22}$/.test(id);

export async function artistName(id: string, { fetch: f }: { fetch?: Fetch } = {}): Promise<string | null> {
  if (!isSpotifyId(id)) return null;
  const res = await getJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyArtistUrl(id))}`, { fetch: f });
  const j = res.json as { title?: string; html?: string } | null;
  const name = j?.title?.trim() || /title="Spotify Embed: ([^"]+)"/.exec(j?.html ?? "")?.[1]?.trim();
  return res.ok && name ? name : null;
}
