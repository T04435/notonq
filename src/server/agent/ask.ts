// The judged agent behind the Ask playground: one question, answered twice with Qloo's own harness tools (unchanged,
// in-process). Left: Qloo alone. Right: NotOnQ, which never hides Qloo's answer: it judges whether that answer meets
// what the question asked (Jev), and only if not, climbs a fixed ladder (Qloo asked better, then the decade filter or
// NotOnQ's artist fill), judging after every rung. Each step streams out as an event, so the page shows all of it.
import "server-only";
import { gateway } from "@ai-sdk/gateway";
import { createQlooToolsFromEnvironment } from "@qloo/qloo-harness";
import { experimental_decide as decide, generateText, isStepCount, jsonSchema, Output, tool } from "ai";
import { z } from "zod";
import { ourLabelPart, REDACTED, redactBody, redactQlooIds } from "@/server/redact";
import { shorten } from "@/server/shorten";

export const AGENT_MODEL = process.env.NOTONQ_AGENT_MODEL ?? "anthropic/claude-haiku-5.5";
export const JUDGE_MODEL = "typesafe-ai/jev";

export type Column = "qloo" | "notonq";
export type Source = { source: string; url?: string; licence?: string };
/** The REST exchange behind a harness call through NotOnQ, replayed (cached, so cheap) to show developers exactly what
 * their app would send and get back: Qloo's response shape plus the notonq block. Long lists are cut to 3 for reading. */
async function exchanges(requests: Request[] | undefined, notonqBase: string, key: string): Promise<HttpExchange[]> {
  const out: HttpExchange[] = [];
  for (const r of (requests ?? []).filter((x) => (x.method ?? "GET") === "GET" && x.path)) {
    const qs = new URLSearchParams(Object.entries(r.query ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v)]));
    const res = await fetch(`${notonqBase}${r.path}?${qs}`, { headers: { "X-Api-Key": key } }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    out.push({ request: `GET /q${r.path}?${decodeURIComponent(qs.toString())}`, json: shorten(json) });
  }
  return out;
}

export type ResultItem = { id?: string; name?: string; label?: "not_in_qloo" | "picked"; location?: string; description?: string; sources?: Source[]; facts?: string[]; link?: string };

/** Where an artist in the final table came from. */
export type Origin = "qloo" | "qloo_lookup" | "qloo_again" | "qloo_via_notonq" | "notonq_added" | "notonq_picked";
export type Row = { id: string; name: string; origin: Origin; status: "kept" | "removed" | "added"; scores: { kind: string; value: string; p: number }[]; link?: string; facts?: string[]; sources?: Source[] };
export type Constraint = { kind: (typeof KINDS)[number]; value: string; check: string };
export type Judgement = { verdict: "answered" | "partly" | "not_answered"; p: Record<string, number>; met: (Constraint & { p: number })[] };
export type AskEvent =
  | { type: "call"; column: Column; stage: string; tool: string; input: unknown; status: string; results: ResultItem[] }
  | { type: "stage"; column: Column; stage: string; title: string; detail?: string }
  | { type: "constraints"; constraints: Constraint[] }
  | { type: "judge"; stage: string; judgement: Judgement }
  | { type: "answer"; column: Column; text: string; source: "qloo" | "qloo_better" | "notonq" }
  | { type: "reconcile"; rows: Row[]; summary: string; places: number }
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

export type HttpExchange = { request: string; json: unknown };
type Request = { method?: string; path?: string; query?: Record<string, unknown> };
type Call = { tool: string; input: unknown; status: string; results: ResultItem[]; requests?: Request[]; http?: HttpExchange[] };

const item = (r: unknown): ResultItem => {
  const x = (r ?? {}) as { entity_id?: string; name?: string; location?: { latitude: number; longitude: number }; properties?: { short_description?: string; description?: string }; description?: string };
  const description = String(x.properties?.short_description ?? x.properties?.description ?? x.description ?? "").slice(0, 700) || undefined;
  const label = description?.startsWith("Not in Qloo") ? "not_in_qloo" : description?.startsWith("Picked by NotOnQ") ? "picked" : undefined;
  return { id: x.entity_id, name: x.name, label, description, location: x.location ? `${x.location.latitude.toFixed(2)}, ${x.location.longitude.toFixed(2)}` : undefined };
};

