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
