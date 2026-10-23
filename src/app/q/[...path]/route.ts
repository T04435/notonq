import { after } from "next/server";
import { env } from "@/server/env";
import { handleRest } from "@/server/rest";
import { db } from "@/server/store/db";

// Drop-in for the Qloo API: point a client (or the official harness via QLOO_BASE_URL + QLOO_TRUSTED_BASE_URL)
// at https://<host>/q and keep sending your own X-Api-Key. A client that can't add headers (the harness) names its app
// in the base URL instead: https://<host>/q/app/<label>.
export async function GET(request: Request, ctx: RouteContext<"/q/[...path]">) {
  return handle(request, ctx);
}

/** POST with a JSON body, as Qloo accepts on /v2/insights (array and weighted parameters). */
export async function POST(request: Request, ctx: RouteContext<"/q/[...path]">) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ message: "Body must be a JSON object" }, { status: 400 });
  return handle(request, ctx, body as Record<string, unknown>);
}

async function handle(request: Request, ctx: RouteContext<"/q/[...path]">, body?: Record<string, unknown>) {
  const { path: segments } = await ctx.params;
  const [first, label, ...rest] = segments;
  const fromPath = first === "app" && label ? label : undefined;
  const path = fromPath ? rest : segments;
  const url = new URL(request.url);
  const out = await handleRest(
    {
      path: path.join("/"),
      params: Object.fromEntries(url.searchParams),
      apiKey: request.headers.get("x-api-key") ?? undefined,
      // The caller's own Last.fm key if sent; otherwise ours (for the hackathon demo, non-Qloo keys are NotOnQ's).
      lastfmKey: request.headers.get("x-lastfm-key") ?? env.LASTFM_API_KEY,
      appLabel: (request.headers.get("x-notonq-app") ?? fromPath)?.slice(0, 64) || undefined,
      body,
    },
    { sql: await db(), baseUrl: env.QLOO_BASE_URL, salt: env.NOTONQ_SALT, defer: after },
  );
  return Response.json(out.body, {
    status: out.status,
    headers: { "Cache-Control": "no-store", "X-NotOnQ-Served-By": out.servedBy },
  });
}
