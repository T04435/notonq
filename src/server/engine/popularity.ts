// Derived popularity: Qloo gives each stand-in both its own popularity (0–1) and its Last.fm listener count. A least
// squares line through log10(listeners) → popularity on those stand-ins estimates the missing artist's popularity
// from its own listeners. Always labelled as derived, with the sample size and error; never passed off as Qloo's.

export type PopularityFit = { value: number; n: number; rmse: number; slope: number; intercept: number };

export function fitPopularity(points: { listeners: number; popularity: number }[], listeners: number, minPoints = 4): PopularityFit | null {
  const pts = points.filter((p) => p.listeners > 0 && p.popularity >= 0 && p.popularity <= 1);
  if (pts.length < minPoints || !(listeners > 0)) return null;
  const xs = pts.map((p) => Math.log10(p.listeners));
  const ys = pts.map((p) => p.popularity);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
  const intercept = my - slope * mx;
  const rmse = Math.sqrt(xs.reduce((a, x, i) => a + (intercept + slope * x - ys[i]) ** 2, 0) / xs.length);
  const value = Math.min(1, Math.max(0, intercept + slope * Math.log10(listeners)));
  return { value: round(value), n: pts.length, rmse: round(rmse), slope: round(slope), intercept: round(intercept) };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
