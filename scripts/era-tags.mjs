// Which music decade/genre tags does Qloo have? Small read-only run against the hackathon host with QLOO_API_KEY.
// node --env-file=.env.local scripts/era-tags.mjs 60s 1960s "60s rock" bolero
const BASE = process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";
const key = process.env.QLOO_API_KEY;
if (!key) throw new Error("QLOO_API_KEY missing");

for (const q of process.argv.slice(2)) {
  const url = `${BASE}/v2/tags?${new URLSearchParams({ "filter.query": q, "feature.semantic_search": "true", take: "8" })}`;
  const res = await fetch(url, { headers: { "X-Api-Key": key } });
  const body = await res.json().catch(() => null);
  const tags = body?.results?.tags ?? body?.results ?? [];
  console.log(`\n# ${q} → ${res.status}`);
  for (const t of Array.isArray(tags) ? tags : []) console.log(`  ${t.id ?? t.tag_id}  ${t.name}  ${t.type ?? ""}`);
}
