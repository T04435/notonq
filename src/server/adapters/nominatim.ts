// OpenStreetMap Nominatim: the place at a point, for requests that give a location as coordinates (POINT or POLYGON)
// rather than a name, and the country of a place name MusicBrainz couldn't place. Their usage policy asks for 1 request per second, a real User-Agent and caching; NotOnQ caches
// each answer (see rest.ts placeOf). Data © OpenStreetMap contributors, ODbL.
import { SourceError } from "@/server/adapters/wikidata";
import { type Fetch, getJson, pacer } from "@/server/http";

const pace = pacer(1100);

export type PointPlace = { city?: string; country?: string; countryCode?: string; record: string };

export async function reverse(lat: number, lon: number, { fetch: f }: { fetch?: Fetch } = {}): Promise<PointPlace | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10&accept-language=en`;
  const res = await pace(() => getJson(url, { fetch: f }));
  const a = (res.json as { address?: Record<string, string>; osm_type?: string; osm_id?: number } | null)?.address;
  if (!res.ok || !a?.country) return null;
  const j = res.json as { osm_type?: string; osm_id?: number };
  return {
    city: a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state,
    country: a.country,
    countryCode: a.country_code?.toUpperCase(),
    record: j.osm_type && j.osm_id ? `https://www.openstreetmap.org/${j.osm_type}/${j.osm_id}` : url,
  };
}

/** The country of a place name ("Sevilla, España"): null when OpenStreetMap has no such place; throws SourceError when
 * Nominatim didn't answer. */
export async function countryOfName(place: string, { fetch: f }: { fetch?: Fetch } = {}): Promise<{ code: string; name: string; record: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=jsonv2&addressdetails=1&limit=1&accept-language=en`;
  const res = await pace(() => getJson(url, { fetch: f }));
  if (res.status === 0 || res.status >= 500) throw new SourceError(`Nominatim ${res.status || res.error || "no answer"}`);
  const hit = Array.isArray(res.json) ? (res.json[0] as { address?: Record<string, string>; osm_type?: string; osm_id?: number } | undefined) : undefined;
  const a = hit?.address;
  if (!res.ok || !hit || !a?.country || !a.country_code) return null;
  return {
    code: a.country_code.toUpperCase(),
    name: a.country,
    record: hit.osm_type && hit.osm_id ? `https://www.openstreetmap.org/${hit.osm_type}/${hit.osm_id}` : url,
  };
}
