// The judged agent behind the Ask playground: one question, answered twice with Qloo's own harness tools (unchanged,
// in-process). Left: Qloo alone. Right: NotOnQ, which never hides Qloo's answer: it judges whether that answer meets
// what the question asked (Jev), and only if not, climbs a fixed ladder (Qloo asked better, then the decade filter or
// NotOnQ's artist fill), judging after every rung. Each step streams out as an event, so the page shows all of it.
import "server-only";
import { gateway } from "@ai-sdk/gateway";
import { createQlooToolsFromEnvironment } from "@qloo/qloo-harness";
import { experimental_decide as decide, generateText, isStepCount, jsonSchema, Output, tool } from "ai";
import { z } from "zod";

export const AGENT_MODEL = process.env.NOTONQ_AGENT_MODEL ?? "anthropic/claude-haiku-5.5";
export const JUDGE_MODEL = "typesafe-ai/jev";

export type Column = "qloo" | "notonq";
export type Source = { source: string; url?: string; licence?: string };
export type ResultItem = { id?: string; name?: string; label?: "not_in_qloo" | "picked"; location?: string; description?: string; sources?: Source[]; facts?: string[] };
export type Constraint = { kind: (typeof KINDS)[number]; value: string; check: string };
export type Judgement = { verdict: "answered" | "partly" | "not_answered"; p: Record<string, number>; met: (Constraint & { p: number })[] };
export type AskEvent =
  | { type: "call"; column: Column; stage: string; tool: string; input: unknown; status: string; results: ResultItem[] }
  | { type: "stage"; column: Column; stage: string; title: string; detail?: string }
  | { type: "constraints"; constraints: Constraint[] }
  | { type: "judge"; stage: string; judgement: Judgement }
  | { type: "answer"; column: Column; text: string; source: "qloo" | "qloo_better" | "notonq" }
  | { type: "error"; column?: Column; message: string }
  | { type: "done" };

export type AskDeps = { qlooKey: string; qlooBase: string; notonqBase: string; emit: (e: AskEvent) => void };

const KINDS = ["subject_type", "named_entity", "era", "place", "genre", "relation", "audience"] as const;
/** A constraint counts as met at this probability or above. */
export const MET = 0.6;

const SYSTEM = `You answer culture and taste questions with the Qloo tools. Call tools; never answer from memory and never
add names the tools did not return. There is no person to ask: when a tool returns needs_input with candidates, pick the
best one from the question and call again. If an entity's description says "Not in Qloo" or "Picked by NotOnQ", say so
next to it. Answer briefly: a short list, one line each.`;

type Call = { tool: string; input: unknown; status: string; results: ResultItem[] };

const item = (r: unknown): ResultItem => {
  const x = (r ?? {}) as { entity_id?: string; name?: string; location?: { latitude: number; longitude: number }; properties?: { short_description?: string; description?: string }; description?: string };
  const description = String(x.properties?.short_description ?? x.properties?.description ?? x.description ?? "").slice(0, 700) || undefined;
  const label = description?.startsWith("Not in Qloo") ? "not_in_qloo" : description?.startsWith("Picked by NotOnQ") ? "picked" : undefined;
  return { id: x.entity_id, name: x.name, label, description, location: x.location ? `${x.location.latitude.toFixed(2)}, ${x.location.longitude.toFixed(2)}` : undefined };
};

const SOURCE_NAMES: Record<string, string> = { musicbrainz: "MusicBrainz", wikidata: "Wikidata", wikipedia: "Wikipedia", lastfm: "Last.fm", deezer: "Deezer", "wikimedia-commons": "Wikimedia Commons", notonq: "NotOnQ (derived)", research: "Research" };

/** The harness only passes a name and description on, so for every result NotOnQ added, the page fetches where its
 * values came from (NotOnQ's provenance) and the facts behind it, through the same NotOnQ endpoint. */
