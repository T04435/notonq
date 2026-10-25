import { LLMS_TXT, withOrigin } from "@/server/llms";

// llms.txt: the index agents read first (llmstxt.org).
export function GET(request: Request) {
  return new Response(withOrigin(LLMS_TXT, new URL(request.url).origin), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
