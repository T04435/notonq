import { after } from "next/server";
import { z } from "zod";
import { env } from "@/server/env";
import { playgroundLookup } from "@/server/playground";
import { QlooBudgetExceeded } from "@/server/qloo/cached";
import { QlooUnavailable } from "@/server/qloo/gap";
import { clientIp, limited } from "@/server/rate-limit";
import { db } from "@/server/store/db";

// The playground's own endpoint: our keys, so it is rate-limited per IP (BotID and a WAF rule join it on Vercel).
const Body = z.object({
  name: z.string().trim().min(1).max(100),
  candidate: z.string().max(120).optional(),
  choose: z.boolean().optional(),
});
const LIMIT = 30;

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Type an artist name (up to 100 characters)." }, { status: 400 });
  if (!env.QLOO_API_KEY) return Response.json({ error: "The playground has no Qloo key configured (QLOO_API_KEY)." }, { status: 503 });
  const ip = clientIp(request);
  if (limited("lookup", ip, LIMIT)) return Response.json({ error: "Too many lookups from your address. Try again within the hour." }, { status: 429 });

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
    if (e instanceof QlooBudgetExceeded) return Response.json({ error: e.message }, { status: 429 });
    if (e instanceof QlooUnavailable) return Response.json({ error: `Qloo didn't answer (HTTP ${e.res.status}). Try again in a moment.` }, { status: 502 });
    throw e;
  }
}
