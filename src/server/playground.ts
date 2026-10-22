// What the playground shows for one artist: Qloo's own answer (status and message, summarised: never a raw dump),
// then either the candidates to choose from, or NotOnQ's filled entity with a source per field, the stand-ins, and
// "fans also like" answered by Qloo.
import { demandText } from "@/lib/demand";
import type { FallbackEntity, ResolveOptions } from "@/server/engine/artist";
import type { Candidate } from "@/server/engine/candidates";
import { ARTIST, entitiesOf, type QlooClient, qlooClient } from "@/server/qloo/client";
import { cachedQloo } from "@/server/qloo/cached";
import { blockFor, type NotOnQBlock } from "@/server/respond";
import type { Sql } from "@/server/store/db";
import { hashCaller, type Lookup, lookupArtist } from "@/server/service";

export type Step = { title: string; detail: string; status?: "error" | "pending" };

export type PlaygroundView = {
  query: string;
  servedBy: "qloo" | "fallback" | "needs_choice";
  qloo: { status: number; label: string; message?: string; summary: string; entityName?: string };
  entity: FallbackEntity | null;
  candidates: Candidate[];
  notonq: NotOnQBlock;
  alsoLike: { names: string[]; via: "artist" | "stand-ins" | "none"; note?: string };
  dropIn: { request: string; response: unknown };
  steps: Step[];
  ms: number;
};

export async function playgroundLookup(
  name: string,
  { sql, apiKey, lastfmKey, baseUrl, salt }: { sql: Sql; apiKey: string; lastfmKey?: string; baseUrl: string; salt: string },
  opts: ResolveOptions = {},
): Promise<PlaygroundView> {
  const started = Date.now();
  const callerHash = hashCaller(`playground:${apiKey}`, salt);
  const qloo: QlooClient = cachedQloo(qlooClient({ apiKey, baseUrl }), sql, callerHash);
  const l = await lookupArtist(name, { sql, qloo, lastfmKey, callerHash, appLabel: "playground", endpoint: "playground" }, opts);
  const steps: Step[] = [];
  const done = (v: Omit<PlaygroundView, "query" | "steps" | "ms">): PlaygroundView => ({ query: name, steps, ms: Date.now() - started, ...v });

  if (l.servedBy === "qloo") {
    steps.push({ title: "Qloo", detail: `Found "${l.entity.name}" in Qloo's taste graph` });
    const recs = await qloo.insights({ "filter.type": ARTIST, "signal.interests.entities": l.entity.entity_id, take: 6 });
    return done({
      servedBy: "qloo",
      qloo: { status: 200, label: "200 found", summary: "Qloo knows this artist: its response passes through untouched.", entityName: l.entity.name },
      entity: null,
      candidates: [],
      notonq: blockFor(l),
      alsoLike: { names: entitiesOf(recs.json).map((e) => e.name), via: "artist" },
      dropIn: { request: dropInRequest(name), response: { note: "Qloo's own response, unchanged", served_by: "qloo" } },
    });
  }

  steps.push(qlooStep(l));
  const qlooCard = {
    status: l.gap.qlooStatus ?? (l.gap.kind === "G2" ? 400 : 404),
    label: l.gap.kind === "G2" ? "400 not in taste graph" : l.gap.qlooStatus === 404 ? "404 no results" : "no match",
    message: l.gap.qlooMessage,
    summary: l.gap.kind === "G2" ? "Qloo can find the name but has no taste data for it." : "Qloo has no artist with this name.",
  };

  if (l.servedBy === "needs_choice") {
    const notonq = blockFor(l);
    steps.push({ title: "Matches", detail: `${l.candidates.length} possible artists across MusicBrainz, Last.fm and Deezer: choose one to continue` });
    steps.push({ title: "Demand", detail: demandText(l.demand) });
    return done({
      servedBy: "needs_choice",
      qloo: qlooCard,
      entity: null,
      candidates: l.candidates,
      notonq,
      alsoLike: { names: [], via: "none", note: "Choose an artist first" },
      dropIn: { request: dropInRequest(name), response: { results: [], notonq } },
    });
  }

  const f = l.fallback;
  if (l.cacheHit) steps.push({ title: "Cache", detail: `Served from NotOnQ's cache, first filled ${new Date(f.createdAt).toUTCString()}` });
  if (!f.entity) steps.push({ title: "Open data", status: "error", detail: "No source knows this name yet: counted as demand, retried after a day" });
  else if (!l.cacheHit) {
    const facts = Object.keys(f.provenance).filter((p) => !p.startsWith("standIns.")).length;
    const sources = [...new Set(Object.values(f.provenance).flat().map((p) => p.source))].filter((s) => s !== "notonq").join(", ");
    steps.push({ title: "Open data", detail: `${facts} fields filled from ${sources}${f.confidence === "low" ? " (no MusicBrainz record: low confidence)" : ""}` });
  }
  if (f.entity)
    steps.push({
      title: "Stand-ins",
      detail: f.standIns.length ? `${f.standIns.length} similar artists Qloo knows: ${f.standIns.map((s) => s.name).join(", ")}` : "No similar artist known to Qloo",
      status: f.standIns.length ? undefined : "error",
    });

  let alsoLike: PlaygroundView["alsoLike"] = { names: [], via: "none", note: "Needs stand-ins" };
  if (f.standIns.length) {
    const recs = await qloo.insights({ "filter.type": ARTIST, "signal.interests.entities": f.standIns.map((s) => s.entityId).join(","), take: 8 });
    const exclude = new Set(f.standIns.map((s) => s.entityId));
    alsoLike = {
      names: entitiesOf(recs.json).filter((e) => !exclude.has(e.entity_id)).map((e) => e.name).slice(0, 6),
      via: "stand-ins",
      note: "Qloo's answer for the stand-ins, used in place of the missing artist",
    };
    steps.push({ title: "Qloo via stand-ins", detail: `"Fans also like" answered by Qloo for the stand-ins` });
  }
  steps.push({ title: "Demand", detail: demandText(l.demand) });

  const notonq = blockFor(l);
  return done({
    servedBy: "fallback",
    qloo: qlooCard,
    entity: f.entity,
    candidates: [],
    notonq,
    alsoLike,
    dropIn: { request: dropInRequest(name, f.candidateKey), response: { results: f.entity ? [f.entity] : [], notonq } },
  });
}

function qlooStep(l: Exclude<Lookup, { servedBy: "qloo" }>): Step {
  const g = l.gap;
  const cacheHit = l.servedBy === "fallback" && l.cacheHit;
  const detail =
    g.kind === "G2"
      ? "Found in Qloo search, but insights rejects it: not in the taste graph (400)"
      : g.qlooStatus === 404
        ? `No results in Qloo (404${g.qlooMessage ? ` "${g.qlooMessage}"` : ""})`
        : cacheHit
          ? "Known gap: Qloo had no artist with this name when it was first asked"
          : "Qloo search answered, but no artist with this exact name";
  return { title: "Qloo", status: "error", detail };
}

const dropInRequest = (name: string, candidateKey?: string) =>
  `curl -H "X-Api-Key: $QLOO_API_KEY" -H "X-Lastfm-Key: $LASTFM_API_KEY" \\\n  "$NOTONQ/q/search?types=urn:entity:artist&query=${encodeURIComponent(name)}${candidateKey ? `&notonq.candidate=${encodeURIComponent(candidateKey)}` : ""}"`;
