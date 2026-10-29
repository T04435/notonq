// Field gaps (G5): Qloo has the artist, but its record lacks fields an app needs (where they're from, what they sing in,
// their Wikidata item, any genre). NotOnQ adds those from MusicBrainz, beside Qloo's own values (never over them),
// each `notonq:`-prefixed and cited. It needs to know which artist it is: the MusicBrainz ID on Qloo's record, else
// MusicBrainz's single exact match for the name. A name shared by several artists ("Anorak") gets nothing, not a guess.
import * as mb from "@/server/adapters/musicbrainz";
import { genreTag, type Home, homeOf } from "@/server/engine/artist";
import { externalOf } from "@/server/engine/standins";
import type { QlooEntity } from "@/server/qloo/client";
import { findShapeFill, saveShapeFill } from "@/server/store/repo";
import type { Ctx } from "@/server/service";

export type Cite = { source: "musicbrainz"; record: string; licence: "CC0"; method: "copied" | "derived"; retrievedAt: string; note?: string };
export type Language = { code: string; name: string; releases: number };

/** What MusicBrainz says about one Qloo artist, cached as open data (shared across callers). */
export type Facts = {
  mbid?: string;
  record?: string;
  wikidata?: string;
  home?: Home;
  languages?: Language[];
  genres?: string[];
  retrievedAt: string;
  /** Why nothing was found (no MusicBrainz match, or several artists by that name). */
  missing?: string;
};

const KEY = (entityId: string) => `facts:v1:${entityId}`;
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_MS = 24 * 60 * 60 * 1000;
/** How long a request waits for MusicBrainz (1 call a second) before answering without facts; they finish after it. */
export const FACTS_BUDGET_MS = 4000;

// ISO 639-3 (MusicBrainz) to the 639-1 codes Intl names; anything else keeps its own code as its name.
const ISO1: Record<string, string> = {
  eng: "en", jpn: "ja", spa: "es", fra: "fr", deu: "de", por: "pt", ita: "it", kor: "ko", zho: "zh", rus: "ru", nld: "nl", swe: "sv",
  nor: "no", dan: "da", fin: "fi", pol: "pl", tur: "tr", ara: "ar", hin: "hi", ind: "id", tha: "th", vie: "vi", ukr: "uk", ces: "cs",
  ell: "el", heb: "he", hun: "hu", ron: "ro", cat: "ca", gle: "ga", cym: "cy", isl: "is", est: "et", lav: "lv", lit: "lt", tgl: "tl",
};
const languageName = (code: string) => (ISO1[code] ? (new Intl.DisplayNames(["en"], { type: "language" }).of(ISO1[code]) ?? code) : code);

/** The MusicBrainz artist this Qloo record is: its own MusicBrainz ID, else the one exact match for its name. */
async function identify(e: QlooEntity, ctx: Pick<Ctx, "fetch">): Promise<{ mbid: string } | { missing: string }> {
  const own = externalOf(e, "musicbrainz").map((x) => (typeof x.id === "string" ? x.id.toLowerCase() : "")).find(Boolean);
  if (own) return { mbid: own };
  const exact = (await mb.searchArtists(e.name, { fetch: ctx.fetch })).filter((a) => mb.isExactMb(a, e.name));
  if (exact.length === 1) return { mbid: exact[0].mbid };
  return { missing: exact.length ? `MusicBrainz has ${exact.length} artists named "${e.name}" and Qloo's record has no MusicBrainz ID, so NotOnQ doesn't guess which` : `MusicBrainz has no artist named "${e.name}"` };
}

async function lookup(e: QlooEntity, ctx: Pick<Ctx, "fetch">): Promise<Facts> {
  const retrievedAt = new Date().toISOString();
  const who = await identify(e, ctx);
  if ("missing" in who) return { retrievedAt, missing: who.missing };
  const a = await mb.artistDetails(who.mbid, { fetch: ctx.fetch });
  if (!a) return { retrievedAt, missing: `MusicBrainz has no record ${who.mbid}` };
  const langs = await mb.releaseLanguages(who.mbid, { fetch: ctx.fetch });
  const home = homeOf(a);
  return {
    mbid: a.mbid,
    record: a.record,
    retrievedAt,
    ...(a.wikidata ? { wikidata: a.wikidata } : {}),
    ...(home ? { home } : {}),
    ...(langs.length ? { languages: langs.slice(0, 3).map((l) => ({ ...l, name: languageName(l.code) })) } : {}),
    ...(a.genres.length || a.tags.length ? { genres: (a.genres.length ? a.genres : a.tags).slice(0, 6) } : {}),
  };
}

