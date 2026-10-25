import { after } from "next/server";
import { env } from "@/server/env";
import { handleRest } from "@/server/rest";
import { hashCaller } from "@/server/service";
import { shorten, withoutQlooData } from "@/server/shorten";
import { saveRun } from "@/server/store/repo";
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
  const started = Date.now();
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
  // Every request is recorded for the Ledger's replay (the request without its key, and the response, cut for reading).
  // The Ask page's own calls are part of its run, recorded there, so they are not recorded twice.
  const appLabel = (request.headers.get("x-notonq-app") ?? fromPath)?.slice(0, 64) || undefined;
  const apiKey = request.headers.get("x-api-key");
  if (apiKey && !appLabel?.startsWith("playground-")) {
    const ms = Date.now() - started;
    const title = `${request.method} /q/${path.join("/")}${url.search ? `?${decodeURIComponent(url.searchParams.toString())}` : ""}`;
    after(async () =>
      saveRun(await db(), {
        id: crypto.randomUUID(),
        kind: "api",
        title,
        summary: `${out.status} · ${out.servedBy}`,
        servedBy: out.servedBy,
        appLabel,
        callerHash: hashCaller(apiKey, env.NOTONQ_SALT),
        ms,
        events: [
          { t: 0, type: "request", method: request.method, path: `/q/${path.join("/")}`, params: Object.fromEntries(url.searchParams), body: body ?? null },
          { t: ms, type: "response", status: out.status, servedBy: out.servedBy, body: shorten(withoutQlooData(out.body)) as never },
        ],
      }),
    );
  }
  return Response.json(out.body, {
    status: out.status,
    headers: { "Cache-Control": "no-store", "X-NotOnQ-Served-By": out.servedBy },
  });
}
