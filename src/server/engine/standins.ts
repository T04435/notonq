// The stand-in proxy (Qloo Support, 20 Oct: passing similar artists as signal.interests.entities is "exactly the right
// fallback"). Similar artists come from open sources with MusicBrainz IDs; one batch /entities call finds the ones
// Qloo knows; the best of those stand in for the missing artist, weighted by how similar they are.
import type { QlooEntity } from "@/server/qloo/client";

export type Candidate = { name: string; mbid: string; match: number; source: string };

export type StandIn = {
  entityId: string;
  name: string;
  mbid: string;
  weight: number;
  source: string;
  popularity?: number;
  listeners?: number;
};

/** Qloo puts other-service IDs under `properties.external.<ns>` on lookups (object or list) and `external.<ns>` on
 * insights (list). Returns every record for one namespace, whichever shape arrived. */
export function externalOf(e: QlooEntity, ns: string): Record<string, unknown>[] {
  const raw = [e.properties?.external?.[ns], e.external?.[ns]];
  return raw.flatMap((v) => (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [])) as Record<string, unknown>[];
}

const toNum = (v: unknown) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

export function pickStandIns(candidates: Candidate[], qlooEntities: QlooEntity[], take = 5): StandIn[] {
  const byMbid = new Map<string, QlooEntity>();
  // /entities returns several rows for one MBID (research/05); keep the most popular row per MBID.
  for (const e of qlooEntities) {
    for (const mb of externalOf(e, "musicbrainz")) {
      const id = typeof mb.id === "string" ? mb.id.toLowerCase() : undefined;
      if (!id) continue;
      const prev = byMbid.get(id);
      if (!prev || (e.popularity ?? 0) > (prev.popularity ?? 0)) byMbid.set(id, e);
    }
  }
  const seen = new Set<string>();
  const out: StandIn[] = [];
  for (const c of candidates.toSorted((a, b) => b.match - a.match)) {
    const e = byMbid.get(c.mbid.toLowerCase());
    if (!e || seen.has(e.entity_id)) continue;
    seen.add(e.entity_id);
    out.push({
      entityId: e.entity_id,
      name: e.name,
      mbid: c.mbid,
      weight: c.match,
      source: c.source,
      popularity: e.popularity ?? undefined,
      listeners: toNum(externalOf(e, "lastfm")[0]?.listeners),
    });
    if (out.length === take) break;
  }
  return out;
}

/** Candidates worth one batch lookup: those with an MBID, best matches first, no duplicates, capped for the URL. */
export function lookupBatch(candidates: Candidate[], max = 25): string[] {
  return [...new Set(candidates.toSorted((a, b) => b.match - a.match).map((c) => c.mbid.toLowerCase()))].slice(0, max);
}
