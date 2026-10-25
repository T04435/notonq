// Hand-made fixtures only (never live responses: Qloo data must not live in a public repo). Fake Qloo IDs all start
// with 4e4f544f ("NOTO") so a CI check can tell them apart from real ones.
import type { Fetch } from "@/server/http";

export const qid = (n: number) => `4e4f544f-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const mbid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch that answers by the first matching URL substring, and records every URL it was asked for. */
export function fakeFetch(routes: [match: string, respond: (url: URL) => Response][]) {
  const calls: string[] = [];
  /** JSON bodies of POST requests, in order. */
  const bodies: unknown[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
    const hit = routes.find(([m]) => url.href.includes(m));
    return hit ? hit[1](url) : json(404, { message: "no fixture" });
  }) as Fetch;
  return { fetch: f, calls, bodies };
}

export const qlooArtist = (n: number, name: string, opts: { popularity?: number; mb?: number; listeners?: number } = {}) => ({
  entity_id: qid(n),
  name,
  types: ["urn:entity:artist"],
  popularity: opts.popularity,
  properties: {
    external: {
      ...(opts.mb !== undefined ? { musicbrainz: { id: mbid(opts.mb) } } : {}),
      ...(opts.listeners !== undefined ? { lastfm: { id: name, listeners: String(opts.listeners), scrobbles: "1" } } : {}),
    },
  },
});
