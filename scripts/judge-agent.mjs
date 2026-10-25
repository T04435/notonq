// Prototype of the judged agent playground. Real calls throughout.
// 0. Qloo alone: an agent with Qloo's own harness tools, base URL = Qloo. Always shown.
// 1. Constraints: only what the question states (era, place, genre, named entity, relation...).
// 2. Judge (Jev): did the answer meet them? Stops as soon as it did.
// 3. Ladder, each rung judged again:
//    a. Qloo, asked better: same harness, base URL = Qloo, told which constraints were unmet.
//    b. Decade filter: one fixed harness call through NotOnQ (include_tags = the decade tag, signal_location = place).
//       NotOnQ fills only where Qloo returns nothing, labelled "Not in Qloo" / "Picked by NotOnQ".
// node --env-file=.env.local scripts/judge-agent.mjs "Find me 60s music popular in Lagos" [--quiet]
import { gateway } from "@ai-sdk/gateway";
import { createQlooToolsFromEnvironment } from "@qloo/qloo-harness";
import { experimental_decide as decide, generateText, isStepCount, jsonSchema, Output, tool } from "ai";
import { z } from "zod";

const question = process.argv[2] ?? "Find me 60s music popular in Lagos";
const NOTONQ = process.env.NOTONQ_BASE ?? "http://localhost:3400/q/app/playground-judge";
const QLOO = "https://hackathon.api.qloo.com";
const AGENT = "anthropic/claude-haiku-5.5";

const BASE_SYSTEM = `You answer culture and taste questions with the Qloo tools. Call tools; never answer from memory
and never add names the tools did not return. There is no person to ask: when a tool returns needs_input with
candidates, pick the best one from the question and call again. Answer briefly: a list of names, one line each.`;

const trim = (r) =>
  r && typeof r === "object"
    ? {
        name: r.name,
        // Long enough to keep both NotOnQ's label and the facts after it (origin, years).
        description: String(r.properties?.short_description ?? r.properties?.description ?? r.description ?? "").slice(0, 700) || undefined,
        tags: (r.tags ?? []).slice(0, 5).map((t) => t.name).filter(Boolean),
        location: r.location ? `${r.location.latitude},${r.location.longitude}` : undefined,
      }
    : r;

function harnessTools(base) {
  return createQlooToolsFromEnvironment({ env: { QLOO_API_KEY: process.env.QLOO_API_KEY, QLOO_BASE_URL: base, QLOO_TRUSTED_BASE_URL: base, PATH: process.env.PATH, HOME: process.env.HOME } });
}

async function runTool(t, input, calls) {
  const out = await t.execute(`call-${calls.length + 1}`, input);
  const env = out.details ?? JSON.parse(out.content?.[0]?.text ?? "{}");
  calls.push({ tool: t.name, input, status: env.status, results: (env.results ?? []).slice(0, 12).map(trim) });
  return out.content?.[0]?.text ?? JSON.stringify(env);
}

async function agent(base, system, prompt) {
  const calls = [];
  const tools = Object.fromEntries(
    harnessTools(base).map((t) => [
      t.name,
      tool({ description: [t.description, t.promptSnippet, ...(t.promptGuidelines ?? [])].filter(Boolean).join("\n"), inputSchema: jsonSchema(t.parameters), execute: (input) => runTool(t, input, calls) }),
    ]),
  );
  const res = await generateText({ model: gateway(AGENT), system, prompt, tools, stopWhen: isStepCount(10) });
  return { calls, text: res.text };
}

const Constraints = z.object({
  constraints: z.array(z.object({ kind: z.enum(["subject_type", "named_entity", "era", "place", "genre", "relation", "audience"]), value: z.string(), check: z.string() })),
});

async function constraintsOf(q) {
  const { output } = await generateText({
    model: gateway(AGENT),
    output: Output.object({ schema: Constraints }),
    prompt: `List the constraints an answer to this question must meet, using ONLY what the question's own words state.
Do not add a genre, mood, era, place or audience the question does not name. "Similar to X" or "fans of X" is one
relation constraint (results derived from X), not a genre. "Popular in <place>" or "in <place>" is ONE place
constraint, never also a relation. Map points (latitude,longitude) count as places. Each "check" is a yes/no question a reviewer can answer
from a list of results (names, descriptions, tags, map points).
Question: ${q}`,
  });
  return output.constraints;
}

async function judge(constraints, calls) {
  const state = JSON.parse(JSON.stringify({ user_question: question, constraints, tool_calls: calls.map(({ tool, input, status, results }) => ({ tool, input, status, results })) }));
  const questions = Object.fromEntries(
    constraints.map((c, i) => [`c${i}`, { type: "boolean", instructions: `${c.check} Judge only from the tool results in the state. Results that are true anywhere do not meet a place constraint.` }]),
  );
  questions.verdict = {
    type: "choice",
    instructions: "Do the tool results in the state answer the user's question, judged only from those results?",
    criteria: { answered: "Every constraint is met by the results.", partly: "Some constraints are met, some are not.", not_answered: "The key constraints are not met, or there are no results." },
  };
  const t0 = Date.now();
  const res = await decide({ model: gateway.decisionModel("typesafe-ai/jev"), state, questions });
  const met = constraints.map((c, i) => ({ ...c, p: res.answers[`c${i}`].probability }));
  return { verdict: res.answers.verdict.choice, p: res.answers.verdict.probabilities, met, unmet: met.filter((c) => c.p < 0.5), ms: Date.now() - t0 };
}

