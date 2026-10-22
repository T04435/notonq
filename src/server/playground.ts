// What the playground shows for one artist: Qloo's own answer (status and message, summarised: never a raw dump),
// NotOnQ's filled entity with a source per field, the stand-ins, and "fans also like" answered by Qloo.
import type { FallbackEntity } from "@/server/engine/artist";
import { ARTIST, entitiesOf, type QlooClient } from "@/server/qloo/client";
import { cachedQloo } from "@/server/qloo/cached";
import { qlooClient } from "@/server/qloo/client";
import { demandText } from "@/lib/demand";
import { blockFor, type NotOnQBlock } from "@/server/respond";
import type { Sql } from "@/server/store/db";
import { hashCaller, lookupArtist } from "@/server/service";

export type Step = { title: string; detail: string; status?: "error" | "pending" };

export type PlaygroundView = {
  query: string;
  servedBy: "qloo" | "fallback";
  qloo: { status: number; label: string; message?: string; summary: string; entityName?: string };
  entity: FallbackEntity | null;
  notonq: NotOnQBlock;
  alsoLike: { names: string[]; via: "artist" | "stand-ins" | "none"; note?: string };
  dropIn: { request: string; response: unknown };
  steps: Step[];
  ms: number;
};

export async function playgroundLookup(
  name: string,
  { sql, apiKey, lastfmKey, baseUrl, salt }: { sql: Sql; apiKey: string; lastfmKey?: string; baseUrl: string; salt: string },
): Promise<PlaygroundView> {
  const started = Date.now();
  const callerHash = hashCaller(`playground:${apiKey}`, salt);
  const qloo: QlooClient = cachedQloo(qlooClient({ apiKey, baseUrl }), sql, callerHash);
  const l = await lookupArtist(name, { sql, qloo, lastfmKey, callerHash, appLabel: "playground", endpoint: "playground" });
  const steps: Step[] = [];

  if (l.servedBy === "qloo") {
    steps.push({ title: "Qloo", detail: `Found "${l.entity.name}" in Qloo's taste graph` });
    const recs = await qloo.insights({ "filter.type": ARTIST, "signal.interests.entities": l.entity.entity_id, take: 6 });
    return {
      query: name,
      servedBy: "qloo",
      qloo: { status: 200, label: "200 found", summary: "Qloo knows this artist: its response passes through untouched.", entityName: l.entity.name },
      entity: null,
      notonq: blockFor(l),
      alsoLike: { names: entitiesOf(recs.json).map((e) => e.name), via: "artist" },
      dropIn: { request: dropInRequest(name), response: { note: "Qloo's own response, unchanged", served_by: "qloo" } },
      steps,
      ms: Date.now() - started,
    };
  }

  const f = l.fallback;
  const gap = l.gap;
  steps.push({
    title: "Qloo",
    status: "error",
    detail:
      gap.kind === "G2"
        ? "Found in Qloo search, but insights rejects it: not in the taste graph (400)"
        : gap.qlooStatus === 404
          ? `No results in Qloo (404${gap.qlooMessage ? ` "${gap.qlooMessage}"` : ""})`
          : cacheOrNoMatch(l.cacheHit),
  });
  if (l.cacheHit) steps.push({ title: "Cache", detail: `Served from NotOnQ's cache, first filled ${new Date(f.createdAt).toUTCString()}` });
  else {
    const facts = Object.keys(f.provenance).filter((p) => !p.startsWith("standIns.")).length;
    steps.push({ title: "Open data", detail: f.entity ? `${facts} fields filled from MusicBrainz, Wikidata, Wikipedia and Last.fm` : "No exact MusicBrainz match", status: f.entity ? undefined : "error" });
  }
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
  return {
    query: name,
    servedBy: "fallback",
    qloo: {
      status: gap.qlooStatus ?? (gap.kind === "G2" ? 400 : 404),
      label: gap.kind === "G2" ? "400 not in taste graph" : gap.qlooStatus === 404 ? "404 no results" : "no match",
      message: gap.qlooMessage,
      summary: gap.kind === "G2" ? "Qloo can find the name but has no taste data for it." : "Qloo has no artist with this name.",
    },
    entity: f.entity,
    notonq,
    alsoLike,
    dropIn: { request: dropInRequest(name), response: { success: true, results: f.entity ? [f.entity] : [], notonq } },
    steps,
    ms: Date.now() - started,
  };
}

const cacheOrNoMatch = (cacheHit: boolean) =>
  cacheHit ? "Known gap: Qloo had no artist with this name when it was first asked" : "Qloo search answered, but no artist with this exact name";

const dropInRequest = (name: string) =>
  `curl -H "X-Api-Key: $QLOO_API_KEY" -H "X-Lastfm-Key: $LASTFM_API_KEY" \\\n  "$NOTONQ/q/search?types=urn:entity:artist&query=${encodeURIComponent(name)}"`;
