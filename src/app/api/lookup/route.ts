import { after } from "next/server";
import { z } from "zod";
import { env } from "@/server/env";
import { playgroundLookup } from "@/server/playground";
import { QlooUnavailable } from "@/server/qloo/gap";
import { db } from "@/server/store/db";

// The playground's own endpoint: our keys, so it is rate-limited per IP (BotID and a WAF rule join it on Vercel).
const Body = z.object({
  name: z.string().trim().min(1).max(100),
  candidate: z.string().max(120).optional(),
  choose: z.boolean().optional(),
});
const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 30;
const hits = new Map<string, number[]>();

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Type an artist name (up to 100 characters)." }, { status: 400 });
  if (!env.QLOO_API_KEY) return Response.json({ error: "The playground has no Qloo key configured (QLOO_API_KEY)." }, { status: 503 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) return Response.json({ error: "Too many lookups from your address. Try again within the hour." }, { status: 429 });

  try {
    const view = await playgroundLookup(parsed.data.name, {
      sql: await db(),
      apiKey: env.QLOO_API_KEY,
      lastfmKey: env.LASTFM_API_KEY,
      baseUrl: env.QLOO_BASE_URL,
      salt: env.NOTONQ_SALT,
      defer: after,
    }, { candidateKey: parsed.data.candidate, choose: parsed.data.choose });
    return Response.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof QlooUnavailable) return Response.json({ error: `Qloo didn't answer (HTTP ${e.res.status}). Try again in a moment.` }, { status: 502 });
    throw e;
  }
}
