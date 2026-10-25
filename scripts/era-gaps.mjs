// v0.3.0 measurement: how often does Qloo answer artist insights by decade/genre tag and place with nothing, or with
// little? Read-only, one call per cell, against the hackathon host with QLOO_API_KEY. Writes JSON to argv[2].
import { writeFileSync } from "node:fs";

const BASE = process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";
const key = process.env.QLOO_API_KEY;
if (!key) throw new Error("QLOO_API_KEY missing");

const TAGS = ["50s", "60s", "70s", "80s", "bolero", "rock_70s"].map((t) => `urn:tag:genre:music:${t}`);
const PLACES = ["New York", "Melbourne", "Havana", "Lagos", "Manila", "Glasgow", "Lima", "Tbilisi"];
const TAKE = 10;

async function insights(params) {
  const url = `${BASE}/v2/insights?${new URLSearchParams({ "filter.type": "urn:entity:artist", take: String(TAKE), ...params })}`;
  const res = await fetch(url, { headers: { "X-Api-Key": key } });
  const body = await res.json().catch(() => null);
  const entities = body?.results?.entities ?? [];
  return { status: res.status, count: entities.length, top: entities.slice(0, 3).map((e) => e.name), error: res.ok ? undefined : JSON.stringify(body).slice(0, 160) };
}

const rows = [];
for (const tag of TAGS) rows.push({ tag, place: null, ...(await insights({ "filter.tags": tag })) });
for (const place of PLACES) rows.push({ tag: null, place, ...(await insights({ "signal.location.query": place })) });
for (const tag of TAGS)
  for (const place of PLACES) rows.push({ tag, place, ...(await insights({ "filter.tags": tag, "signal.location.query": place })) });

// Counts only in the saved file: Qloo's own response data never goes into this public repo.
const saved = rows.map((r) => ({ ...r, top: undefined }));
writeFileSync(process.argv[2] ?? "era-gaps.json", JSON.stringify({ at: new Date().toISOString(), take: TAKE, note: "Counts only.", rows: saved }, null, 2));
const cells = rows.filter((r) => r.tag && r.place);
const empty = cells.filter((r) => r.status === 200 && r.count === 0).length;
const thin = cells.filter((r) => r.status === 200 && r.count > 0 && r.count < 5).length;
const errors = cells.filter((r) => r.status !== 200).length;
console.log(`tag × place cells: ${cells.length} · empty ${empty} · thin (<5) ${thin} · errors ${errors}`);
for (const r of rows) console.log([r.tag?.split(":").pop() ?? "-", r.place ?? "-", r.status, r.count, r.top.join(" | "), r.error ?? ""].join("\t"));
