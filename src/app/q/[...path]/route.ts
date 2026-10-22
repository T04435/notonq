import { after } from "next/server";
import { env } from "@/server/env";
import { handleRest } from "@/server/rest";
import { db } from "@/server/store/db";

// Drop-in for the Qloo API: point a client (or the official harness via QLOO_BASE_URL + QLOO_TRUSTED_BASE_URL)
// at https://<host>/q and keep sending your own X-Api-Key.
export async function GET(request: Request, ctx: RouteContext<"/q/[...path]">) {
  const { path } = await ctx.params;
  const url = new URL(request.url);
  const out = await handleRest(
    {
      path: path.join("/"),
      params: Object.fromEntries(url.searchParams),
      apiKey: request.headers.get("x-api-key") ?? undefined,
      lastfmKey: request.headers.get("x-lastfm-key") ?? undefined,
      appLabel: request.headers.get("x-notonq-app")?.slice(0, 64) ?? undefined,
    },
    { sql: await db(), baseUrl: env.QLOO_BASE_URL, salt: env.NOTONQ_SALT, defer: after },
  );
  return Response.json(out.body, {
    status: out.status,
    headers: { "Cache-Control": "no-store", "X-NotOnQ-Served-By": out.servedBy },
  });
}
