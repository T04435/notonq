// The live Ledger's trigger: Neon Realtime. The browser subscribes (through Neon's own WebSocket, not ours) to one tiny
// live query, the newest change to any visit. Neon pushes it the moment a call is recorded, from any instance, and the
// page then asks /api/ledger/changes for just what changed. Nothing polls, and open pages don't keep the database awake.
// Needs NEON_REALTIME_URL and NEON_REALTIME_SECRET from the branch's Realtime settings; without them the Ledger shows
// what it rendered until the page reloads.
import "server-only";
import { createRealtime, rawSql } from "@neon/realtime/server";
import type { SealedLiveQuery } from "@neon/realtime/client";

export type LatestChange = { id: string; last_at: string };

let realtime: ReturnType<typeof createRealtime> | undefined;

/** A short-lived (60 s) capability for the newest-change query and the Realtime URL, or null where Realtime isn't set up. */
export async function sealLatestChange(): Promise<{ url: string; query: SealedLiveQuery<LatestChange> } | null> {
  const { NEON_REALTIME_URL: url, NEON_REALTIME_SECRET: secret } = process.env;
  if (!url || !secret) return null;
  realtime ??= createRealtime({ secret, db: process.env.PGDATABASE ?? "neondb" });
  const query = await realtime.seal({ query: rawSql<LatestChange>("SELECT id, last_at FROM visits ORDER BY last_at DESC, id DESC LIMIT 1", []) });
  return { url, query };
}
