// Every value NotOnQ adds carries proof: where it came from, which record, under what licence, and how it was made.

export type Method = "copied" | "derived" | "qloo_proxy" | "researched";

export type Provenance = {
  source: string;
  record: string;
  licence: string;
  method: Method;
  retrievedAt: string;
  /** For derived values: what was measured and how (e.g. "popularity fitted on 9 stand-ins, rmse 0.07"). */
  note?: string;
};

export type ProvenanceMap = Record<string, Provenance[]>;

export const LICENCES = {
  musicbrainz: "CC0-1.0",
  wikidata: "CC0-1.0",
  wikipedia: "CC-BY-SA-4.0",
  pageviews: "CC0-1.0",
  lastfm: "Last.fm API terms (non-commercial, attribution)",
  deezer: "Deezer API terms (non-commercial)",
  qloo: "Qloo API terms",
  openstreetmap: "ODbL-1.0",
  notonq: "derived by NotOnQ",
} as const;

export function cite(
  map: ProvenanceMap,
  path: string,
  p: Omit<Provenance, "retrievedAt"> & { retrievedAt?: string },
): void {
  (map[path] ??= []).push({ ...p, retrievedAt: p.retrievedAt ?? new Date().toISOString() });
}
