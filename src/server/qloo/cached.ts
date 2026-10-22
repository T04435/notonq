// Qloo responses cached per caller key only (Qloo's guide allows private server-side caching; sharing one team's
// Qloo data with another would be redistribution). Deterministic answers only: 200, 404, 400.
import { createHash } from "node:crypto";
import type { HttpResult } from "@/server/http";
import type { QlooClient } from "@/server/qloo/client";
import type { Sql } from "@/server/store/db";
import { qlooCacheGet, qlooCachePut } from "@/server/store/repo";

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

export function cachedQloo(client: QlooClient, sql: Sql, callerHash: string): QlooClient & { hits: () => number } {
  let hits = 0;
  const get: QlooClient["get"] = async (path, params) => {
    const key = requestHash(path, params);
    const hit = await qlooCacheGet(sql, callerHash, key);
    if (hit) {
      hits++;
      return { status: hit.status, ok: hit.status >= 200 && hit.status < 300, json: hit.body, ms: 0, url: path } satisfies HttpResult;
    }
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
