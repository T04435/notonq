// GhostQ's own Qloo request shapes (its src/server/qloo/api.ts and agent tools, 27 Oct 2026), sent to Qloo and to
// NotOnQ for one artist, side by side. Real calls, nothing mocked; prints names and counts only (no raw Qloo data).
//   QLOO_API_KEY=… node scripts/ghostq-shapes.mjs "bassvictim" [notonqBase]
const NAME = process.argv[2] ?? "bassvictim";
const NOTONQ = process.argv[3] ?? "http://localhost:3400/q/app/ghostq-dev";
const QLOO = "https://hackathon.api.qloo.com";
const KEY = process.env.QLOO_API_KEY;
if (!KEY) throw new Error("QLOO_API_KEY is not set");

const MELBOURNE = { "signal.location": "POINT(144.9631 -37.8136)", "signal.location.radius": "15000", "signal.demographics.age": "25_to_29,30_to_34" };
const WORLD = "POLYGON((-179 -60,179 -60,179 80,-179 80,-179 -60))";

async function get(base, path, params) {
  const r = await fetch(`${base}${path}?${new URLSearchParams(params)}`, { headers: { "X-Api-Key": KEY } });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const list = (j) => {
  const r = j?.results;
  const xs = Array.isArray(r) ? r : (r?.entities ?? r?.tags ?? r?.heatmap ?? r?.demographics ?? r?.audiences ?? (r?.tags === undefined && r ? Object.values(r).flat() : []));
  return xs;
};
const label = (e) => e?.name ?? e?.tag_id ?? e?.id ?? (e?.location ? "cell" : e?.entity_id ? "entry" : "row");
const line = (x) => `${x.status} · ${list(x.json).length} · ${list(x.json).slice(0, 6).map(label).join(", ")}${x.json?.notonq?.served_by ? ` · served_by ${x.json.notonq.served_by}` : ""}`;

// 1. Find artist: GhostQ searches by name and picks the exact name (or its Spotify ID).
const [qs, ns] = await Promise.all([get(QLOO, "/search", { query: NAME, types: "urn:entity:artist", take: 5 }), get(NOTONQ, "/search", { query: NAME, types: "urn:entity:artist", take: 5 })]);
const exact = (x) => (Array.isArray(x.json?.results) ? x.json.results : []).find((e) => e.name.toLowerCase() === NAME.toLowerCase());
const qa = exact(qs);
const na = exact(ns);
console.log(`find_artist "${NAME}"\n  Qloo   : ${qa ? `${qa.name}` : "no exact match"}\n  NotOnQ : ${na ? `${na.name} ${na.entity_id}` : "no exact match"}`);
if (na) {
  const p = na.properties ?? {};
  console.log(`  label  : ${(p.short_description ?? "").slice(0, 220)}`);
  console.log(`  home   : ${JSON.stringify(p["notonq:home"] ?? null)}`);
  console.log(`  tags   : ${(na.tags ?? []).map((t) => t.tag_id).join(", ")}`);
  console.log(`  ids    : spotify ${JSON.stringify(p.external?.spotify ?? null)} · musicbrainz ${JSON.stringify(p.external?.musicbrainz ?? null)} · wikidata ${JSON.stringify(p.external?.wikidata ?? null)}`);
}
const ID = na?.entity_id ?? qa?.entity_id;
if (!ID) process.exit(0);
const genres = (na?.tags ?? qa?.tags ?? []).map((t) => t.tag_id ?? t.id).filter((t) => /^urn:tag:genre:music:/.test(t)).slice(0, 3);

const other = (await get(QLOO, "/search", { query: "Charli xcx", types: "urn:entity:artist", take: 1 })).json?.results?.[0]?.entity_id;
const shapes = [
  ["sound_alikes", "/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": ID, take: 10 }],
  ["crowd demographics", "/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": ID }],
  ["world heatmap", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": ID, "filter.location": WORLD }],
  ["crowd_tags (with artist)", "/v2/insights", { "filter.type": "urn:tag", "filter.tag.types": "urn:tag:theme:qloo,urn:tag:style:qloo,urn:tag:genre:music", ...MELBOURNE, "signal.interests.entities": ID, take: 15 }],
  ["fan_audiences", "/v2/insights", { "filter.type": "urn:audience", "signal.interests.entities": ID, take: 8 }],
  ...(genres.length
    ? [
        ["artists_in_genres", "/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.tags": genres.join(","), take: 10 }],
        ["local_scene (genre + Melbourne point)", "/v2/insights", { "filter.type": "urn:entity:artist", "filter.tags": genres.join(","), ...MELBOURNE, take: 10 }],
        ["local_scene (with artist)", "/v2/insights", { "filter.type": "urn:entity:artist", "filter.tags": genres.join(","), ...MELBOURNE, "signal.interests.entities": ID, take: 10 }],
      ]
    : []),
  ["CollabQ compare (vs Charli xcx)", "/v2/analysis/compare", { "a.signal.interests.entities": ID, "b.signal.interests.entities": other, "filter.type": "urn:tag" }],
];
for (const [name, path, params] of shapes) {
  const [q, n] = await Promise.all([get(QLOO, path, params), get(NOTONQ, path, params)]);
  console.log(`\n${name}\n  Qloo   : ${line(q)}\n  NotOnQ : ${line(n)}`);
  if (n.json?.notonq?.request?.place) console.log(`  place  : ${n.json.notonq.request.place}`);
}