async function withSources(items: ResultItem[], notonqBase: string, key: string): Promise<ResultItem[]> {
  const ids = [...new Set(items.filter((i) => i.label && i.id).map((i) => i.id!))];
  if (!ids.length) return items;
  const res = await fetch(`${notonqBase}/entities?entity_ids=${encodeURIComponent(ids.join(","))}`, { headers: { "X-Api-Key": key } }).catch(() => null);
  const body = (res?.ok ? await res.json().catch(() => null) : null) as {
    results?: { entity_id: string; properties?: { external?: Record<string, { id?: string | number; listeners?: number; fans?: number }> } }[];
    notonq?: Record<string, { provenance?: Record<string, { source: string; record?: string; licence?: string }[]> }>;
  } | null;
  if (!body) return items;
  return items.map((i) => {
    if (!i.label || !i.id) return i;
    const entity = body.results?.find((e) => e.entity_id.toLowerCase() === i.id!.toLowerCase());
    const ext = entity?.properties?.external ?? {};
    const sources = new Map<string, Source>();
    for (const list of Object.values(body.notonq?.[i.id]?.provenance ?? body.notonq?.[i.id.toLowerCase()]?.provenance ?? {}))
      for (const p of list) if (!sources.has(p.source)) sources.set(p.source, { source: SOURCE_NAMES[p.source] ?? p.source, url: p.record?.startsWith("http") ? p.record : undefined, licence: p.licence });
    const mbid = ext.musicbrainz?.id;
    if (mbid && !sources.has("musicbrainz")) sources.set("musicbrainz", { source: "MusicBrainz", url: `https://musicbrainz.org/artist/${mbid}`, licence: "CC0-1.0" });
    const facts = [
      ext.lastfm?.listeners !== undefined && `${Number(ext.lastfm.listeners).toLocaleString("en")} Last.fm listeners`,
      ext["notonq:deezer"]?.fans !== undefined && `${Number(ext["notonq:deezer"].fans).toLocaleString("en")} Deezer fans`,
      /\(MusicBrainz: ([^)]+)\)/.exec(i.description ?? "")?.[1],
    ].filter(Boolean) as string[];
    return { ...i, sources: [...sources.values()], facts };
  });
}

function harness(base: string, key: string) {
  return createQlooToolsFromEnvironment({ env: { ...process.env, QLOO_API_KEY: key, QLOO_BASE_URL: base, QLOO_TRUSTED_BASE_URL: base } });
}

type HarnessTool = ReturnType<typeof harness>[number];

async function runTool(t: HarnessTool, input: unknown, onCall: (c: Call) => void | Promise<void>) {
  const out = (await t.execute(`call-${Date.now()}`, input as never, undefined, undefined, undefined as never)) as { content?: { text?: string }[]; details?: Record<string, unknown> };
  const env = (out.details ?? JSON.parse(out.content?.[0]?.text ?? "{}")) as { status?: string; results?: unknown[] };
  await onCall({ tool: t.name, input, status: String(env.status ?? "ok"), results: (env.results ?? []).slice(0, 12).map(item) });
  return out.content?.[0]?.text ?? JSON.stringify(env);
}

async function agent(base: string, key: string, system: string, question: string, onCall: (c: Call) => void | Promise<void>) {
  const tools = Object.fromEntries(
    harness(base, key).map((t) => [
      t.name,
      tool({
        description: [t.description, t.promptSnippet, ...(t.promptGuidelines ?? [])].filter(Boolean).join("\n"),
        inputSchema: jsonSchema(t.parameters as never),
        execute: (input: unknown) => runTool(t, input, onCall),
      }),
    ]),
  );
  const res = await generateText({ model: gateway(AGENT_MODEL), system, prompt: question, tools, stopWhen: isStepCount(10) });
  return res.text;
}

/** The yes/no check for each kind of constraint: fixed wording, so the judge reads every question the same way. */
const CHECKS: Record<Constraint["kind"], (v: string) => string> = {
  subject_type: (v) => `Are the results ${/song|track|music|album/i.test(v) ? "music artists or albums" : v}?`,
  named_entity: (v) => `Do the results come from "${v}" itself (resolved by name, or labelled as NotOnQ's record of it), not from a different entity with a similar name?`,
  era: (v) => `Were most results active in, or releasing music in, the ${v}? Activity years in a description count.`,
  place: (v) => `Are most results from ${v} or its country, or shown as popular there? Map points inside ${v} count; results that are true anywhere do not.`,
  genre: (v) => `Do most results belong to ${v}, by their tags or description?`,
  relation: (v) => `Were the results derived from ${v}: returned for it as the signal or as NotOnQ's stand-ins for it?`,
  audience: (v) => `Was the ${v} audience used to produce the results?`,
};