const show = (calls) =>
  calls
    .filter((c) => c.results.length)
    .map((c) => `${c.tool}: ${c.results.map((r) => `${r?.name ?? r?.location}${/^(Not in Qloo|Picked by NotOnQ)/.test(String(r?.description ?? "")) ? " [NotOnQ]" : ""}`).slice(0, 8).join(", ")}`);

// The decade tag Qloo uses for an era constraint ("1960s", "60s" → urn:tag:genre:music:60s), found with Qloo's own tag search.
async function decadeTag(era) {
  const m = /(\d{2})(\d{2})?s?/.exec(era.replace(/'/g, ""));
  if (!m) return null;
  const short = `${(m[2] ?? m[1]).slice(-2)}s`;
  const find = harnessTools(QLOO).find((t) => t.name === "qloo_find_tags");
  const calls = [];
  await runTool(find, { query: short, limit: 10 }, calls);
  const ids = (JSON.parse(JSON.stringify(calls[0]?.results ?? []))).map((r) => r?.name);
  return { tag: `urn:tag:genre:music:${short}`, seen: ids.length > 0 };
}

// --- run ---
const log = [];
const out = (s) => log.push(s);
out(`Q: ${question}`);
const [qloo, constraints] = await Promise.all([agent(QLOO, BASE_SYSTEM, question), constraintsOf(question)]);
out(`constraints: ${constraints.map((c) => `${c.kind}=${c.value}`).join("; ")}`);
out(`0 Qloo alone: ${show(qloo.calls).join(" || ") || "(no results)"}`);
let j = await judge(constraints, qloo.calls);
out(`  judge: ${j.verdict} ${JSON.stringify(j.p)} | ${j.met.map((c) => `${c.kind} ${c.p}`).join(", ")}`);

if (j.verdict !== "answered") {
  const missing = j.unmet.map((c) => `${c.kind}: ${c.value}`).join("; ");
  // Qloo can't be asked better about an artist it doesn't know: a stand-in query would answer a different question.
  const unknownEntity = j.unmet.some((c) => c.kind === "named_entity");
  const better = unknownEntity ? { calls: [], text: "" } : await agent(
    QLOO,
    `${BASE_SYSTEM}\nQloo was asked once and its answer did not meet: ${missing}. Ask Qloo differently to meet them: find exact tags with qloo_find_tags (genres or scenes tied to the place and era), use the place as signal_location or filter_location, seed with artists Qloo resolves. Do not use a decade tag as include_tags.`,
    question,
  );
  if (unknownEntity) out("a Qloo asked better: skipped (Qloo does not know the named entity)");
  else {
    out(`a Qloo asked better: ${show(better.calls).join(" || ") || "(no results)"}`);
    j = await judge(constraints, better.calls);
    out(`  judge: ${j.verdict} ${JSON.stringify(j.p)} | ${j.met.map((c) => `${c.kind} ${c.p}`).join(", ")}`);
  }
  if (j.verdict === "answered") out(`  → answered by Qloo (asked better); NotOnQ adds nothing`);

  const era = constraints.find((c) => c.kind === "era");
  const place = constraints.find((c) => c.kind === "place");
  if (j.verdict !== "answered" && era) {
    const d = await decadeTag(era.value);
    const calls = [];
    const rec = harnessTools(NOTONQ).find((t) => t.name === "qloo_recommend");
    await runTool(rec, { target_type: "artist", include_tags: [d.tag], ...(place ? { signal_location: place.value } : {}), limit: 10 }, calls);
    out(`b decade filter via NotOnQ (${d.tag}${place ? ` @ ${place.value}` : ""}): ${show(calls).join(" || ") || "(no results)"}`);
    j = await judge(constraints, calls);
    out(`  judge: ${j.verdict} ${JSON.stringify(j.p)} | ${j.met.map((c) => `${c.kind} ${c.p}`).join(", ")}`);
  } else if (j.verdict !== "answered") {
    const via = await agent(NOTONQ, `${BASE_SYSTEM}\nIf an entity's description says "Not in Qloo" or "Picked by NotOnQ", say so next to it.`, question);
    out(`b via NotOnQ: ${show(via.calls).join(" || ") || "(no results)"}`);
    j = await judge(constraints, via.calls);
    out(`  judge: ${j.verdict} ${JSON.stringify(j.p)} | ${j.met.map((c) => `${c.kind} ${c.p}`).join(", ")}`);
  }
} else out(`  → Qloo answered; NotOnQ adds nothing`);
console.log(log.join("\n"));
