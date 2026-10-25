// Prototype of the judged agent playground. Real calls throughout.
// 1. Qloo alone: an agent with Qloo's own harness tools, base URL = Qloo.
// 2. Constraints: the user's question as checkable constraints (era, place, genre, named entity, relation...).
// 3. Judge: did Qloo's answer meet them? Jev (decision model) and Sonnet 5.5, side by side.
// 4. Only if not answered: the NotOnQ agent, same harness, base URL = NotOnQ, told what was missing; it retries
//    other Qloo requests first, and NotOnQ fills with labelled open data only where Qloo still has nothing.
// node --env-file=.env.local scripts/judge-agent.mjs "Find me 60s music popular in Lagos"
import { gateway } from "@ai-sdk/gateway";
import { createQlooToolsFromEnvironment } from "@qloo/qloo-harness";
import { experimental_decide as decide, generateText, isStepCount, jsonSchema, Output, tool } from "ai";
import { z } from "zod";

const question = process.argv[2] ?? "Find me 60s music popular in Lagos";
const NOTONQ = process.argv[3] ?? "http://localhost:3400/q/app/playground-judge";
const QLOO = "https://hackathon.api.qloo.com";
const AGENT = "anthropic/claude-haiku-5.5";
const JUDGE = "anthropic/claude-sonnet-5.5";

const BASE_SYSTEM = `You answer culture and taste questions with the Qloo tools. Call tools; never answer from memory.
There is no person to ask: when a tool returns needs_input with candidates, pick the best one from the question and
call again. If an entity's description says "Not in Qloo" or "Picked by NotOnQ", say so next to it. Answer briefly:
a list of names, one line each.`;

const trim = (r) =>
  r && typeof r === "object"
    ? {
        name: r.name,
        description: String(r.properties?.short_description ?? r.properties?.description ?? r.description ?? "").slice(0, 220) || undefined,
        tags: (r.tags ?? []).slice(0, 5).map((t) => t.name).filter(Boolean),
        location: r.location ? `${r.location.latitude},${r.location.longitude}` : undefined,
      }
    : r;

function agentTools(base) {
  const harness = createQlooToolsFromEnvironment({ env: { QLOO_API_KEY: process.env.QLOO_API_KEY, QLOO_BASE_URL: base, QLOO_TRUSTED_BASE_URL: base, PATH: process.env.PATH, HOME: process.env.HOME } });
  const calls = [];
  const tools = Object.fromEntries(
    harness.map((t) => [
      t.name,
      tool({
        description: [t.description, t.promptSnippet, ...(t.promptGuidelines ?? [])].filter(Boolean).join("\n"),
        inputSchema: jsonSchema(t.parameters),
        execute: async (input) => {
          const out = await t.execute(`call-${calls.length + 1}`, input);
          const env = out.details ?? JSON.parse(out.content?.[0]?.text ?? "{}");
          calls.push({ tool: t.name, input, status: env.status, requests: env.provenance?.requests ?? [], results: (env.results ?? []).slice(0, 12).map(trim) });
          return out.content?.[0]?.text ?? JSON.stringify(env);
        },
      }),
    ]),
  );
  return { tools, calls };
}

async function agent(base, system, prompt) {
  const { tools, calls } = agentTools(base);
  const t0 = Date.now();
  const res = await generateText({ model: gateway(AGENT), system, prompt, tools, stopWhen: isStepCount(10) });
  return { calls, text: res.text, ms: Date.now() - t0 };
}

const Constraints = z.object({
  constraints: z.array(z.object({ kind: z.enum(["subject_type", "named_entity", "era", "place", "genre", "relation", "audience"]), value: z.string(), check: z.string() })),
});

async function constraintsOf(q) {
  const { output } = await generateText({
    model: gateway(AGENT),
    output: Output.object({ schema: Constraints }),
    prompt: `Turn this question into the constraints an answer must meet. Use only kinds that apply. "check" is a yes/no question a reviewer can answer from a list of results (names, descriptions, tags, map points).\nQuestion: ${q}`,
  });
  return output.constraints;
}

const Verdict = z.object({
  constraints: z.array(z.object({ kind: z.string(), met: z.enum(["yes", "partly", "no"]), evidence: z.string() })),
  verdict: z.enum(["answered", "partly", "not_answered"]),
  try_next: z.string(),
});

