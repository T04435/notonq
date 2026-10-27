import { z } from "zod";
import { after } from "next/server";
import { ask, type AskEvent } from "@/server/agent/ask";
import { env } from "@/server/env";
import { clientIp, limited } from "@/server/rate-limit";
import { hashCaller } from "@/server/service";
import { db } from "@/server/store/db";
import { BENCHMARK_APPS } from "@/lib/benchmark";
import { type RunEvent, saveRun } from "@/server/store/repo";

// The Ask playground: one question, answered by Qloo's own harness twice (Qloo alone, and through NotOnQ), streamed
// as newline-delimited JSON events. Our keys and a model call per step, so it is rate-limited per IP.
export const maxDuration = 300;

const Body = z.object({ question: z.string().trim().min(3).max(300), app: z.enum(BENCHMARK_APPS).optional() });
const LIMIT = 10;

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ask a question (3 to 300 characters)." }, { status: 400 });
  // The benchmark batch labels its runs (and the harness calls behind them) so Proof can count them apart from real
  // traffic; only a caller holding NOTONQ_BENCHMARK_TOKEN may.
  const app = parsed.data.app;
  const benchmark = !!app && !!env.NOTONQ_BENCHMARK_TOKEN && request.headers.get("x-notonq-benchmark") === env.NOTONQ_BENCHMARK_TOKEN;
  if (app && !benchmark) return Response.json({ error: "Only the benchmark batch can label a run." }, { status: 403 });
  if (!env.QLOO_API_KEY) return Response.json({ error: "The playground has no Qloo key configured (QLOO_API_KEY)." }, { status: 503 });
  // Our keys are spent per question, so the public site is limited; the local dev server is not.
  if (process.env.NODE_ENV === "production" && !benchmark && limited("ask", clientIp(request), LIMIT)) return Response.json({ error: "Too many questions from your address. Try again within the hour." }, { status: 429 });

  const notonqBase = `${new URL(request.url).origin}/q/app/${app ?? "playground-ask"}`;
  const encoder = new TextEncoder();
  // Every step is also recorded, with its time, so the Ledger can replay this run as it happened. The events arrive
  // already redacted (redactEvent): Qloo's own data is never streamed or stored.
  const started = Date.now();
  const recorded: RunEvent[] = [];
  const caller = hashCaller(`ask:${clientIp(request)}`, env.NOTONQ_SALT);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AskEvent) => {
        recorded.push({ t: Date.now() - started, ...e });
        controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      };
      try {
        await ask(parsed.data.question, { qlooKey: env.QLOO_API_KEY!, qlooBase: env.QLOO_BASE_URL, notonqBase, emit });
      } catch (e) {
        emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
      emit({ type: "done" });
      controller.close();
      after(async () => {
        const answer = recorded.findLast((e) => e.type === "answer" && e.column === "notonq") as { text?: string; source?: string } | undefined;
        const summary = (recorded.find((e) => e.type === "reconcile") as { summary?: string } | undefined)?.summary ?? answer?.text;
        await saveRun(await db(), { id: crypto.randomUUID(), kind: "ask", title: parsed.data.question, subject: parsed.data.question, summary, servedBy: answer?.source, appLabel: app ?? "ask", callerHash: caller, events: recorded, ms: Date.now() - started });
      });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
