import { connection, type NextRequest } from "next/server";
import { parseLedgerParams } from "@/lib/ledger-params";
import { db } from "@/server/store/db";
import { ledgerChanges } from "@/server/store/visits";

// What changed in the Ledger since a moment, for one view (its URL state): asked by the page each time Neon Realtime
// says a visit changed. Same filters as the server render, so a pushed row is exactly a row the page would show.
export async function GET(request: NextRequest) {
  await connection();
  const search = request.nextUrl.searchParams;
  const since = search.get("since");
  if (!since || Number.isNaN(Date.parse(since))) return Response.json({ error: "since (ISO time) is required" }, { status: 400 });
  const body = await ledgerChanges(await db(), parseLedgerParams(search), new Date(since).toISOString());
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
