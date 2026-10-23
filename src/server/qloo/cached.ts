// Qloo responses cached per caller key only (Qloo's guide allows private server-side caching; sharing one team's
// Qloo data with another would be redistribution). Deterministic answers only: 200, 404, 400.
// Every real Qloo call (not cache hits) counts against a per-caller daily budget: one Qloo key now serves several
// of a participant's apps (Qloo Support, 23 Oct), so a runaway caller must not drain it.
import { createHash } from "node:crypto";
import type { HttpResult } from "@/server/http";
import type { QlooClient } from "@/server/qloo/client";
import type { Sql } from "@/server/store/db";
import { countQlooCall, qlooCacheGet, qlooCachePut, qlooCallsToday } from "@/server/store/repo";

/** Real Qloo calls per caller per UTC day. NOTONQ_QLOO_DAILY_BUDGET overrides; 0 means no limit. */
export const DAILY_BUDGET = Number(process.env.NOTONQ_QLOO_DAILY_BUDGET ?? 1500);

export class QlooBudgetExceeded extends Error {
  constructor(readonly budget: number) {
    super(`NotOnQ's daily Qloo budget for this caller (${budget} calls) is used up; it resets at 00:00 UTC.`);
  }
}

const CACHEABLE = new Set([200, 400, 404]);

export const requestHash = (path: string, params: Record<string, string | number | undefined>) =>
  createHash("sha256")
    .update(
      `${path}?${Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join("&")}`,
    )
    .digest("hex");

export function cachedQloo(client: QlooClient, sql: Sql, callerHash: string, budget = DAILY_BUDGET): QlooClient & { hits: () => number } {
  let hits = 0;
  const get: QlooClient["get"] = async (path, params) => {
    const key = requestHash(path, params);
    const hit = await qlooCacheGet(sql, callerHash, key);
    if (hit) {
      hits++;
      return { status: hit.status, ok: hit.status >= 200 && hit.status < 300, json: hit.body, ms: 0, url: path } satisfies HttpResult;
    }
    if (budget > 0 && (await qlooCallsToday(sql, callerHash)) >= budget) throw new QlooBudgetExceeded(budget);
    await countQlooCall(sql, callerHash);
    const res = await client.get(path, params);
    if (CACHEABLE.has(res.status)) await qlooCachePut(sql, callerHash, key, res.status, res.json);
    return res;
  };
  return {
    get,
    searchArtist: (name, take = 5) => get("/search", { query: name, types: "urn:entity:artist", take }),
    entitiesByMbids: (mbids) => get("/entities", { "external.musicbrainz.ids": mbids.join(",") }),
    insights: (params) => get("/v2/insights", params),
    hits: () => hits,
  };
}
