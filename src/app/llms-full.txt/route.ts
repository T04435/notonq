import { LLMS_FULL, withOrigin } from "@/server/llms";

// llms-full.txt: the whole reference in one markdown file, for agents.
export function GET(request: Request) {
  return new Response(withOrigin(LLMS_FULL, new URL(request.url).origin), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