async function constraintsOf(question: string): Promise<Constraint[]> {
  const { output } = await generateText({
    model: gateway(AGENT_MODEL),
    output: Output.object({ schema: z.object({ constraints: z.array(z.object({ kind: z.enum(KINDS), value: z.string() })) }) }),
    prompt: `List the constraints an answer to this question must meet, using ONLY what the question's own words state.
Rules: at most one subject_type, with a plain value (e.g. "artists"). Do not add a genre, mood, era, place or audience
the question does not name. "Similar to X" or "fans of X" is one relation constraint (value: X), not a genre. "Popular
in <place>" or "in <place>" is ONE place constraint (value: the place). A named artist is a named_entity (value: the name).
Question: ${question}`,
  });
  return output.constraints.map((c) => ({ ...c, check: CHECKS[c.kind](c.value) }));
}

async function judge(question: string, constraints: Constraint[], calls: Call[]): Promise<Judgement> {
  const state = JSON.parse(JSON.stringify({ user_question: question, constraints, tool_calls: calls }));
  const questions: Record<string, { type: "boolean"; instructions: string } | { type: "choice"; instructions: string; criteria: Record<string, string> }> = Object.fromEntries(
    constraints.map((c, i) => [`c${i}`, { type: "boolean" as const, instructions: `${c.check} Judge only from the tool results in the state. Results that are true anywhere do not meet a place constraint.` }]),
  );
  questions.verdict = {
    type: "choice",
    instructions: "Do the tool results in the state answer the user's question, judged only from those results?",
    criteria: { answered: "Every constraint is met by the results.", partly: "Some constraints are met, some are not.", not_answered: "The key constraints are not met, or there are no results." },
  };
  const res = await decide({ model: gateway.decisionModel(JUDGE_MODEL), state, questions });
  const answers = res.answers as Record<string, { probability?: number; choice?: string; probabilities?: Record<string, number> }>;
  const met = constraints.map((c, i) => ({ ...c, p: answers[`c${i}`]?.probability ?? 0 }));
  // The verdict follows the per-constraint scores (each one shown on the page), so it is easy to check: answered when
  // every constraint is likely met, partly when some are. Jev's own overall choice is kept in p for reference.
  const ok = met.filter((c) => c.p >= MET);
  const verdict: Judgement["verdict"] = met.length && ok.length === met.length ? "answered" : ok.length ? "partly" : "not_answered";
  return { verdict, p: answers.verdict.probabilities ?? {}, met };
}

