// `notonq mcp`: the official Qloo MCP server (@qloo/qloo-harness, unchanged) with NotOnQ behind it. The harness's tools
// are re-exposed 1:1 under their own names; results NotOnQ filled come back as status "partial" with a pointer to the
// provenance, and an ambiguous artist comes back as "needs_input" with the candidates. Three tools are NotOnQ's own.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { startProxy } from "./proxy.mjs";

const require = createRequire(import.meta.url);
const VERSION = require("../package.json").version;
// The harness exports only its library entry (dist/index.js); its CLI sits next to it as dist/bin.js.
const harnessBin = () => join(dirname(fileURLToPath(import.meta.resolve("@qloo/qloo-harness"))), "bin.js");

const OWN_TOOLS = [
  {
    name: "notonq_candidates",
    description: "List every artist a name could be, across MusicBrainz, Last.fm and Deezer, when Qloo has no data for it. Use the key of one with notonq_fill.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Artist name" } }, required: ["name"] },
  },
  {
    name: "notonq_fill",
    description: "Fill an artist Qloo has no data for from one chosen candidate. Returns a Qloo-shaped entity (ID starts with notonq:) that works as a signal in qloo_recommend and other tools.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Artist name" }, candidate: { type: "string", description: "Candidate key from notonq_candidates" } },
      required: ["name", "candidate"],
    },
  },
  {
    name: "notonq_provenance",
    description: "Where every value of a NotOnQ entity came from (source, record URL, licence, method), plus its stand-ins and confidence.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "A notonq: entity ID" } }, required: ["id"] },
  },
];

const sameName = (a, b) => norm(a) === norm(b);
const norm = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The harness's result envelope (contract 1.0-preview.1), for NotOnQ's own tools and rewritten statuses. */
function envelope(operation, status, summary, results, extra = {}) {
  const body = {
    schema_version: "1.0-preview.1",
    operation,
    status,
    summary,
    results,
    result_count: Array.isArray(results) ? results.length : results ? 1 : 0,
    execution: { transport: "mcp", transport_name: "notonq", correlation_id: randomUUID(), duration_ms: 0 },
    provenance: { source: "NotOnQ (open data + Qloo via stand-ins)", endpoint: operation, documentation: "https://github.com/T04435/notonq" },
    ...extra,
  };
  return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, isError: status === "error" };
}

