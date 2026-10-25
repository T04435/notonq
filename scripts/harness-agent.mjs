// Proof for the agent playground: one question, one model, Qloo's own harness tools (in-process, unchanged), run
// twice: base URL = Qloo, and base URL = NotOnQ. Real calls throughout (AI Gateway via OIDC/key, Qloo, NotOnQ).
// node --env-file=.env.local scripts/harness-agent.mjs "Find me 60s music popular in Lagos" [notonqBase]
import { gateway } from "@ai-sdk/gateway";
import { createQlooToolsFromEnvironment } from "@qloo/qloo-harness";
import { generateText, isStepCount, jsonSchema, tool } from "ai";

const question = process.argv[2] ?? "Find me 60s music popular in Lagos";
const NOTONQ = process.argv[3] ?? "http://localhost:3400/q/app/playground-agent";
const QLOO = "https://hackathon.api.qloo.com";
const MODEL = process.env.NOTONQ_AGENT_MODEL ?? "anthropic/claude-haiku-5.5";

const SYSTEM = `You answer culture and taste questions with the Qloo tools. Call tools; never answer from memory.
There is no person to ask follow-up questions: when a tool returns needs_input with candidates, pick the best one
from the question's context and call the tool again. Report what the tools returned. If an entity's description says
"Not in Qloo" or "Picked by NotOnQ", say so next to it. Keep the answer short: a list of names with one line each.`;

function toolsFor(base) {
  const harness = createQlooToolsFromEnvironment({
    env: { QLOO_API_KEY: process.env.QLOO_API_KEY, QLOO_BASE_URL: base, QLOO_TRUSTED_BASE_URL: base, PATH: process.env.PATH, HOME: process.env.HOME },
  });
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
          calls.push({ tool: t.name, input, status: env.status, requests: env.provenance?.requests ?? [], names: (env.results ?? []).slice(0, 8).map((r) => r.name) });
          return out.content?.[0]?.text ?? JSON.stringify(env);
        },
      }),
    ]),
  );
  return { tools, calls };
}

async function run(label, base) {
  const { tools, calls } = toolsFor(base);
  const started = Date.now();
  const res = await generateText({ model: gateway(MODEL), system: SYSTEM, prompt: question, tools, stopWhen: isStepCount(8) });
  return { label, ms: Date.now() - started, calls, text: res.text, usage: res.totalUsage };
}

const results = await Promise.all([run("Qloo alone", QLOO), run("With NotOnQ", NOTONQ)]);
console.log(`Q: ${question}  (model ${MODEL})\n`);
for (const r of results) {
  console.log(`=== ${r.label} · ${(r.ms / 1000).toFixed(1)} s · tokens in ${r.usage?.inputTokens} out ${r.usage?.outputTokens}`);
  for (const c of r.calls) {
    console.log(`  ${c.tool} ${JSON.stringify(c.input)} → ${c.status}`);
    for (const q of c.requests) console.log(`     ${q.method} ${q.path} ${JSON.stringify(q.query ?? q.body)}`);
    if (c.names.length) console.log(`     results: ${c.names.join(", ")}`);
  }
  console.log(`  ANSWER:\n${r.text.split("\n").map((l) => `    ${l}`).join("\n")}\n`);
}
