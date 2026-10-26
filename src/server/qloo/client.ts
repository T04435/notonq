// Thin Qloo client: the caller's own key, the hackathon host, pacing under the per-key limit (5/s seen; bursts of 4
// still drew 429s, so 3/s with one retry on 429). Responses are returned as Qloo sent them: NotOnQ never rewrites
// Qloo data, it only reads status and the fields it needs (research/01, 05).
import { z } from "zod";
import { type Fetch, getJson, type HttpResult, pacer } from "@/server/http";

export const QLOO_HACKATHON_BASE = "https://hackathon.api.qloo.com";
export const ARTIST = "urn:entity:artist";

/** The slice of a Qloo entity the engine reads. Everything else passes through untouched. */
export const QlooEntity = z.looseObject({
  entity_id: z.string(),
  name: z.string(),
  popularity: z.number().nullish(),
  properties: z.looseObject({ external: z.record(z.string(), z.unknown()).nullish() }).nullish(),
  external: z.record(z.string(), z.unknown()).nullish(),
});
export type QlooEntity = z.infer<typeof QlooEntity>;

/** /search and /entities answer with `results` as a bare array live; the docs show `results.entities`. Accept both. */
export function entitiesOf(json: unknown): QlooEntity[] {
  const r = (json as { results?: unknown } | null)?.results;
  const list = Array.isArray(r) ? r : Array.isArray((r as { entities?: unknown })?.entities) ? (r as { entities: unknown[] }).entities : [];
  return list.flatMap((e) => {
    const parsed = QlooEntity.safeParse(e);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Error text from either shape Qloo uses: `{message}` (404s, docs) or `{errors: [{message, path}]}` (insights 400s, live). */
export function qlooMessage(json: unknown): string | undefined {
  const j = json as { message?: unknown; errors?: { message?: unknown }[] } | null;
  if (typeof j?.message === "string") return j.message;
  const first = Array.isArray(j?.errors) ? j.errors.find((e) => typeof e?.message === "string") : undefined;
  return first ? String(first.message) : undefined;
}

const pacers = new Map<string, ReturnType<typeof pacer>>();

/** Qloo can take well over 15 s on wide heatmaps and tag searches (27 Oct 2026); apps wait about 25 s (GhostQ's
 * client), so NotOnQ waits a little longer than they do and never times out first. */
const QLOO_TIMEOUT_MS = 28_000;

export function qlooClient({ apiKey, baseUrl = QLOO_HACKATHON_BASE, fetch: f }: { apiKey: string; baseUrl?: string; fetch?: Fetch }) {
  const pace = pacers.get(apiKey) ?? pacers.set(apiKey, pacer(340)).get(apiKey)!;

  async function get(path: string, params: Record<string, string | number | undefined>): Promise<HttpResult> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    const url = `${baseUrl}${path}${qs.size ? `?${qs}` : ""}`;
    const call = () => pace(() => getJson(url, { fetch: f, headers: { "X-Api-Key": apiKey }, timeoutMs: QLOO_TIMEOUT_MS }));
    const first = await call();
    return first.status === 429 ? call() : first;
  }

  /** POST with a JSON body (Qloo accepts POST on /v2/insights for array and weighted parameters). */
  async function post(path: string, body: Record<string, unknown>): Promise<HttpResult> {
    const call = () => pace(() => getJson(`${baseUrl}${path}`, { fetch: f, method: "POST", body, headers: { "X-Api-Key": apiKey }, timeoutMs: QLOO_TIMEOUT_MS }));
    const first = await call();
    return first.status === 429 ? call() : first;
  }

  return {
    get,
    post,
    searchArtist: (name: string, take = 5) => get("/search", { query: name, types: ARTIST, take }),
    entitiesByMbids: (mbids: string[]) => get("/entities", { "external.musicbrainz.ids": mbids.join(",") }),
    insights: (params: Record<string, string | number | undefined>) => get("/v2/insights", params),
  };
}

export type QlooClient = ReturnType<typeof qlooClient>;
