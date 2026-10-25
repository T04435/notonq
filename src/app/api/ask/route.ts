import { z } from "zod";
import { ask, type AskEvent } from "@/server/agent/ask";
import { env } from "@/server/env";
import { clientIp, limited } from "@/server/rate-limit";

// The Ask playground: one question, answered by Qloo's own harness twice (Qloo alone, and through NotOnQ), streamed
// as newline-delimited JSON events. Our keys and a model call per step, so it is rate-limited per IP.
export const maxDuration = 300;

const Body = z.object({ question: z.string().trim().min(3).max(300) });
const LIMIT = 10;

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ask a question (3 to 300 characters)." }, { status: 400 });
  if (!env.QLOO_API_KEY) return Response.json({ error: "The playground has no Qloo key configured (QLOO_API_KEY)." }, { status: 503 });
  // Our keys are spent per question, so the public site is limited; the local dev server is not.
  if (process.env.NODE_ENV === "production" && limited("ask", clientIp(request), LIMIT)) return Response.json({ error: "Too many questions from your address. Try again within the hour." }, { status: 429 });

  const notonqBase = `${new URL(request.url).origin}/q/app/playground-ask`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AskEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        await ask(parsed.data.question, { qlooKey: env.QLOO_API_KEY!, qlooBase: env.QLOO_BASE_URL, notonqBase, emit });
      } catch (e) {
        emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
      emit({ type: "done" });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
