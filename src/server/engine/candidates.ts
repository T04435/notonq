import { createHash } from "node:crypto";
// Who could this name be? Small artists rarely have one clean MusicBrainz record, so every source's matches are
// gathered, merged where they are clearly the same artist, and offered as choices. Only a single confident exact
// MusicBrainz match continues without asking.
import * as deezer from "@/server/adapters/deezer";
import * as lastfm from "@/server/adapters/lastfm";
import * as mb from "@/server/adapters/musicbrainz";
import type { Fetch } from "@/server/http";
import { nameKey, sameName } from "@/server/qloo/gap";

export type Candidate = {
  /** mb:<mbid> | dz:<deezer id> | lf:<name slug>: the first source that knows it. Stable, so it can be sent back. */
  key: string;
  name: string;
  exact: boolean;
  mbid?: string;
  deezerId?: number;
  lastfmName?: string;
  type?: string;
  country?: string;
  disambiguation?: string;
  listeners?: number;
  fans?: number;
  image?: string;
  links: { source: string; url: string }[];
  /** Set when Qloo already knows this candidate (matched by MusicBrainz ID): a "did you mean" rather than a gap. */
  inQloo?: { entityId: string; name: string };
};

export type CandidateSet = { candidates: Candidate[]; auto?: Candidate };

export const slug = (name: string) => nameKey(name).replace(/\s+/g, "-");

// NotOnQ's entity IDs are UUIDs, like Qloo's: the official Qloo harness only looks an ID up by /entities when it is
// UUID-shaped, so a person choosing one of our candidates would otherwise be asked again. A MusicBrainz artist keeps
// its MBID; anything else gets a stable name-based (version 5) UUID of its key in NotOnQ's own namespace.
const NAMESPACE = Buffer.from("8f3b6c2a5d0e4b7c9a1f2e3d4c5b6a79", "hex");

function uuidV5(name: string) {
  const b = createHash("sha1").update(NAMESPACE).update(name).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Enough to offer a candidate when the caller never said it wants an artist (an untyped search for a café or a book
 * shouldn't turn up a namesake with no trace anywhere): the exact name, plus a MusicBrainz record or any audience. */
export const hasEvidence = (c: Candidate) => c.exact && (!!c.mbid || (c.listeners ?? 0) > 0 || (c.fans ?? 0) > 0);

/** The entity ID a candidate key fills under. */
export function idForKey(key: string): string {
  const [kind, ...rest] = key.split(":");
  const v = rest.join(":");
  return kind === "mb" ? v.toLowerCase() : uuidV5(key);
}

/** The ID a listed candidate is offered under: the same ID its fill gets. */
export const idForCandidate = (c: Pick<Candidate, "key" | "mbid">) => (c.mbid ? c.mbid.toLowerCase() : idForKey(c.key));

/** A candidate rebuilt from its key alone (when a client sends back a key we didn't just list). */
export function candidateFromKey(key: string, name: string): Candidate | null {
  const [kind, ...rest] = key.split(":");
  const v = rest.join(":");
  if (kind === "mb" && /^[0-9a-f-]{36}$/i.test(v)) return { key, name, exact: true, mbid: v, links: [] };
  if (kind === "dz" && /^\d+$/.test(v)) return { key, name, exact: true, deezerId: Number(v), links: [] };
  if (kind === "lf" && v) return { key, name, exact: true, lastfmName: name, links: [] };
  return null;
}

const MAX = 8;

export async function findCandidates(name: string, { lastfmKey, fetch: f }: { lastfmKey?: string; fetch?: Fetch } = {}): Promise<CandidateSet> {
  const [mbHits, lfHits, dzHits] = await Promise.all([
    mb.searchArtists(name, { fetch: f }),
    lastfmKey ? lastfm.searchArtists(name, lastfmKey, { fetch: f }) : Promise.resolve([]),
    deezer.searchArtists(name, { fetch: f }),
  ]);

  const list: Candidate[] = mbHits
    .filter((a) => mb.isExactMb(a, name) || (a.score ?? 0) >= 70)
    .slice(0, 5)
    .map((a) => ({
      key: `mb:${a.mbid}`,
      name: a.name,
      exact: mb.isExactMb(a, name),
      mbid: a.mbid,
      type: a.type,
      country: a.country,
      disambiguation: a.disambiguation,
      links: [{ source: "musicbrainz", url: a.record }],
    }));

  // Attach a hit to the one existing candidate with the same name (never guess between two namesakes).
  const sameNamed = (n: string, free: (c: Candidate) => boolean) => {
    const matches = list.filter((c) => sameName(c.name, n));
    return matches.length === 1 && free(matches[0]) ? matches[0] : undefined;
  };

  for (const h of lfHits) {
    const target = (h.mbid && list.find((c) => c.mbid === h.mbid)) || sameNamed(h.name, (c) => c.listeners === undefined);
    if (target) {
      target.listeners = h.listeners;
      target.lastfmName = h.name;
      target.links.push({ source: "lastfm", url: h.url });
    } else if (sameName(h.name, name) || list.length < MAX) {
      list.push({ key: `lf:${slug(h.name)}`, name: h.name, exact: sameName(h.name, name), mbid: h.mbid, lastfmName: h.name, listeners: h.listeners, links: [{ source: "lastfm", url: h.url }] });
    }
  }

  for (const d of dzHits) {
    const target = sameNamed(d.name, (c) => c.deezerId === undefined);
    if (target) {
      target.deezerId = d.id;
      target.fans = d.fans;
      target.image ??= d.picture;
      target.links.push({ source: "deezer", url: d.link });
    } else if (sameName(d.name, name) || list.length < MAX) {
      list.push({ key: `dz:${d.id}`, name: d.name, exact: sameName(d.name, name), deezerId: d.id, fans: d.fans, image: d.picture, links: [{ source: "deezer", url: d.link }] });
    }
  }

  const reach = (c: Candidate) => Math.max(c.listeners ?? 0, c.fans ?? 0);
  const candidates = list
    .toSorted((a, b) => Number(b.exact) - Number(a.exact) || Number(!!b.mbid) - Number(!!a.mbid) || reach(b) - reach(a))
    .slice(0, MAX);

  const exact = candidates.filter((c) => c.exact);
  const auto = exact.length === 1 && exact[0].mbid && mbHits.some((a) => a.mbid === exact[0].mbid && mb.isExactMb(a, name)) ? exact[0] : undefined;
  return { candidates, auto };
}
