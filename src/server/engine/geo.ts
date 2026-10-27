// Locations given as WKT (Qloo's signal.location / filter.location: POINT(lon lat) or POLYGON((lon lat, …))) as one
// point to look up. An area too wide to be one place (a continent, the whole world) gives none.

/** Widest polygon, in degrees of longitude or latitude, still read as one place. */
export const MAX_SPAN_DEG = 20;

export function pointOf(wkt: string): { lat: number; lon: number } | null {
  const nums = [...wkt.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map((m) => ({ lon: Number(m[1]), lat: Number(m[2]) }));
  if (!nums.length || !/^\s*(POINT|POLYGON|MULTIPOLYGON)\b/i.test(wkt)) return null;
  const lons = nums.map((p) => p.lon);
  const lats = nums.map((p) => p.lat);
  if (Math.max(...lons) - Math.min(...lons) > MAX_SPAN_DEG || Math.max(...lats) - Math.min(...lats) > MAX_SPAN_DEG) return null;
  const mid = (xs: number[]) => (Math.min(...xs) + Math.max(...xs)) / 2;
  const ok = (p: { lat: number; lon: number }) => Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
  const p = { lat: Math.round(mid(lats) * 100) / 100, lon: Math.round(mid(lons) * 100) / 100 };
  return ok(p) ? p : null;
}

/** A space inside a POINT or POLYGON can reach NotOnQ as a literal "+" (a proxy re-encoding a form-encoded space: seen
 * under \`vc dev\`, 27 Oct). "+" is never valid in WKT, so it is a space again before Qloo sees it (Qloo answers 400). */
export const wktSpaces = (params: Record<string, string>) =>
  Object.fromEntries(Object.entries(params).map(([k, v]) => [k, /^\s*(POINT|POLYGON|MULTIPOLYGON)\s*\(/i.test(v) ? v.replace(/\+/g, " ") : v]));
