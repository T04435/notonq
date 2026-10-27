import { connection } from "next/server";
import { sealLatestChange } from "@/server/realtime";

// The live Ledger's Neon Realtime capability (a page-internal route; the drop-in API under /q is untouched): the
// Realtime URL and a sealed query for the newest visit change, valid 60 s; the page renews it before it expires.
// 204 where Realtime isn't set up (no NEON_REALTIME_URL and secret), and the page says live updates are unavailable.
export async function GET() {
  await connection();
  const live = await sealLatestChange();
  return live ? Response.json(live, { headers: { "Cache-Control": "no-store" } }) : new Response(null, { status: 204 });
}