const decadeTag = (era: string) => {
  const m = /(\d{2})(\d{2})?/.exec(era.replace(/'/g, ""));
  return m ? `urn:tag:genre:music:${(m[2] ?? m[1]).slice(-2)}s` : null;
};

async function finalAnswer(question: string, sections: { title: string; calls: Call[] }[]) {
  const { text } = await generateText({
    model: gateway(AGENT_MODEL),
    prompt: `Answer the question from these tool results only. Say plainly which names came from Qloo's own answer and which
NotOnQ added: an entity whose description starts "Not in Qloo" or "Picked by NotOnQ" is NotOnQ's; say so next to it.
A tool call with status needs_input did not answer: its candidates are Qloo's "did you mean" suggestions, not part of
Qloo's answer. Never list them as answers; mention them only as names Qloo suggested instead. Likewise, a result about a
different entity than the one the question names (a look-alike name) is not an answer.
No names that are not in the results. A short list, one line each, then one sentence on where the data came from.
Question: ${question}
${JSON.stringify(sections)}`,
  });
  return text;
}

export async function ask(question: string, d: AskDeps) {
  const qlooCalls: Call[] = [];
  const onQloo = (c: Call) => {
    qlooCalls.push(c);
    d.emit({ type: "call", column: "qloo", stage: "qloo", ...c });
  };
  const qlooRun = agent(d.qlooBase, d.qlooKey, SYSTEM, question, onQloo).then(
    (text) => d.emit({ type: "answer", column: "qloo", text, source: "qloo" }),
    (e: unknown) => d.emit({ type: "error", column: "qloo", message: String((e as Error)?.message ?? e) }),
  );
  const constraints = await constraintsOf(question);
  d.emit({ type: "constraints", constraints });
  await qlooRun;

  d.emit({ type: "stage", column: "notonq", stage: "judge", title: "Did Qloo answer the question?" });
  let j = await judge(question, constraints, qlooCalls);
  d.emit({ type: "judge", stage: "qloo", judgement: j });
  if (j.verdict === "answered") {
    d.emit({ type: "answer", column: "notonq", text: "Qloo's answer meets every part of the question, so NotOnQ adds nothing.", source: "qloo" });
    return;
  }

  const sections: { title: string; calls: Call[] }[] = [{ title: "Qloo's own answer", calls: qlooCalls }];
  const unmet = j.met.filter((c) => c.p < MET);
  const unknownEntity = unmet.some((c) => c.kind === "named_entity");

  if (!unknownEntity) {
    d.emit({ type: "stage", column: "notonq", stage: "better", title: "Asking Qloo again, differently", detail: `Unmet: ${unmet.map((c) => `${c.kind} (${c.value})`).join(", ")}` });
    const calls: Call[] = [];
    const text = await agent(
      d.qlooBase,
      d.qlooKey,
      `${SYSTEM}\nQloo was asked once and its answer did not meet: ${unmet.map((c) => `${c.kind}: ${c.value}`).join("; ")}. Ask Qloo differently to meet them: find exact tags with qloo_find_tags (genres or scenes tied to the place and era), use the place as signal_location or filter_location, seed with artists Qloo resolves. Do not use a decade tag as include_tags.`,
      question,
      (c) => {
        calls.push(c);
        d.emit({ type: "call", column: "notonq", stage: "better", ...c });
      },
    );
    j = await judge(question, constraints, calls);
    d.emit({ type: "judge", stage: "better", judgement: j });
    sections.push({ title: "Qloo, asked again", calls });
    if (j.verdict === "answered") {
      d.emit({ type: "answer", column: "notonq", text, source: "qloo_better" });
      return;
    }
  }

  const era = constraints.find((c) => c.kind === "era");
  const place = constraints.find((c) => c.kind === "place");
  const tag = era ? decadeTag(era.value) : null;
  const calls: Call[] = [];
  const onNotOnQ = async (c: Call) => {
    const sourced = { ...c, results: await withSources(c.results, d.notonqBase, d.qlooKey) };
    calls.push(sourced);
    d.emit({ type: "call", column: "notonq", stage: "notonq", ...sourced });
  };
  if (tag) {
    d.emit({ type: "stage", column: "notonq", stage: "notonq", title: "Decade filter through NotOnQ", detail: `${tag}${place ? ` with ${place.value}` : ""}: NotOnQ fills it only where Qloo returns nothing` });
    const rec = harness(d.notonqBase, d.qlooKey).find((t) => t.name === "qloo_recommend")!;
    await runTool(rec, { target_type: "artist", include_tags: [tag], ...(place ? { signal_location: place.value } : {}), limit: 10 }, onNotOnQ);
  } else {
    d.emit({ type: "stage", column: "notonq", stage: "notonq", title: "Asking through NotOnQ", detail: "Same tools; NotOnQ fills what Qloo has no data for, labelled" });
    await agent(d.notonqBase, d.qlooKey, SYSTEM, question, onNotOnQ);
  }
  j = await judge(question, constraints, calls);
  d.emit({ type: "judge", stage: "notonq", judgement: j });
  sections.push({ title: tag ? "Decade filter through NotOnQ" : "Through NotOnQ", calls });
  d.emit({ type: "answer", column: "notonq", text: await finalAnswer(question, sections), source: "notonq" });
}
