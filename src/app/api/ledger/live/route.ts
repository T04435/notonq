import { upgradeWebSocket } from "@vercel/functions";
import { connection } from "next/server";
import { join } from "@/server/ledger-hub";

// The live Ledger's WebSocket (a page-internal route; the drop-in API under /q is untouched). Vercel's documented way
// for Next.js: upgradeWebSocket from @vercel/functions, after connection() because the app uses Cache Components.
// Locally it runs under `vc dev` (Vercel CLI 54.14.2 or later), not `next dev`.
export async function GET() {
  await connection();
  return upgradeWebSocket((ws) => join(ws));
}
