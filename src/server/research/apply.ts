// Fold verified claims into a stored fallback: only empty fields are filled (open data always wins), every value is
// cited with its page and quote, and "for fans of" artists Qloo knows become extra stand-ins.
import { type FallbackEntity, genreTag } from "@/server/engine/artist";
import type { StandIn } from "@/server/engine/standins";
import { cite, type ProvenanceMap } from "@/server/provenance";
import { entitiesOf, type QlooClient } from "@/server/qloo/client";
import { sameName } from "@/server/qloo/gap";
import type { ClaimField } from "@/server/research/claims";
import { norm, type Verified } from "@/server/research/verify";
import type { StoredFallback } from "@/server/store/repo";

/** Which claimable fields a stored fallback is still missing. */
export function missingFields(f: StoredFallback): ClaimField[] {
  const e = f.entity;
  if (!e) return [];
  const out: ClaimField[] = [];
  if (!e.properties.short_description) out.push("properties.short_description");
  if (!e.tags.length) out.push("tags");
  if (!e.disambiguation) out.push("disambiguation");
  if (!e.properties.akas.length && !e.properties.external.musicbrainz) out.push("properties.akas");
  for (const ns of ["instagram", "facebook", "twitter", "spotify"] as const) if (!e.properties.external[ns]) out.push(`properties.external.${ns}`);
  if (f.standIns.length < 3) out.push("notonq:similar");
  return out;
}

/** The facts tiers 1–2 found, so the agent researches the right artist. */
export function knownFacts(f: StoredFallback): string[] {
  const e = f.entity;
  if (!e) return [];
  const ext = e.properties.external;
  return [
    e.disambiguation && `From/known as: ${e.disambiguation}`,
    ext.musicbrainz && `MusicBrainz: https://musicbrainz.org/artist/${ext.musicbrainz.id}`,
    ext.wikidata && `Wikidata: https://www.wikidata.org/wiki/${ext.wikidata.id}`,
    ext["notonq:deezer"] && `Deezer: https://www.deezer.com/artist/${ext["notonq:deezer"].id} (${ext["notonq:deezer"].fans} fans)`,
    ext.lastfm && `Last.fm: ${ext.lastfm.id} (${ext.lastfm.listeners} listeners)`,
    e.tags.length > 0 && `Genres: ${e.tags.map((t) => t.name).join(", ")}`,
    f.standIns.length > 0 && `Similar artists: ${f.standIns.map((s) => s.name).join(", ")}`,
  ].filter(Boolean) as string[];
}

const RANK = { high: 0, medium: 1 } as const;
const SIMILAR_LOOKUPS = 5;

export async function applyClaims(f: StoredFallback, verified: Verified[], qloo: QlooClient) {
  if (!f.entity) return { entity: f.entity, provenance: f.provenance, standIns: f.standIns, unavailable: f.unavailable, applied: 0 };
  const entity: FallbackEntity = structuredClone(f.entity);
  const provenance: ProvenanceMap = structuredClone(f.provenance);
  const standIns: StandIn[] = [...f.standIns];
  const filled = new Set<string>();
  const sorted = verified.toSorted((a, b) => RANK[a.confidence] - RANK[b.confidence]);
  const proof = (path: string, v: Verified) =>
    cite(provenance, path, { source: v.domain, record: v.source_url, licence: "quoted from the source page", method: "researched", note: `"${v.quote}" (${v.confidence} confidence)` });

  for (const v of sorted) {
    switch (v.field) {
      case "properties.short_description":
        if (!entity.properties.short_description) {
          entity.properties.short_description = v.value;
          proof(v.field, v);
          filled.add(v.field);
        }
        break;
      case "disambiguation":
        if (!entity.disambiguation) {
          entity.disambiguation = v.value;
          proof(v.field, v);
          filled.add(v.field);
        }
        break;
      case "properties.akas":
        if (!entity.properties.akas.some((a) => norm(a.value) === norm(v.value)) && !sameName(v.value, entity.name)) {
          entity.properties.akas.push({ value: v.value, languages: [] });
          proof(v.field, v);
          filled.add(v.field);
        }
        break;
      case "tags":
        if (!f.entity.tags.length && !entity.tags.some((t) => norm(t.name) === norm(v.value))) {
          entity.tags.push(genreTag(v.value));
          proof(v.field, v);
          filled.add(v.field);
        }
        break;
      case "properties.external.instagram":
      case "properties.external.facebook":
      case "properties.external.twitter":
      case "properties.external.spotify": {
        const ns = v.field.split(".").pop() as "instagram" | "facebook" | "twitter" | "spotify";
        if (!entity.properties.external[ns]) {
          entity.properties.external[ns] = { id: v.value.replace(/^@/, "") };
          proof(v.field, v);
          filled.add(v.field);
        }
        break;
      }
      case "notonq:similar":
        break;
    }
  }

  // "For fans of" artists: resolve each in Qloo by exact name; the ones Qloo knows become stand-ins.
  const seen = new Set(standIns.map((s) => s.entityId));
  const names = [...new Map(sorted.filter((v) => v.field === "notonq:similar").map((v) => [norm(v.value), v])).values()];
  for (const v of names.slice(0, SIMILAR_LOOKUPS)) {
    if (standIns.length >= 5) break;
    const hit = entitiesOf((await qloo.searchArtist(v.value, 3)).json).find((e) => sameName(e.name, v.value));
    if (!hit || seen.has(hit.entity_id)) continue;
    seen.add(hit.entity_id);
    standIns.push({ entityId: hit.entity_id, name: hit.name, weight: v.confidence === "high" ? 0.7 : 0.5, source: "research", popularity: hit.popularity ?? undefined });
    proof(`standIns.${hit.entity_id}`, v);
    filled.add("standIns");
  }

  const unavailable = f.unavailable.filter((u) => {
    const base = u.split(" ")[0];
    return !(filled.has(base) || (base === "standIns" && standIns.length > 0));
  });
  return { entity, provenance, standIns, unavailable, applied: filled.size };
}