export async function startNotonqMcp({ notonqUrl, qlooKey, lastfmKey, app = "notonq-mcp" }) {
  const proxy = await startProxy({ target: `${notonqUrl.replace(/\/+$/, "")}/q`, lastfmKey, app });
  const rest = async (path, params) => {
    const res = await fetch(`${proxy.url}${path}?${new URLSearchParams(params)}`, { headers: { "X-Api-Key": qlooKey } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const harness = new Client({ name: "notonq", version: VERSION });
  await harness.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [harnessBin(), "mcp"],
      env: { ...process.env, QLOO_API_KEY: qlooKey, QLOO_BASE_URL: proxy.url, QLOO_TRUSTED_BASE_URL: proxy.url },
      stderr: "ignore",
    }),
  );
  const { tools } = await harness.listTools();

  const server = new Server({ name: "notonq", version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools, ...OWN_TOOLS] }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const args = params.arguments ?? {};
    if (params.name === "notonq_candidates") {
      const { body } = await rest("/search", { query: args.name, types: "urn:entity:artist", "notonq.choose": "1" });
      const candidates = body?.notonq?.candidates ?? [];
      return candidates.length
        ? envelope("notonq_candidates", "needs_input", `${candidates.length} possible artists for "${args.name}". Call notonq_fill with one key.`, candidates)
        : envelope("notonq_candidates", body?.notonq ? "empty" : "ok", body?.notonq ? "No source knows this name." : "Qloo knows this artist: use qloo_search.", []);
    }
    if (params.name === "notonq_fill") {
      const { body } = await rest("/search", { query: args.name, types: "urn:entity:artist", "notonq.candidate": args.candidate });
      const filled = (body?.results ?? []).filter((e) => String(e.entity_id).startsWith("notonq:"));
      return filled.length
        ? envelope("notonq_fill", "partial", `Filled "${filled[0].name}" from open data (${body.notonq?.confidence ?? "high"} confidence). Not Qloo data: see notonq_provenance.`, filled, { notonq: body.notonq })
        : envelope("notonq_fill", "empty", "Nothing could be filled from that candidate.", []);
    }
    if (params.name === "notonq_provenance") {
      const { body } = await rest("/entities", { entity_ids: args.id });
      const block = body?.notonq?.[args.id];
      return block ? envelope("notonq_provenance", "ok", `Provenance for ${args.id}`, block) : envelope("notonq_provenance", "empty", "No NotOnQ entity with that ID.", null);
    }

    const { args: forwarded, replaced } = await swapSignals(args, rest);
    const result = await harness.callTool({ name: params.name, arguments: forwarded });
    return markFallbacks(params.name, args, result, rest, replaced);
  });

  await server.connect(new StdioServerTransport());
  const close = async () => {
    await harness.close().catch(() => {});
    await proxy.close();
  };
  // Exit with the client: when it disconnects (stdin closes) or signals us, stop the harness and the proxy too.
  server.onclose = () => close().then(() => process.exit(0));
  process.on("SIGINT", () => close().then(() => process.exit(0)));
  process.on("SIGTERM", () => close().then(() => process.exit(0)));
  return { close };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The harness only takes Qloo UUIDs as signals. A named signal Qloo has no data for (or a notonq: ID) is swapped
 * for the Qloo UUIDs of its stand-ins, so the harness asks Qloo for the stand-ins instead (Qloo Support's fallback). */
async function swapSignals(args, rest) {
  if (!Array.isArray(args.signals)) return { args, replaced: [] };
  const out = [];
  const replaced = [];
  for (const s of args.signals) {
    if (UUID.test(s)) {
      out.push(s);
      continue;
    }
    const { body } = String(s).startsWith("notonq:") ? await rest("/entities", { entity_ids: s }) : await rest("/search", { query: s, types: "urn:entity:artist" });
    const block = String(s).startsWith("notonq:") ? body?.notonq?.[s] : body?.notonq;
    const standIns = block?.proxy?.stand_ins ?? [];
    if (block && block.served_by !== "qloo" && standIns.length) {
      out.push(...standIns.map((x) => x.entity_id));
      replaced.push({ signal: s, stand_ins: standIns.map((x) => x.name) });
    } else out.push(s);
  }
  return { args: { ...args, signals: [...new Set(out)].slice(0, 10) }, replaced };
}

/** Results that contain NotOnQ entities are relabelled "partial"; an artist lookup (qloo_describe) with no exact
 * match is checked against NotOnQ, and an ambiguous name becomes "needs_input" with the candidates. */
async function markFallbacks(tool, args, result, rest, replaced = []) {
  const env = result.structuredContent;
  if (!env || typeof env !== "object") return result;
  if (replaced.length && env.status !== "error") {
    const note = replaced.map((r) => `"${r.signal}" → ${r.stand_ins.join(", ")}`).join("; ");
    const next = { ...env, status: env.status === "ok" ? "partial" : env.status, warnings: [...(env.warnings ?? []), `Qloo has no taste data for some signals; NotOnQ asked Qloo for similar artists it does know instead: ${note}.`], notonq_replaced: replaced };
    return { ...result, content: [{ type: "text", text: JSON.stringify(next) }], structuredContent: next };
  }
  const text = JSON.stringify(env.results ?? "");
  if (text.includes('"notonq:')) {
    const next = { ...env, status: env.status === "ok" ? "partial" : env.status, warnings: [...(env.warnings ?? []), "Some results were filled by NotOnQ from open data, not Qloo. IDs starting notonq: work as signals; call notonq_provenance for sources."] };
    return { ...result, content: [{ type: "text", text: JSON.stringify(next) }], structuredContent: next };
  }
  const name = tool === "qloo_describe" && (!args.type || args.type === "artist") ? args.entity : undefined;
  const results = Array.isArray(env.results) ? env.results : env.results ? [env.results] : [];
  if (name && !results.some((r) => sameName(r?.name, name))) {
    const { body } = await rest("/search", { query: name, types: "urn:entity:artist" });
    if (body?.notonq?.served_by === "needs_choice") {
      const next = { ...env, status: "needs_input", summary: `Qloo has no artist named "${name}". Choose one candidate and call notonq_fill.`, notonq_candidates: body.notonq.candidates };
      return { ...result, content: [{ type: "text", text: JSON.stringify(next) }], structuredContent: next };
    }
  }
  return result;
}
