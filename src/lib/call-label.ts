// A Ledger call in plain words: what it asked for, and what came back. Built from the recorded request line, status
// and NotOnQ's block in the response (Qloo's own data is never kept, only its count).

const SOURCE: Record<string, string> = {
  musicbrainz: "MusicBrainz",
  wikidata: "Wikidata",
  wikipedia: "Wikipedia",
  lastfm: "Last.fm",
  deezer: "Deezer",
  commons: "Wikimedia Commons",
  osm: "OpenStreetMap",
  spotify: "Spotify",
};

const INSIGHT: Record<string, string> = {
  "urn:heatmap": "where popular",
  "urn:demographics": "audience ages",
  "urn:audience": "audiences",
  "urn:tag": "tags",
};

/** What the call asked for, from its request line ("GET /q/v2/insights?filter.type=urn:heatmap&…"). */
export function callName(title: string): string {
  const [, path = "", query = ""] = title.match(/^\w+ \/q(\/[^?]*)\??(.*)$/) ?? [];
  const params = new URLSearchParams(query);
  if (path === "/search") return "search";
  if (path === "/entities") return params.has("external.spotify.ids") ? "artist by Spotify ID" : "artist record";
  if (path === "/v2/tags") return "find tags";
  if (path === "/v2/analysis/compare") return "compare audiences";
  if (path === "/v2/insights") {
    const type = params.get("filter.type") ?? "";
    if (INSIGHT[type]) return INSIGHT[type];
    if (type.startsWith("urn:entity:")) return params.has("filter.results.entities") ? `rank ${type.slice(11)}s` : `recommend ${type.slice(11)}s`;
    return "insights";
  }
  return path.replace(/^\//, "") || title;
}

type Block = { served_by?: string; proxy?: { stand_ins?: unknown[] }; provenance?: Record<string, { source?: string }[]> } | null | undefined;

/** What came back, in a few words. */
export function callDetail(servedBy: string | undefined, status: number | undefined, note: string | undefined, notonq: Block): string {
  if (servedBy === "needs_choice") return "More than one artist by that name: waiting for a caller to choose";
  const standIns = notonq?.proxy?.stand_ins?.length ?? 0;
  if (servedBy === "mixed" && standIns) return `Answered through ${standIns} similar artist${standIns === 1 ? "" : "s"} Qloo knows`;
  if (servedBy === "fallback" || servedBy === "mixed") {
    const sources = [...new Set(Object.values(notonq?.provenance ?? {}).flatMap((cites) => cites.map((c) => SOURCE[c.source ?? ""]).filter(Boolean)))];
    const from = sources.length ? `Filled in from ${sources.slice(0, 3).join(", ")}${sources.length > 3 ? ` and ${sources.length - 3} more` : ""}` : "Filled in from open sources";
    return servedBy === "mixed" ? `Qloo's results, plus the artist ${from.toLowerCase()}` : from;
  }
  if (status && status >= 400) return `Qloo returned an error (${status})`;
  const n = note?.match(/Qloo answered with (\d+) result/)?.[1];
  return n ? `Qloo answered, ${n} result${n === "1" ? "" : "s"}` : "Qloo answered";
}
