// One fetch helper for every source: timeout, User-Agent, JSON parse, timing. The fetch is injectable so the engine
// is tested against hand-made fixtures, never live responses.

export type Fetch = typeof fetch;

export type HttpResult = {
  status: number;
  ok: boolean;
  json: unknown;
  ms: number;
  url: string;
  error?: string;
};

export const USER_AGENT = "NotOnQ/0.1 (+https://github.com/T04435/notonq)";

export async function getJson(
  url: string,
  { fetch: f = fetch, headers = {}, timeoutMs = 15_000 }: { fetch?: Fetch; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<HttpResult> {
  const started = Date.now();
  try {
    const res = await f(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, ok: res.ok, json, ms: Date.now() - started, url };
  } catch (e) {
    return { status: 0, ok: false, json: null, ms: Date.now() - started, url, error: String(e) };
  }
}

/** Serialises calls so a source never sees more than one request per `gapMs` (MusicBrainz asks for 1 per second). */
export function pacer(gapMs: number) {
  let next = 0;
  return async <T>(task: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + gapMs;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return task();
  };
}
