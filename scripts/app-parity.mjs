// Every Qloo request shape GhostQ (feat/notonq-harness) and Busk Map (dev/core client.ts) send, to Qloo and to NotOnQ,
// side by side, both lanes (REST and Qloo's own harness). Real calls, nothing mocked; prints verdicts and counts only.
//   Known artist: NotOnQ must return Qloo's answer unchanged ("same"). Gap artist: NotOnQ must answer, labelled ("filled").
//   QLOO_API_KEY=… node scripts/app-parity.mjs [notonqBase] [knownName] [gapName]
import { createQlooToolsFromEnvironment } from "@qloo/qloo-harness";

const NOTONQ = process.argv[2] ?? "http://localhost:3400/q/app/parity-dev";
const KNOWN = process.argv[3] ?? "Tame Impala";
const GAP = process.argv[4] ?? "Alter Boy";
const QLOO = "https://hackathon.api.qloo.com";
const KEY = process.env.QLOO_API_KEY;
if (!KEY) throw new Error("QLOO_API_KEY is not set");

const MELBOURNE_BOX = "POLYGON((144.85 -37.90,145.05 -37.90,145.05 -37.70,144.85 -37.70,144.85 -37.90))";
const MELBOURNE = "POINT(144.9631 -37.8136)";
const WORLD = "POLYGON((-179 -60,179 -60,179 80,-179 80,-179 -60))";

async function get(base, path, params) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ""));
  try {
    const r = await fetch(`${base}${path}?${new URLSearchParams(clean)}`, { headers: { "X-Api-Key": KEY }, signal: AbortSignal.timeout(40_000) });
    return { status: r.status, json: await r.json().catch(() => null) };
  } catch (e) {
    return { status: 0, json: null, error: e.name };
  }
}