async function sonnetJudge(state) {
  const t0 = Date.now();
  const { output } = await generateText({
    model: gateway(JUDGE),
    output: Output.object({ schema: Verdict }),
    prompt: `You check whether Qloo's results answer a user's question. Judge each constraint ONLY from the results given (names, descriptions, tags, map points); quote names or fields as evidence. Results that are generic (true anywhere) do not meet a place constraint. "answered" only if every constraint is met.\n${JSON.stringify(state)}`,
  });
  return { ...output, ms: Date.now() - t0 };
}

async function jevJudge(state, constraints) {
  const t0 = Date.now();
  const questions = Object.fromEntries(constraints.map((c, i) => [`c${i}`, { type: "boolean", instructions: `${c.check} Judge only from the Qloo results in the state; generic results do not meet a place constraint.` }]));
  questions.verdict = {
    type: "choice",
    instructions: "Did Qloo's results answer the user's question, judged only from the results in the state?",
    criteria: { answered: "Every constraint is met by the results.", partly: "Some constraints are met, some are not.", not_answered: "The key constraints are not met, or there are no results." },
  };
  // Jev takes strict JSON only (no undefined fields).
  const res = await decide({ model: gateway.decisionModel("typesafe-ai/jev"), state: JSON.parse(JSON.stringify(state)), questions });
  return { answers: res.answers, ms: Date.now() - t0, usage: res.usage };
}

// --- run ---
console.log(`Q: ${question}\n`);
const [qloo, constraints] = await Promise.all([agent(QLOO, BASE_SYSTEM, question), constraintsOf(question)]);
console.log(`=== 1. Qloo alone (${(qloo.ms / 1000).toFixed(1)} s)`);
for (const c of qloo.calls) {
  console.log(`  ${c.tool} ${JSON.stringify(c.input)} → ${c.status}`);
  if (c.results.length) console.log(`     ${c.results.map((r) => r?.name ?? r?.location).join(", ")}`);
}
console.log(`  ANSWER: ${qloo.text.replace(/\n+/g, " | ").slice(0, 600)}\n`);
console.log("=== 2. Constraints");
for (const c of constraints) console.log(`  ${c.kind}: ${c.value} — ${c.check}`);

const state = { user_question: question, constraints, qloo_tool_calls: qloo.calls.map(({ tool, input, status, results }) => ({ tool, input, status, results })) };
const [sonnet, jev] = await Promise.all([sonnetJudge(state), jevJudge(state, constraints).catch((e) => ({ error: String(e?.message ?? e).slice(0, 400) }))]);
console.log(`\n=== 3a. Judge: Sonnet 5.5 (${(sonnet.ms / 1000).toFixed(1)} s) → ${sonnet.verdict}`);
for (const c of sonnet.constraints) console.log(`  ${c.kind}: ${c.met} — ${c.evidence.slice(0, 200)}`);
console.log(`  try next: ${sonnet.try_next.slice(0, 300)}`);
console.log(`\n=== 3b. Judge: Jev ${jev.ms ? `(${(jev.ms / 1000).toFixed(1)} s, ${jev.usage?.inputTokens} input tokens)` : ""}`);
console.log(`  ${JSON.stringify(jev.answers ?? jev.error, null, 0).slice(0, 900)}`);

if (sonnet.verdict === "answered") {
  console.log("\n=== 4. Qloo answered: NotOnQ adds nothing.");
} else {
  const missing = sonnet.constraints.filter((c) => c.met !== "yes").map((c) => `${c.kind} (${c.evidence.slice(0, 120)})`).join("; ");
  const system = `${BASE_SYSTEM}
Qloo was already asked once and its answer did not meet: ${missing}. Suggested: ${sonnet.try_next}
Try different Qloo requests that could meet those constraints: e.g. a tag as include_tags (a filter) instead of
signal_tags, the place as signal_location or filter_location, qloo_find_tags to find the exact tag, or describing a
named entity. Where Qloo has no data, this endpoint adds artists from open sources labelled "Not in Qloo" or "Picked by
NotOnQ". In the answer, say which results came from Qloo's own answer and which were added.`;
  const notonq = await agent(NOTONQ, system, question);
  console.log(`\n=== 4. With NotOnQ (${(notonq.ms / 1000).toFixed(1)} s)`);
  for (const c of notonq.calls) {
    console.log(`  ${c.tool} ${JSON.stringify(c.input)} → ${c.status}`);
    if (c.results.length) console.log(`     ${c.results.map((r) => `${r?.name ?? r?.location}${String(r?.description ?? "").match(/^(Not in Qloo|Picked by NotOnQ)/) ? " [NotOnQ]" : ""}`).join(", ")}`);
  }
  console.log(`  ANSWER: ${notonq.text.replace(/\n+/g, " | ").slice(0, 900)}`);
}
