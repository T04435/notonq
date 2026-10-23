// Wikipedia summaries (CC BY-SA 4.0: shown with a link and the licence) and Wikimedia pageviews (CC0), the open
// popularity and trending input for any artist with an English Wikipedia page.
import { SourceError } from "@/server/adapters/wikidata";
import { type Fetch, getJson } from "@/server/http";

export type WpSummary = { extract: string; url: string };

export async function summary(title: string, { fetch: f }: { fetch?: Fetch } = {}): Promise<WpSummary | null> {
  const once = () => getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { fetch: f });
  const first = await once();
  // One retry on a transient failure (timeout, rate limit, 5xx); a 404 is a real "no page".
  const res = first.ok || first.status === 404 ? first : await new Promise((r) => setTimeout(r, 800)).then(once);
  if (!res.ok && res.status !== 404) throw new SourceError(`Wikipedia HTTP ${res.status}`);
  const j = res.json as { type?: string; extract?: string; content_urls?: { desktop?: { page?: string } } } | null;
  if (!res.ok || !j?.extract || j.type === "disambiguation") return null;
  return { extract: j.extract, url: j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` };
}

export type DailyViews = { date: string; views: number }[];

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

export const pageviewsUrl = (title: string, start: Date, end: Date) =>
  `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title)}/daily/${ymd(start)}00/${ymd(end)}00`;

export async function dailyViews(title: string, start: Date, end: Date, { fetch: f }: { fetch?: Fetch } = {}): Promise<DailyViews> {
  const res = await getJson(pageviewsUrl(title, start, end), { fetch: f });
  const items = (res.json as { items?: { timestamp: string; views: number }[] } | null)?.items ?? [];
  return items.map((i) => ({ date: `${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}-${i.timestamp.slice(6, 8)}`, views: i.views }));
}