// Qloo's own payload, without NotOnQ's block and fields that change per call.
const VOLATILE = new Set(["notonq", "duration", "took", "request_id"]);
const canon = (v) =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter((k) => !VOLATILE.has(k)).sort().map((k) => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const rows = (j) => {
  const r = j?.results;
  if (Array.isArray(r)) return r;
  if (!r || typeof r !== "object") return [];
  return r.entities ?? r.tags ?? r.heatmap ?? r.demographics ?? r.audiences ?? r.trending ?? [...(r.a ?? []), ...(r.b ?? [])];
};
const notonq = (j) => j?.notonq?.served_by ?? (JSON.stringify(j ?? {}).includes("NotOnQ") ? "labelled" : null);

const results = [];
// Qloo answers empty for the known artist too (trending, 29 Oct): an empty fill matches Qloo, so it isn't a NotOnQ gap.
const qlooEmptyForKnown = (lane, kind) => results.some((r) => r.who === "known" && r.lane === lane && r.kind === kind && r.verdict === "same" && r.empty);
function record(app, kind, lane, who, verdict, detail, empty = false) {
  if (verdict === "GAP" && qlooEmptyForKnown(lane, kind)) verdict = "as-qloo";
  results.push({ app, kind, lane, who, verdict, detail, empty });
  console.log(`${verdict.padEnd(9)} ${app.padEnd(8)} ${lane.padEnd(7)} ${who.padEnd(5)} ${kind}${detail ? ` · ${detail}` : ""}`);
}

async function restPair(app, kind, path, params, who) {
  const [q, n] = await Promise.all([get(QLOO, path, params), get(NOTONQ, path, params)]);
  const counts = `Qloo ${q.status}/${rows(q.json).length} · NotOnQ ${n.status}/${rows(n.json).length}`;
  if (who === "known") {
    if (q.status === n.status && same(q.json, n.json)) return record(app, kind, "rest", who, "same", counts, rows(q.json).length === 0);
    // Qloo may vary between two calls; ask it again before calling it a difference.
    const q2 = await get(QLOO, path, params);
    if (!same(q.json, q2.json)) return record(app, kind, "rest", who, "qloo-var", `${counts} (Qloo itself differs call to call)`);
    return record(app, kind, "rest", who, "DIFF", `${counts}${notonq(n.json) ? ` · NotOnQ added: ${notonq(n.json)}` : ""}`);
  }
  if (n.status === 200 && rows(n.json).length > 0) return record(app, kind, "rest", who, "filled", `${counts}${notonq(n.json) ? ` · ${notonq(n.json)}` : ""}`);
  if (q.status === 200 && rows(q.json).length > 0 && n.status === 200) return record(app, kind, "rest", who, "qloo", counts);
  return record(app, kind, "rest", who, "GAP", counts);
}

// The harness, both ways: one tool set straight to Qloo, one through NotOnQ.
const toolsFor = (base) =>
  new Map(createQlooToolsFromEnvironment({ env: { QLOO_API_KEY: KEY, QLOO_BASE_URL: base, QLOO_TRUSTED_BASE_URL: base, PATH: process.env.PATH, HOME: process.env.HOME } }).map((t) => [t.name, t]));
const QT = toolsFor(QLOO);
const NT = toolsFor(NOTONQ);
async function run(tools, name, input) {
  try {
    const out = await tools.get(name).execute(`parity-${Date.now()}`, input, AbortSignal.timeout(40_000));
    const d = out.details ?? JSON.parse(out.content?.[0]?.text ?? "{}");
    const r = d.results ?? [];
    return { status: d.status, raw: r, results: Array.isArray(r) ? r : Object.values(r).flat(), summary: d.summary ?? "" };
  } catch (e) {
    return { status: "throw", raw: null, results: [], summary: String(e.message ?? e).slice(0, 80) };
  }
}
async function harnessPair(app, kind, name, input, who) {
  const [q, n] = await Promise.all([run(QT, name, input), run(NT, name, input)]);
  const counts = `Qloo ${q.status}/${q.results.length} · NotOnQ ${n.status}/${n.results.length}`;
  if (who === "known") {
    if (q.status === n.status && same(q.raw, n.raw)) return record(app, kind, "harness", who, "same", counts, q.results.length === 0);
    const q2 = await run(QT, name, input);
    if (!same(q.raw, q2.raw)) return record(app, kind, "harness", who, "qloo-var", counts);
    return record(app, kind, "harness", who, "DIFF", `${counts} · ${n.summary.slice(0, 80)}`);
  }
  if (n.status === "ok" && n.results.length > 0) return record(app, kind, "harness", who, "filled", counts);
  return record(app, kind, "harness", who, "GAP", `${counts} · ${n.summary.slice(0, 100)}`);
}

// Resolve each artist the way the apps do: /search, exact name, through each base.
async function resolve(base, name) {
  const s = await get(base, "/search", { query: name, types: "urn:entity:artist", take: 5 });
  return (Array.isArray(s.json?.results) ? s.json.results : []).find((e) => e.name?.toLowerCase() === name.toLowerCase());
}
const known = await resolve(QLOO, KNOWN);
const other = await resolve(QLOO, "Charli xcx");
const gap = await resolve(NOTONQ, GAP);
if (!known || !other) throw new Error(`Qloo has no exact match for ${KNOWN} or Charli xcx`);
if (!gap) console.log(`! NotOnQ has no exact match for ${GAP}; gap rows will show GAP`);
const qlooHasGap = await resolve(QLOO, GAP);
console.log(`known ${KNOWN} · gap ${GAP} (${qlooHasGap ? "Qloo HAS it: pick another gap artist" : "not in Qloo"}) · NotOnQ ${NOTONQ}\n`);
const genreOf = async (base, id) => rows((await get(base, "/v2/insights", { "filter.type": "urn:tag", "filter.tag.types": "urn:tag:genre:music", "filter.parents.types": "urn:entity:artist", "signal.interests.entities": id, take: 3 })).json).map((t) => t.tag_id ?? t.id).filter(Boolean);
const knownSpotify = known.properties?.external?.spotify?.[0]?.id;
const gapSpotify = gap?.properties?.external?.spotify?.[0]?.id;

function restShapes(id, tags, spotify, otherId) {
  return [
    ["both", "search", "/search", { query: id === known.entity_id ? KNOWN : GAP, types: "urn:entity:artist", take: 5 }],
    ["both", "entity detail", "/entities", { entity_ids: id }],
    ...(spotify ? [["busk", "entities by spotify id", "/entities", { "external.spotify.ids": spotify }]] : []),
    ["both", "sound-alikes (taste artists)", "/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": id, take: 10 }],
    ["both", "demographics", "/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": id }],
    ["busk", "heatmap (Melbourne box)", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": id, "filter.location": MELBOURNE_BOX }],
    ["busk", "heatmap + boundary", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": id, "filter.location": MELBOURNE_BOX, "output.heatmap.boundary": "urn:entity:locality" }],
    ["ghostq", "world heatmap", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": id, "filter.location": WORLD }],
    ["busk", "places (point, radius, hours)", "/v2/insights", { "filter.type": "urn:entity:place", "filter.location": MELBOURNE, "filter.location.radius": 3000, "filter.hours": "friday", "signal.interests.entities": id, take: 10 }],
    ["busk", "local artists (polygon + signal)", "/v2/insights", { "filter.type": "urn:entity:artist", "signal.location": MELBOURNE_BOX, "signal.interests.entities": id, take: 10 }],
    ...(tags.length ? [["busk", "scene artists (polygon + tags)", "/v2/insights", { "filter.type": "urn:entity:artist", "signal.location": MELBOURNE_BOX, "signal.interests.tags": tags.join(","), take: 10 }]] : []),
    ["busk", "affinity at point (rank)", "/v2/insights", { "filter.type": "urn:entity:artist", "filter.results.entities": `${id},${otherId}`, "signal.location": MELBOURNE, "signal.location.radius": 5000 }],
    ["busk", "affinity for signal (rank)", "/v2/insights", { "filter.type": "urn:entity:artist", "filter.results.entities": `${id},${otherId}`, "signal.interests.entities": otherId }],
    ["busk", "trending", "/v2/trending", { "signal.interests.entities": id, "filter.type": "urn:entity:artist", "filter.start_date": "2026-09-28", "filter.end_date": "2026-10-27" }],
    ["busk", "crowd tags (point)", "/v2/insights", { "filter.type": "urn:tag", "filter.tag.types": "urn:tag:genre:music", "filter.parents.types": "urn:entity:artist", "signal.interests.entities": id, "signal.location": MELBOURNE, "signal.location.radius": 5000, take: 10 }],
    ["busk", "artist genres", "/v2/insights", { "filter.type": "urn:tag", "filter.tag.types": "urn:tag:genre:music", "filter.parents.types": "urn:entity:artist", "signal.interests.entities": id, take: 10 }],
    ["ghostq", "crowd tags (theme/style/genre)", "/v2/insights", { "filter.type": "urn:tag", "filter.tag.types": "urn:tag:theme:qloo,urn:tag:style:qloo,urn:tag:genre:music", "signal.location": MELBOURNE, "signal.location.radius": 15000, "signal.interests.entities": id, take: 15 }],
    ["ghostq", "fan audiences", "/v2/insights", { "filter.type": "urn:audience", "signal.interests.entities": id, take: 8 }],
    ["both", "compare (analysis/compare)", "/v2/analysis/compare", { "a.signal.interests.entities": id, "b.signal.interests.entities": otherId }],
  ];
}
const NO_ARTIST = [
  ["busk", "global artists (popularity.min)", "/v2/insights", { "filter.type": "urn:entity:artist", "filter.popularity.min": 0.9, take: 10 }],
  ["busk", "genre tag search", "/v2/tags", { "filter.query": "indie pop", "filter.tag.types": "urn:tag:genre:music", take: 5 }],
];
function harnessShapes(id, tags) {
  return [
    ["ghostq", "qloo_recommend (signals)", "qloo_recommend", { target_type: "artist", signals: [id], limit: 10 }],
    ...(tags.length ? [["ghostq", "qloo_recommend (signal_tags)", "qloo_recommend", { target_type: "artist", signal_tags: tags, signal_tags_operator: "intersection", limit: 10 }]] : []),
    ["ghostq", "qloo_audience_demographics", "qloo_audience_demographics", { entity: id, entity_type: "artist" }],
    ["busk", "qloo_where_popular", "qloo_where_popular", { entity: id, entity_type: "artist", within: "Melbourne, Australia" }],
    ["busk", "qloo_entity_tags", "qloo_entity_tags", { entities: [id], entity_type: "artist" }],
    ["busk", "qloo_trends", "qloo_trends", { entities: [id], entity_type: "artist", start_date: "2026-09-28", end_date: "2026-10-27" }],
    ["busk", "qloo_rank", "qloo_rank", { options: [id, other.entity_id], option_type: "artist", signal_location: "Melbourne, Australia" }],
    ["busk", "qloo_compare_audiences", "qloo_compare_audiences", { group_a: [id], group_b: [other.entity_id] }],
    ["busk", "qloo_find_tags", "qloo_find_tags", { query: "indie pop", limit: 5 }],
    ["both", "qloo_describe", "qloo_describe", { entity: id, type: "artist" }],
  ];
}

const knownTags = await genreOf(QLOO, known.entity_id);
for (const [app, kind, path, params] of NO_ARTIST) await restPair(app, kind, path, params, "known");
for (const [app, kind, path, params] of restShapes(known.entity_id, knownTags, knownSpotify, other.entity_id)) await restPair(app, kind, path, params, "known");
for (const [app, kind, name, input] of harnessShapes(known.entity_id, knownTags)) await harnessPair(app, kind, name, input, "known");
if (gap) {
  const gapTags = (gap.tags ?? []).map((t) => t.tag_id ?? t.id).filter((t) => /^urn:tag:genre:music:/.test(t ?? "")).slice(0, 3);
  for (const [app, kind, path, params] of restShapes(gap.entity_id, gapTags, gapSpotify, other.entity_id)) await restPair(app, kind, path, params, "gap");
  for (const [app, kind, name, input] of harnessShapes(gap.entity_id, gapTags)) await harnessPair(app, kind, name, input, "gap");
}

const bad = results.filter((r) => r.verdict === "DIFF" || r.verdict === "GAP");
console.log(`\n${results.length} checks · ${results.filter((r) => r.verdict === "same").length} same · ${results.filter((r) => r.verdict === "filled").length} filled · ${results.filter((r) => r.verdict === "as-qloo").length} empty as Qloo is for known acts · ${results.filter((r) => r.verdict === "qloo-var").length} Qloo varies · ${bad.length} to look at`);
process.exitCode = bad.length ? 1 : 0;
