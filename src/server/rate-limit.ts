// In-memory per-IP limits for the endpoints that spend our own keys (playground lookups, Ask). Per instance, so a
// soft limit: BotID and a WAF rule back it up on Vercel.
const buckets = new Map<string, number[]>();

export function limited(scope: string, ip: string, limit: number, windowMs = 60 * 60 * 1000) {
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  buckets.set(key, recent);
  return recent.length > limit;
}

export const clientIp = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
