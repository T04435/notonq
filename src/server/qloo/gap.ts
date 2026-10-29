// The four kinds of gap (research/00 §2), read from what Qloo actually returns. Live behaviour (research/05):
// unknown names give 404 "No results" or no exact match; artists Qloo can find but not use give a 400 on insights;
// trending has no rows for recent windows.
import type { HttpResult } from "@/server/http";
import { entitiesOf, qlooMessage, type QlooEntity } from "@/server/qloo/client";

export type GapKind = "G1" | "G2" | "G3" | "G4";

export type Gap = { kind: GapKind; qlooStatus: number; qlooMessage?: string; reason: string };

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The key an artist name is cached and counted under: lowercase, no accents or punctuation. */
export const nameKey = norm;

/** A leading "The" is optional in how people write a band's name ("Pigram Brothers" = "The Pigram Brothers"). */
const bare = (s: string) => norm(s).replace(/^the (?=.)/, "");

/** Same artist name, ignoring case, accents, punctuation and a leading "The" ("sombr" = "Sombr", "Beyoncé" = "Beyonce"). */
export const sameName = (a: string, b: string) => bare(a) === bare(b);

export type SearchOutcome = { found: QlooEntity } | { gap: Gap };

export function readSearch(name: string, res: HttpResult): SearchOutcome {
  const message = qlooMessage(res.json);
  if (res.status === 404) return { gap: { kind: "G1", qlooStatus: 404, qlooMessage: message, reason: "Qloo search: no results" } };
  if (!res.ok) throw new QlooUnavailable(res);
  const hit = entitiesOf(res.json).find((e) => sameName(e.name, name));
  return hit
    ? { found: hit }
    : { gap: { kind: "G1", qlooStatus: res.status, qlooMessage: message, reason: `Qloo search: no exact match for "${name}"` } };
}

const NOT_IN_GRAPH = /all of the provided signal\.interests\.entities were invalid/i;

/** null when insights worked; a G2 gap when Qloo knows the ID but its taste graph doesn't; throws on outages. */
export function readInsights(res: HttpResult): Gap | null {
  const message = qlooMessage(res.json);
  if (res.status === 400 && message && NOT_IN_GRAPH.test(message))
    return { kind: "G2", qlooStatus: 400, qlooMessage: message, reason: "In Qloo search, but not usable as a taste signal" };
  if (!res.ok) throw new QlooUnavailable(res);
  return null;
}

/** G3: trending answered but with no rows in the window asked for. */
export function readTrending(res: HttpResult): Gap | null {
  if (!res.ok) throw new QlooUnavailable(res);
  const rows = (res.json as { results?: { trending?: unknown[] } } | null)?.results?.trending;
  return Array.isArray(rows) && rows.length > 0
    ? null
    : { kind: "G3", qlooStatus: res.status, reason: "Qloo trending has no rows for this window" };
}

/** Qloo itself failed (5xx, auth, timeout, rate limit after retry): not a data gap, so never logged as demand. */
export class QlooUnavailable extends Error {
  constructor(readonly res: HttpResult) {
    super(`Qloo unavailable: HTTP ${res.status}${res.error ? ` (${res.error})` : ""}`);
  }
}
