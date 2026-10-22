// The `notonq` block added beside Qloo's response (architecture §3.5). Qloo's own fields are never rewritten.
import type { Demand, StoredFallback } from "@/server/store/repo";
import type { Lookup } from "@/server/service";

export type NotOnQBlock = {
  served_by: "qloo" | "fallback" | "mixed";
  gap?: { kind: string; qloo_status?: number; qloo_message?: string };
  cache?: { hit: boolean; first_seen?: string };
  demand?: { requests: number; callers: number; apps: number };
  proxy?: { replaced: string[]; stand_ins: { entity_id: string; name: string; weight: number; source: string }[] };
  provenance?: StoredFallback["provenance"];
  popularity?: StoredFallback["popularity"];
  unavailable?: string[];
  attribution: string[];
};

const ATTRIBUTION = [
  "Facts: MusicBrainz (CC0), Wikidata (CC0), Wikipedia (CC BY-SA 4.0, linked per value)",
  "Similar artists and listener counts: Last.fm, powered by AudioScrobbler",
  "Taste data: the Qloo API, for the stand-ins listed",
];

export const standInsOf = (f: StoredFallback) =>
  f.standIns.map((s) => ({ entity_id: s.entityId, name: s.name, weight: s.weight, source: s.source }));

export function blockFor(l: Lookup): NotOnQBlock {
  if (l.servedBy === "qloo") return { served_by: "qloo", attribution: [] };
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
    attribution: ATTRIBUTION,
  };
}

export const ATTRIBUTION_LINES = ATTRIBUTION;
