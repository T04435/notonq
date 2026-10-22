// One research run for one stored fallback: agent → verifier → fold in. Runs in the background after a fill (one at
// a time per artist, capped per day); the next request for the artist gets the result from the cache.
import type { LanguageModel } from "ai";
import type { Fetch } from "@/server/http";
import type { QlooClient } from "@/server/qloo/client";
import { research } from "@/server/research/agent";
import { applyClaims, knownFacts, missingFields } from "@/server/research/apply";
import type { Claim } from "@/server/research/claims";
import { verifyClaims } from "@/server/research/verify";
import type { Sql } from "@/server/store/db";
import { findFallback, researchRunsToday, saveClaims, setResearchStatus, startResearch, type StoredFallback, updateFill } from "@/server/store/repo";

/** Research needs an AI Gateway credential (OIDC on Vercel, AI_GATEWAY_API_KEY locally). NOTONQ_RESEARCH=0 turns it off. */
export const researchEnabled = () => process.env.NOTONQ_RESEARCH !== "0" && Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
export const DAILY_CAP = Number(process.env.NOTONQ_RESEARCH_DAILY ?? 40);

export type ResearchDeps = {
  sql: Sql;
  qloo: QlooClient;
  fetch?: Fetch;
  model?: LanguageModel;
  /** Tests inject the agent's output. */
  agent?: (input: Parameters<typeof research>[0]) => Promise<Claim[]>;
};

export const needsResearch = (f: StoredFallback) => !!f.entity && !f.researchStatus && missingFields(f).length > 0;

export async function runResearch(id: string, deps: ResearchDeps): Promise<{ status: string; verified: number; rejected: number }> {
  const f = await findFallback(deps.sql, { id });
  if (!f || !needsResearch(f)) return { status: "skipped", verified: 0, rejected: 0 };
  if ((await researchRunsToday(deps.sql)) >= DAILY_CAP) return { status: "capped", verified: 0, rejected: 0 };
  if (!(await startResearch(deps.sql, id))) return { status: "running", verified: 0, rejected: 0 };
  try {
    const input = { name: f.entity!.name, known: knownFacts(f), missing: missingFields(f) };
    const claims = await (deps.agent ?? ((i) => research(i, { model: deps.model })))(input);
    const { verified, rejected } = await verifyClaims(claims, { fetch: deps.fetch });
    await saveClaims(deps.sql, id, [
      ...verified.map((v) => ({ field: v.field, value: v.value, sourceUrl: v.source_url, quote: v.quote, verified: true, confidence: v.confidence })),
      ...rejected.map((r) => ({ field: r.claim.field, value: r.claim.value, sourceUrl: r.claim.source_url, quote: r.claim.quote, verified: false, reason: r.reason })),
    ]);
    const applied = await applyClaims(f, verified, deps.qloo);
    await updateFill(deps.sql, id, { entity: applied.entity, provenance: applied.provenance, standIns: applied.standIns, unavailable: applied.unavailable, researchStatus: "done" });
    return { status: "done", verified: verified.length, rejected: rejected.length };
  } catch (e) {
    await setResearchStatus(deps.sql, id, "failed");
    console.error(`research failed for ${id}:`, e);
    return { status: "failed", verified: 0, rejected: 0 };
  }
}
