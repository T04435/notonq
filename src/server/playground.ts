// What the playground shows for one artist: Qloo's own answer (status and message, summarised: never a raw dump),
// then either the candidates to choose from, or NotOnQ's filled entity with a source per field, the stand-ins, and
// "fans also like" answered by Qloo.
import { demandText } from "@/lib/demand";
import type { FallbackEntity } from "@/server/engine/artist";
import type { Candidate } from "@/server/engine/candidates";
import { needsResearch, researchEnabled } from "@/server/research/run";
import { fallbackBlock, type NotOnQBlock } from "@/server/respond";
import type { Demand, StoredFallback } from "@/server/store/repo";
import { type Lookup } from "@/server/service";

export type Step = { title: string; detail: string; status?: "error" | "pending" };

export type PlaygroundView = {
  query: string;
  servedBy: "qloo" | "fallback" | "needs_choice";
  qloo: { status: number; label: string; message?: string; summary: string; entityName?: string };
  entity: FallbackEntity | null;
  candidates: Candidate[];
  /** The candidate this fill is anchored on, so a re-check returns the same artist. */
  candidateKey?: string;
  notonq: NotOnQBlock;
  alsoLike: { names: string[]; via: "artist" | "stand-ins" | "none"; note?: string };
  dropIn: { request: string; response: unknown };
  steps: Step[];
  ms: number;
};

/** A stored fill as a read-only view for the Ledger: no lookup, no Qloo call, nothing counted as demand. */
export function storedView(f: StoredFallback, demand: Demand): PlaygroundView {
  const steps: Step[] = [
    {
      title: "Qloo",
      status: "error",
      detail: f.gapKind === "G2" ? "Found in Qloo search, but not usable as a taste signal" : "Qloo had no artist with this name when it was asked",
    },
    { title: "Filled", detail: `First filled ${new Date(f.createdAt).toUTCString()}, last refreshed ${new Date(f.refreshedAt).toUTCString()}` },
  ];
  if (f.entity)
    steps.push({
      title: "Stand-ins",
      detail: f.standIns.length ? `${f.standIns.length} similar artists Qloo knows: ${f.standIns.map((s) => s.name).join(", ")}` : "No similar artist known to Qloo",
      status: f.standIns.length ? undefined : "error",
    });
  if (f.entity) steps.push(researchStep(f));
  steps.push({ title: "Demand", detail: demandText(demand) });
  const notonq = fallbackBlock(f, demand, { hit: true });
  return {
    query: f.name,
    servedBy: "fallback",
    qloo: {
      status: f.gapKind === "G2" ? 400 : 404,
      label: f.gapKind === "G2" ? "400 not in taste graph" : "no match",
      summary: f.gapKind === "G2" ? "Qloo can find the name but has no taste data for it." : "Qloo has no artist with this name.",
    },
    entity: f.entity,
    candidates: [],
    candidateKey: f.candidateKey,
    notonq,
    alsoLike: { names: [], via: "none", note: "Open it in the playground to see Qloo's live answer for the stand-ins" },
    dropIn: { request: dropInRequest(f.name, f.candidateKey), response: { results: f.entity ? [f.entity] : [], notonq } },
    steps,
    ms: 0,
  };
}

function researchStep(f: StoredFallback): Step {
  const researched = Object.values(f.provenance).flat().filter((p) => p.method === "researched").length;
  if (f.researchStatus === "done") return { title: "Research", detail: researched ? `${researched} facts found on the web, each quote checked on its page` : "Nothing verifiable found on the web" };
  if (f.researchStatus === "pending") return { title: "Research", status: "pending", detail: "Searching the web for what's still missing; quotes are checked before anything is shown" };
  if (f.researchStatus === "failed") return { title: "Research", status: "error", detail: "The research run failed; it will not retry automatically" };
  if (!needsResearch(f)) return { title: "Research", detail: "Not needed: open data covered every field" };
  return researchEnabled() ? { title: "Research", status: "pending", detail: "Queued" } : { title: "Research", detail: "Off here (no AI Gateway credential)" };
}

const dropInRequest = (name: string, candidateKey?: string) =>
  `curl -H "X-Api-Key: $QLOO_API_KEY" -H "X-Lastfm-Key: $LASTFM_API_KEY" \\\n  "$NOTONQ/q/search?types=urn:entity:artist&query=${encodeURIComponent(name)}${candidateKey ? `&notonq.candidate=${encodeURIComponent(candidateKey)}` : ""}"`;