type External = Record<string, { id?: string | number } | { id?: string | number }[] | undefined>;
const extId = (ext: External | undefined, ns: string) => {
  const v = ext?.[ns];
  const first = Array.isArray(v) ? v[0] : v;
  return first?.id !== undefined ? String(first.id) : undefined;
};

/** A link for every artist a step returned: its MusicBrainz record, else Wikidata, else Spotify (from the entity's own
 * external IDs, fetched through the same base the step used: Qloo's for Qloo's steps, NotOnQ's for NotOnQ's). */
async function withLinks(items: ResultItem[], base: string, key: string): Promise<ResultItem[]> {
  const ids = [...new Set(items.filter((i) => i.id && !i.location).map((i) => i.id!))];
  if (!ids.length) return items;
  const res = await fetch(`${base}/entities?entity_ids=${encodeURIComponent(ids.slice(0, 25).join(","))}`, { headers: { "X-Api-Key": key } }).catch(() => null);
  const body = (res?.ok ? await res.json().catch(() => null) : null) as { results?: { entity_id: string; properties?: { external?: External }; external?: External }[] } | null;
  const results = Array.isArray(body?.results) ? body.results : [];
  return items.map((i) => {
    const e = results.find((r) => r.entity_id?.toLowerCase() === i.id?.toLowerCase());
    if (!e) return i;
    const ext = { ...(e.external ?? {}), ...(e.properties?.external ?? {}) };
    const mb = extId(ext, "musicbrainz");
    const wd = extId(ext, "wikidata");
    const sp = extId(ext, "spotify");
    const link = mb ? `https://musicbrainz.org/artist/${mb}` : wd ? `https://www.wikidata.org/wiki/${wd}` : sp ? `https://open.spotify.com/artist/${sp}` : undefined;
    return link ? { ...i, link } : i;
  });
}

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
    // A picked record is Qloo's: only NotOnQ's MusicBrainz evidence is shown, never facts read from Qloo's copy of it.
    const fromFill = i.label === "not_in_qloo";
    const facts = [
      fromFill && ext.lastfm?.listeners !== undefined && `${Number(ext.lastfm.listeners).toLocaleString("en")} Last.fm listeners`,
      fromFill && ext["notonq:deezer"]?.fans !== undefined && `${Number(ext["notonq:deezer"].fans).toLocaleString("en")} Deezer fans`,
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
  const env = (out.details ?? JSON.parse(out.content?.[0]?.text ?? "{}")) as { status?: string; results?: unknown[]; provenance?: { requests?: Request[] } };
  await onCall({ tool: t.name, input, status: String(env.status ?? "ok"), results: (env.results ?? []).slice(0, 12).map(item), requests: env.provenance?.requests });
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

/** The same checks, asked of one artist at a time, so the final table can say which artist stayed and why. */
const ITEM_CHECKS: Partial<Record<Constraint["kind"], (name: string, v: string) => string>> = {
  era: (n, v) => `Was ${n} active in, or releasing music in, the ${v}? Activity years in the description count.`,
  place: (n, v) => `Is ${n} from ${v} or its country, or described as popular there?`,
  genre: (n, v) => `Does ${n} belong to ${v}, by tags or description?`,
  relation: (n, v) => `Could ${n} be a result derived from ${v} (an artist fans of ${v} would like)?`,
  named_entity: (n, v) => `Is ${n} the entity "${v}" itself, not a different one with a similar name?`,
};

async function judgeItems(question: string, constraints: Constraint[], items: { name: string; description?: string }[]) {
  const checks = constraints.filter((c) => ITEM_CHECKS[c.kind]);
  const questions = Object.fromEntries(
    items.flatMap((it, i) => checks.map((c, k) => [`a${i}_${k}`, { type: "boolean" as const, instructions: `${ITEM_CHECKS[c.kind]!(it.name, c.value)} Judge from that artist's entry in the state only.` }])),
  );
  if (!Object.keys(questions).length) return items.map(() => [] as Row["scores"]);
  const state = JSON.parse(JSON.stringify({ user_question: question, artists: items }));
  const res = await decide({ model: gateway.decisionModel(JUDGE_MODEL), state, questions });
  const answers = res.answers as Record<string, { probability?: number }>;
  return items.map((_, i) => checks.map((c, k) => ({ kind: c.kind, value: c.value, p: answers[`a${i}_${k}`]?.probability ?? 0 })));
}

const ENTITY_TOOLS = new Set(["qloo_recommend", "qloo_rank", "qloo_compare_audiences", "qloo_entity_tags", "qloo_audience_demographics"]);

/** The final table, built from the data rather than written by a model: every artist Qloo returned, kept or removed by
 * its own scores; artists the agent only looked up by name; and what NotOnQ added, with evidence and sources. */
/** passThrough: Qloo's answer met the question and is returned as it is, so none of its artists is removed. */
async function reconcile(question: string, constraints: Constraint[], stages: { stage: "qloo" | "better" | "notonq"; calls: Call[] }[], passThrough = false) {
  const seen = new Map<string, Omit<Row, "status" | "scores"> & { description?: string }>();
  let places = 0;
  for (const { stage, calls } of stages)
    for (const c of calls) {
      if (c.tool === "qloo_find_tags") continue;
      for (const r of c.results) {
        if (r.location) {
          places += 1;
          continue;
        }
        if (!r.id || !r.name) continue;
        const origin: Origin = r.label === "not_in_qloo" ? "notonq_added" : r.label === "picked" ? "notonq_picked" : c.tool === "qloo_describe" ? "qloo_lookup" : stage === "qloo" ? "qloo" : stage === "better" ? "qloo_again" : "qloo_via_notonq";
        if (!ENTITY_TOOLS.has(c.tool) && c.tool !== "qloo_describe" && !r.label) continue;
        const key = r.id.toLowerCase();
        if (!seen.has(key) || r.label) seen.set(key, { id: r.id, name: r.name, origin, link: r.link, facts: r.facts, sources: r.sources, description: r.description });
      }
    }
  // Up to 12 per origin, so a long Qloo list never pushes NotOnQ's additions out of the table.
  const all = [...seen.values()];
  const list = ([...new Set(all.map((r) => r.origin))] as Origin[]).flatMap((o) => all.filter((r) => r.origin === o).slice(0, 12));
  const scores = await judgeItems(question, constraints, list.map(({ name, description }) => ({ name, description })));
  const rows: Row[] = list.map(({ id, name, origin, link, facts, sources }, i) => ({
    id,
    name,
    origin,
    link,
    facts,
    sources,
    scores: scores[i],
    status: origin.startsWith("notonq") ? "added" : passThrough || scores[i].every((s) => s.p >= MET) ? "kept" : "removed",
  }));
  const count = (o: Origin[], s?: Row["status"]) => rows.filter((r) => o.includes(r.origin) && (!s || r.status === s)).length;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const meet = (k: number) => `${k} ${k === 1 ? "meets" : "meet"} it`;
  const parts = [
    passThrough
      ? `Qloo returned ${n(count(["qloo"]), "artist", "artists")} for the question and its answer meets it, so it is returned as it is.`
      : `Qloo returned ${n(count(["qloo"]), "artist", "artists")} for the question; ${meet(count(["qloo"], "kept"))}.`,
    count(["qloo_again"]) ? `Asked again, Qloo returned ${n(count(["qloo_again"]), "artist", "artists")}; ${meet(count(["qloo_again"], "kept"))}.` : "",
    count(["qloo_lookup"]) ? `The agent also looked up ${n(count(["qloo_lookup"]), "artist", "artists")} in Qloo by names it chose itself.` : "",
    count(["notonq_added", "notonq_picked"])
      ? `NotOnQ added ${n(count(["notonq_added", "notonq_picked"]), "artist", "artists")} from open data, labelled, with sources; ${meet(rows.filter((r) => r.origin.startsWith("notonq") && r.scores.every((s) => s.p >= MET)).length)}.`
      : "NotOnQ added nothing.",
  ];
  return { rows, summary: parts.filter(Boolean).join(" "), places };
}

const decadeTag = (era: string) => {
  const m = /(\d{2})(\d{2})?/.exec(era.replace(/'/g, ""));
  return m ? `urn:tag:genre:music:${(m[2] ?? m[1]).slice(-2)}s` : null;
};

/** Raw Qloo API responses never leave the server: the JSON shown under "What your app gets" is redacted by type, and
 * Qloo entity IDs are removed from every event. Results derived from Qloo (artist names, links, the agent's answer, the
 * final table) are shown, as Qloo allows; Qloo's own description text is not. NotOnQ's fills are shown in full. */
export function redactEvent(e: AskEvent): AskEvent {
  // Last pass on every event: any Qloo entity ID left in any field (request lists, inputs, notes) is removed too.
  return redactQlooIds(redactFields(e));
}

function redactFields(e: AskEvent): AskEvent {
  if (e.type === "call")
    return {
      ...e,
      input: redactQlooIds(e.input),
      results: e.results.map((r) =>
        r.label === "not_in_qloo"
          ? r
          : r.label === "picked"
            ? { ...r, id: REDACTED.uuid, description: r.description ? ourLabelPart(r.description) : undefined }
            : { ...r, id: r.id ? REDACTED.uuid : undefined, description: undefined },
      ),
      http: (e as { http?: HttpExchange[] }).http?.map((h) => ({ request: redactQlooIds(h.request), json: redactBody(h.json) })),
    } as AskEvent;
  if (e.type === "reconcile") return { ...e, rows: e.rows.map((r) => (r.origin === "notonq_added" ? r : { ...r, id: REDACTED.uuid })) };
  return e;
}

export async function ask(question: string, deps: AskDeps) {
  const d: AskDeps = { ...deps, emit: (e) => deps.emit(redactEvent(e)) };
  const qlooCalls: Call[] = [];
  const onQloo = async (c: Call) => {
    const linked = { ...c, results: await withLinks(c.results, d.qlooBase, d.qlooKey) };
    qlooCalls.push(linked);
    d.emit({ type: "call", column: "qloo", stage: "qloo", ...linked });
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
    const r = await reconcile(question, constraints, [{ stage: "qloo", calls: qlooCalls }], true);
    d.emit({ type: "reconcile", ...r });
    d.emit({ type: "answer", column: "notonq", text: "Qloo's answer meets every part of the question, so NotOnQ adds nothing.", source: "qloo" });
    return;
  }

  const stages: { stage: "qloo" | "better" | "notonq"; calls: Call[] }[] = [{ stage: "qloo", calls: qlooCalls }];
  const unmet = j.met.filter((c) => c.p < MET);
  const unknownEntity = unmet.some((c) => c.kind === "named_entity");

  if (!unknownEntity) {
    d.emit({ type: "stage", column: "notonq", stage: "better", title: "Asking Qloo again, differently", detail: `Unmet: ${unmet.map((c) => `${c.kind} (${c.value})`).join(", ")}` });
    const calls: Call[] = [];
    await agent(
      d.qlooBase,
      d.qlooKey,
      `${SYSTEM}\nQloo was asked once and its answer did not meet: ${unmet.map((c) => `${c.kind}: ${c.value}`).join("; ")}. Ask Qloo differently to meet them: find exact tags with qloo_find_tags (genres or scenes tied to the place and era), use the place as signal_location or filter_location, seed with artists Qloo resolves. Do not use a decade tag as include_tags.`,
      question,
      async (c) => {
        const linked = { ...c, results: await withLinks(c.results, d.qlooBase, d.qlooKey) };
        calls.push(linked);
        d.emit({ type: "call", column: "notonq", stage: "better", ...linked });
      },
    );
    j = await judge(question, constraints, calls);
    d.emit({ type: "judge", stage: "better", judgement: j });
    stages.push({ stage: "better", calls });
    if (j.verdict === "answered") {
      const r = await reconcile(question, constraints, stages);
      d.emit({ type: "reconcile", ...r });
      d.emit({ type: "answer", column: "notonq", text: r.summary, source: "qloo_better" });
      return;
    }
  }

  const era = constraints.find((c) => c.kind === "era");
  const place = constraints.find((c) => c.kind === "place");
  const tag = era ? decadeTag(era.value) : null;
  const calls: Call[] = [];
  const onNotOnQ = async (c: Call) => {
    const [withSourcesFound, http] = await Promise.all([withSources(c.results, d.notonqBase, d.qlooKey), exchanges(c.requests, d.notonqBase, d.qlooKey)]);
    const full = { ...c, results: await withLinks(withSourcesFound, d.notonqBase, d.qlooKey), http };
    calls.push(full);
    d.emit({ type: "call", column: "notonq", stage: "notonq", ...full });
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
  stages.push({ stage: "notonq", calls });
  const r = await reconcile(question, constraints, stages);
  d.emit({ type: "reconcile", ...r });
  d.emit({ type: "answer", column: "notonq", text: r.summary, source: "notonq" });
}
