// The `notonq` block added beside Qloo's response (architecture §3.5). Qloo's own fields are never rewritten.
import { type Candidate, idForCandidate } from "@/server/engine/candidates";
import type { Demand, StoredFallback } from "@/server/store/repo";
import type { Lookup } from "@/server/service";

export type NotOnQBlock = {
  served_by: "qloo" | "fallback" | "mixed" | "needs_choice";
  gap?: { kind: string; qloo_status?: number; qloo_message?: string };
  cache?: { hit: boolean; first_seen?: string };
  demand?: { requests: number; callers: number; apps: number };
  proxy?: { replaced: string[]; stand_ins: { entity_id: string; name: string; weight: number; source: string }[] };
  provenance?: StoredFallback["provenance"];
  popularity?: StoredFallback["popularity"];
  unavailable?: string[];
  confidence?: StoredFallback["confidence"];
  candidates?: (Candidate & { entity_id: string })[];
  next?: string;
  research?: { status: "pending" | "done" | "failed" | "skipped" | "none" };
  attribution: string[];
};

const ATTRIBUTION = [
  "Facts: MusicBrainz (CC0), Wikidata (CC0), Wikipedia (CC BY-SA 4.0, linked per value)",
  "Similar artists and listener counts: Last.fm, powered by AudioScrobbler",
  "Small-artist matches, fan counts and pictures: Deezer",
  "Taste data: the Qloo API, for the stand-ins listed",
  "Researched facts: the pages cited per value, each quote checked on the page",
];

export const standInsOf = (f: StoredFallback) =>
  f.standIns.map((s) => ({ entity_id: s.entityId, name: s.name, weight: s.weight, source: s.source }));

export function blockFor(l: Lookup): NotOnQBlock {
  if (l.servedBy === "qloo") return { served_by: "qloo", attribution: [] };
  if (l.servedBy === "needs_choice")
    return {
      served_by: "needs_choice",
      gap: { kind: l.gap.kind, qloo_status: l.gap.qlooStatus, qloo_message: l.gap.qlooMessage },
      demand: l.demand,
      candidates: l.candidates.map(withEntityId),
      next: "Qloo has no data and no source has one clear match. Repeat the request with notonq.candidate=<key> to fill it from that candidate.",
      attribution: ATTRIBUTION,
    };
  return fallbackBlock(l.fallback, l.demand, { hit: l.cacheHit }, l.gap);
}

export function fallbackBlock(
  f: StoredFallback,
  demand: Demand,
  cache: { hit: boolean },
  gap: { kind: string; qloo_status?: number; qloo_message?: string; qlooStatus?: number; qlooMessage?: string } = { kind: f.gapKind },
): NotOnQBlock {
  return {
    served_by: "fallback",
    gap: { kind: gap.kind, qloo_status: gap.qloo_status ?? gap.qlooStatus, qloo_message: gap.qloo_message ?? gap.qlooMessage },
    cache: { hit: cache.hit, first_seen: f.createdAt },
    demand,
    proxy: { replaced: [], stand_ins: standInsOf(f) },
    provenance: f.provenance,
    popularity: f.popularity,
    unavailable: f.unavailable,
    confidence: f.confidence,
    research: { status: f.researchStatus ?? "none" },
    attribution: ATTRIBUTION,
  };
}

export const ATTRIBUTION_LINES = ATTRIBUTION;

/** The ID to send back for a candidate: the entity_id NotOnQ offers it under in results, or Qloo's own entity_id when
 * Qloo already knows it (inQloo; that one isn't added to results, since it is Qloo's artist under another spelling). */
export const candidateId = (c: Candidate) => c.inQloo?.entityId ?? idForCandidate(c);
const withEntityId = (c: Candidate) => ({ ...c, entity_id: candidateId(c) });

/** What NotOnQ did with one entity in a response. Keyed by its entity_id in the notonq block, so a client can tell
 * structurally which results are NotOnQ's without reading labels: filled (not in Qloo, filled from open sources),
 * candidate (a possible match offered, not filled yet), picked (Qloo's own record that NotOnQ added to this answer),
 * matched (Qloo's own record that NotOnQ matched to the query or ID asked for), gaps (Qloo's own record with fields
 * NotOnQ added where Qloo has none, G5). Entities with no block are Qloo's. */
export type EntityKind = "filled" | "candidate" | "picked" | "matched" | "gaps";
export const keyed = <T extends object>(kind: EntityKind, block: T) => ({ kind, ...block });
