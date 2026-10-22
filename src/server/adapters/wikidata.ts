// Wikidata (CC0): the crosswalk from a MusicBrainz ID to the Wikidata item, its English Wikipedia page, the Spotify
// artist ID (P1902), an image (P18, a Commons file) and genres (P136). One SPARQL query per artist.
import { type Fetch, getJson } from "@/server/http";

export type WdArtist = {
  qid: string;
  record: string;
  enwiki?: string;
  spotifyId?: string;
  /** Other-service IDs Qloo also returns, from Wikidata (P1902 Spotify, P2013 Facebook, P2003 Instagram, P2002 X/Twitter). */
  ids: { spotify?: string; facebook?: string; instagram?: string; twitter?: string };
  image?: { file: string; url: string; page: string };
  genres: string[];
};

const query = (mbid: string) => `
SELECT ?item ?article ?spotify ?facebook ?instagram ?twitter ?image (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres) WHERE {
  ?item wdt:P434 "${mbid}" .
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  OPTIONAL { ?item wdt:P1902 ?spotify . }
  OPTIONAL { ?item wdt:P2013 ?facebook . }
  OPTIONAL { ?item wdt:P2003 ?instagram . }
  OPTIONAL { ?item wdt:P2002 ?twitter . }
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?item wdt:P136 ?genre . ?genre rdfs:label ?genreLabel . FILTER(LANG(?genreLabel) = "en") }
} GROUP BY ?item ?article ?spotify ?facebook ?instagram ?twitter ?image LIMIT 1`;

type Binding = Record<string, { value: string } | undefined>;

export async function artistByMbid(mbid: string, { fetch: f }: { fetch?: Fetch } = {}): Promise<WdArtist | null> {
  if (!/^[0-9a-f-]{36}$/i.test(mbid)) return null;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query(mbid))}`;
  const res = await getJson(url, { fetch: f, headers: { Accept: "application/sparql-results+json" } });
  const b = (res.json as { results?: { bindings?: Binding[] } } | null)?.results?.bindings?.[0];
  if (!b?.item) return null;
  const qid = b.item.value.split("/").pop()!;
  const imageUrl = b.image?.value;
  const file = imageUrl ? decodeURIComponent(imageUrl.split("/").pop()!) : undefined;
  return {
    qid,
    record: `https://www.wikidata.org/wiki/${qid}`,
    enwiki: b.article ? decodeURIComponent(b.article.value.split("/wiki/")[1] ?? "") || undefined : undefined,
    spotifyId: b.spotify?.value,
    ids: { spotify: b.spotify?.value, facebook: b.facebook?.value, instagram: b.instagram?.value, twitter: b.twitter?.value },
    image:
      imageUrl && file
        ? { file, url: `${imageUrl.replace(/^http:/, "https:")}?width=420`, page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}` }
        : undefined,
    genres: b.genres?.value ? b.genres.value.split("|").filter(Boolean) : [],
  };
}