/** The facts for a Qloo artist: from the cache, or looked up within the budget. Past the budget the lookup finishes
 * after the response (when the route can defer work) and the next call has them. */
export async function factsFor(e: QlooEntity, ctx: Pick<Ctx, "sql" | "fetch" | "defer">, budgetMs = FACTS_BUDGET_MS): Promise<Facts | null> {
  const cached = await findShapeFill<Facts>(ctx.sql, KEY(e.entity_id), FRESH_MS);
  if (cached && (!cached.missing || Date.now() - Date.parse(cached.retrievedAt) < MISS_MS)) return cached;
  const work = lookup(e, ctx).then(async (f) => {
    await saveShapeFill(ctx.sql, KEY(e.entity_id), f);
    return f;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), budgetMs)));
  const out = await Promise.race([work.catch(() => null), late]);
  clearTimeout(timer);
  if (out === null) ctx.defer?.(() => work.catch(() => null));
  return out;
}

const hasGenre = (e: QlooEntity) => ((e as { tags?: { type?: string }[] }).tags ?? []).some((t) => t.type?.startsWith("urn:tag:genre"));

/** A thin Qloo record: no MusicBrainz ID, no Wikidata ID or no genre. Only these get facts, so an artist Qloo knows
 * well (Taylor Swift) stays Qloo's answer alone, and MusicBrainz isn't asked about every search. */
export const isThin = (e: QlooEntity) => !externalOf(e, "musicbrainz").length || !externalOf(e, "wikidata").length || !hasGenre(e);

/** The Qloo entity with NotOnQ's facts added where Qloo has none, and what was added (field path → citation). Qloo's
 * own keys and values are kept exactly. */
export function withFacts(e: QlooEntity, f: Facts): { entity: QlooEntity; provenance: Record<string, Cite[]> } {
  const provenance: Record<string, Cite[]> = {};
  if (!f.mbid || !f.record) return { entity: e, provenance };
  const cite = (path: string, method: Cite["method"] = "copied", note?: string) =>
    (provenance[path] = [{ source: "musicbrainz", record: f.record!, licence: "CC0", method, retrievedAt: f.retrievedAt, ...(note ? { note } : {}) }]);
  const props = (e.properties ?? {}) as Record<string, unknown>;
  const external = { ...((props.external ?? {}) as Record<string, unknown>) };
  const added: Record<string, unknown> = {};

  if (!externalOf(e, "musicbrainz").length) {
    external["notonq:musicbrainz"] = { id: f.mbid };
    cite("properties.external.notonq:musicbrainz");
  }
  if (f.wikidata && !externalOf(e, "wikidata").length) {
    external["notonq:wikidata"] = { id: f.wikidata };
    cite("properties.external.notonq:wikidata");
  }
  if (f.home && !props["notonq:home"]) {
    added["notonq:home"] = f.home;
    cite("properties.notonq:home");
  }
  if (f.languages?.length) {
    added["notonq:languages"] = f.languages;
    cite("properties.notonq:languages", "derived", "Counted from the text language MusicBrainz records on each of the artist's releases.");
  }
  const tags = (e as { tags?: unknown[] }).tags;
  const genreTags = !hasGenre(e) && f.genres?.length ? f.genres.map(genreTag) : [];
  if (genreTags.length) cite("tags");

  if (!Object.keys(provenance).length) return { entity: e, provenance };
  return {
    entity: { ...e, properties: { ...props, external, ...added }, ...(genreTags.length ? { tags: [...(Array.isArray(tags) ? tags : []), ...genreTags] } : {}) } as QlooEntity,
    provenance,
  };
}
