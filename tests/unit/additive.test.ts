// Changes to NotOnQ's responses must be additive: other apps read them. Each scenario runs real handlers on fixed
// fixtures; the baseline (additive.baseline.json) is the same scenarios' output on the last release. Against it, every
// response must keep its status, served_by (the X-NotOnQ-Served-By header), every key, value, type and array order.
// The only differences allowed are the new keys listed in ALLOWED. To refresh the baseline from a release checkout:
// NOTONQ_BASELINE_OUT=<file> pnpm vitest run tests/unit/additive.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleRest } from "@/server/rest";
import { memoryDb } from "@/server/store/db";
import { fakeFetch, json, mbid, qid, qlooArtist } from "./fixtures";

type Route = [string, (u: URL) => Response];
type Req = Parameters<typeof handleRest>[0];
type Scenario = { name: string; routes: Route[]; calls: Req[] };

/** New keys this release may add (paths as written by diff(); [n] is any array index). */
const ALLOWED = [
  /^notonq\.[0-9a-f-]{36}$/i, // a result's own block, keyed by its entity_id (kinds filled, candidate, picked, matched, gaps)
  /^notonq\.[0-9a-f-]{36}\.kind$/i, // kind on the blocks /entities already keyed by entity_id
  /^notonq\.candidates\[n\]\.entity_id$/, // the ID each candidate has in results
  /^results\.(entities|heatmap|demographics|tags)$/, // Qloo's empty list on a no-taste-data answer (was results: {})
];

const NEW = mbid(99);
const NOT_IN_GRAPH = { errors: [{ message: "All of the provided signal.interests.entities were invalid.", path: "signal.interests.entities" }] };
const openData: Route[] = [
  [`musicbrainz.org/ws/2/artist/${NEW}`, () => json(200, { id: NEW, name: "Newact", country: "US" })],
  ["musicbrainz.org/ws/2/url", () => json(200, { relations: [{ artist: { id: NEW, name: "Newact" } }] })],
  ["musicbrainz.org/ws/2/artist", () => json(200, { artists: [{ id: NEW, name: "Newact", score: 100, country: "US" }] })],
  ["query.wikidata.org", () => json(200, { results: { bindings: [] } })],
  ["method=artist.getinfo", () => json(200, { artist: { stats: { listeners: "1000" } } })],
  ["method=artist.getsimilar", () => json(200, { similarartists: { artist: [1, 2].map((n) => ({ name: `Similar ${n}`, mbid: mbid(n), match: "0.9" })) } })],
];
const qloo: Route[] = [
  ["/search", () => json(404, { message: "No results" })],
  ["/entities?external.spotify.ids", () => json(200, { results: [] })],
  ["/entities", (u) => (u.searchParams.get("entity_ids") === qid(50) ? json(200, { results: [qlooArtist(50, "Newact")] }) : json(200, { results: [qlooArtist(1, "Similar 1", { mb: 1 }), qlooArtist(2, "Similar 2", { mb: 2 })] }))],
  ["/v2/insights", (u) => ((u.searchParams.get("signal.interests.entities") ?? "").includes(qid(50)) ? json(400, NOT_IN_GRAPH) : json(200, { success: true, results: { entities: [qlooArtist(70, "Rec")] } }))],
];
const noStandIns: Route[] = [...qloo, ...openData.filter(([k]) => k !== "method=artist.getsimilar"), ["method=artist.getsimilar", () => json(200, { similarartists: { artist: [] } })]];

const small: Route[] = [
  ["hackathon.api.qloo.com/search", (u) => (u.searchParams.get("query") === "Bigger Act" ? json(200, { results: [qlooArtist(31, "Bigger Act")] }) : json(200, { results: [qlooArtist(40, "Tiny Acts Club")] }))],
  ["musicbrainz.org/ws/2/artist", () => json(200, { artists: [{ id: mbid(7), name: "H.M. Tiny Act", score: 88, country: "GB" }] })],
  ["method=artist.search", () => json(200, { results: { artistmatches: { artist: [{ name: "Tiny Act", listeners: "4", mbid: "", url: "https://www.last.fm/music/Tiny+Act" }] } } })],
  ["method=artist.getinfo", () => json(200, { artist: { url: "https://www.last.fm/music/Tiny+Act", stats: { listeners: "4", playcount: "9" } } })],
  ["method=artist.getsimilar", () => json(200, { similarartists: { artist: [] } })],
  ["api.deezer.com/search/artist", () => json(200, { data: [{ id: 555, name: "Tiny Act", nb_fan: 2, link: "https://www.deezer.com/artist/555" }] })],
  ["api.deezer.com/artist/555/related", () => json(200, { data: [{ id: 1, name: "Bigger Act" }] })],
  ["api.deezer.com/artist/555", () => json(200, { id: 555, name: "Tiny Act", nb_fan: 2, link: "https://www.deezer.com/artist/555" })],
];

const KNOWN = mbid(42);
const typo: Route[] = [
  ["hackathon.api.qloo.com/search", () => json(200, { results: [qlooArtist(40, "Someone Else")] })],
  ["hackathon.api.qloo.com/entities", (u) => (u.searchParams.get("external.musicbrainz.ids")?.includes(KNOWN) ? json(200, { results: [qlooArtist(41, "Famous Act", { mb: 42 })] }) : json(200, { results: [] }))],
  ["hackathon.api.qloo.com/v2/insights", () => json(200, { results: { entities: [] } })],
  ["musicbrainz.org/ws/2/artist", () => json(200, { artists: [{ id: KNOWN, name: "Famous Act", score: 80 }] })],
  ["api.deezer.com/search/artist", () => json(200, { data: [] })],
];

const MB = mbid(40);
const kite = { id: MB, name: "Kitebird", score: 100, country: "JP", "begin-area": { name: "Osaka" } };
const thin: Route[] = [
  ["hackathon.api.qloo.com/search", () => json(200, { results: [qlooArtist(5, "Kitebird")] })],
  ["hackathon.api.qloo.com/entities", () => json(200, { results: [qlooArtist(5, "Kitebird")] })],
  [`musicbrainz.org/ws/2/artist/${MB}`, () => json(200, { ...kite, genres: [{ name: "emo", count: 3 }], relations: [{ type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q123" } }] })],
  ["musicbrainz.org/ws/2/release?artist=", () => json(200, { releases: [{ "text-representation": { language: "jpn" } }] })],
  ["musicbrainz.org/ws/2/artist?query=", () => json(200, { artists: [kite] })],
];

const AREA = "11111111-0000-4000-a000-000000000001";
const COUNTRY = "11111111-0000-4000-a000-000000000002";
const era: Route[] = [
  ["hackathon.api.qloo.com/v2/insights", (u) => json(200, { success: true, results: { entities: u.searchParams.get("signal.interests.tags") ? [qlooArtist(7, "Signal A")] : [] } })],
  ["hackathon.api.qloo.com/entities", () => json(200, { results: [qlooArtist(5, "Known Act", { mb: 2 })] })],
  [`musicbrainz.org/ws/2/area/${AREA}`, () => json(200, { id: AREA, name: "Lagos", type: "City", relations: [{ type: "part of", direction: "backward", area: { id: COUNTRY, name: "Nigeria" } }] })],
  [`musicbrainz.org/ws/2/area/${COUNTRY}`, () => json(200, { id: COUNTRY, name: "Nigeria", type: "Country", "iso-3166-1-codes": ["NG"] })],
  ["musicbrainz.org/ws/2/area?", () => json(200, { areas: [{ id: AREA, name: "Lagos", type: "City" }] })],
  [
    "musicbrainz.org/ws/2/artist?",
    () =>
      json(200, {
        artists: [
          { id: mbid(1), name: "Old Band", type: "Group", area: { name: "Nigeria" }, "life-span": { begin: "1958", end: "1975" } },
          { id: mbid(2), name: "Known Act", type: "Person", area: { name: "Nigeria" }, "life-span": { begin: "1938" } },
        ],
      }),
  ],
  ["method=artist.getinfo", (u) => json(200, { artist: { stats: { listeners: u.searchParams.get("mbid") === mbid(2) ? "900" : "40" } } })],
];

const k = { apiKey: "k", lastfmKey: "lf" };
const artist = "urn:entity:artist";
const SCENARIOS: Scenario[] = [
  {
    name: "fill: search, entities, insights GET and POST, compare, rank",
    routes: [...qloo, ...openData],
    calls: [
      { path: "search", params: { query: "Newact", types: artist }, ...k },
      { path: "search", params: { query: "Newact" }, ...k },
      { path: "entities", params: { entity_ids: NEW }, ...k },
      { path: "v2/insights", params: { "filter.type": artist, "signal.interests.entities": NEW }, ...k },
      { path: "v2/insights", params: {}, body: { "filter.type": artist, "signal.interests.entities": [{ id: NEW, weight: 0.5 }] }, ...k },
      { path: "v2/insights", params: { "filter.type": "urn:demographics", "signal.interests.entities": NEW }, ...k },
      { path: "v2/insights", params: { "filter.results.entities": NEW, "filter.type": artist }, ...k },
      { path: "v2/insights", params: { "filter.type": artist, "signal.interests.entities": qid(50) }, ...k },
    ],
  },
  { name: "Spotify ID lookup", routes: [...qloo, ...openData], calls: [{ path: "entities", params: { "external.spotify.ids": "1234567890abcdefghijkl" }, ...k }] },
  {
    name: "no stand-ins: empty taste answers",
    routes: noStandIns,
    calls: [
      { path: "search", params: { query: "Newact", types: artist }, ...k },
      { path: "v2/insights", params: { "filter.type": artist, "signal.interests.entities": NEW }, ...k },
      { path: "v2/insights", params: { "filter.type": "urn:heatmap", "signal.interests.entities": NEW }, ...k },
    ],
  },
  {
    name: "candidates: offered, chosen, then offered again",
    routes: small,
    calls: [
      { path: "search", params: { query: "Tiny Act", take: "5" }, ...k },
      { path: "search", params: { query: "Tiny Act", types: artist, take: "1" }, ...k },
      { path: "entities", params: { entity_ids: "{{tiny}}" }, ...k },
      { path: "search", params: { query: "Tiny Act", take: "5" }, ...k },
    ],
  },
  {
    name: "a typo for an artist Qloo has",
    routes: typo,
    calls: [{ path: "search", params: { query: "famus act", types: artist, "notonq.candidate": `mb:${KNOWN}` }, ...k }],
  },
  {
    name: "field gaps on a thin Qloo record (G5)",
    routes: thin,
    calls: [
      { path: "search", params: { query: "Kitebird", types: artist }, ...k },
      { path: "entities", params: { entity_ids: qid(5) }, ...k },
    ],
  },
  {
    name: "era, genre and place (G4)",
    routes: era,
    calls: [{ path: "v2/insights", params: { "filter.type": artist, "filter.tags": "urn:tag:genre:music:60s", "signal.location.query": "Lagos", take: "10" }, ...k }],
  },
];

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
/** Times differ between runs; everything else must not. */
const stable = (v: unknown): unknown =>
  typeof v === "string" && ISO.test(v) ? "<time>" : Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, stable(b)])) : v;

async function run(s: Scenario) {
  const sql = await memoryDb();
  const { fetch } = fakeFetch(s.routes);
  const out: unknown[] = [];
  let tiny = "";
  for (const call of s.calls) {
    const params = Object.fromEntries(Object.entries(call.params).map(([a, b]) => [a, b === "{{tiny}}" ? tiny : b]));
    const res = await handleRest({ ...call, params }, { sql, baseUrl: "https://hackathon.api.qloo.com", salt: "t", fetch });
    const results = (res.body as { results?: { name?: string; entity_id?: string }[] } | null)?.results;
    tiny ||= (Array.isArray(results) ? results.find((r) => r.name === "Tiny Act")?.entity_id : "") ?? "";
    // As sent over HTTP: JSON drops undefined values.
    out.push(stable(JSON.parse(JSON.stringify({ status: res.status, servedBy: res.servedBy, body: res.body }))));
  }
  return out;
}

/** Every way `now` differs from `was`, except new keys (returned apart, to be checked against ALLOWED). */
function diff(was: unknown, now: unknown, at = "", out = { changed: [] as string[], added: [] as string[] }) {
  const p = (key: string) => (at ? `${at}.${key}` : key);
  if (Array.isArray(was)) {
    if (!Array.isArray(now) || now.length !== was.length) out.changed.push(`${at}: array ${JSON.stringify(was).slice(0, 80)} → ${JSON.stringify(now).slice(0, 80)}`);
    else was.forEach((w, i) => diff(w, now[i], `${at}[n]`, out));
  } else if (was && typeof was === "object") {
    if (!now || typeof now !== "object" || Array.isArray(now)) out.changed.push(`${at}: object → ${JSON.stringify(now).slice(0, 80)}`);
    else {
      for (const [key, w] of Object.entries(was)) {
        if (key in now) diff(w, (now as Record<string, unknown>)[key], p(key), out);
        else out.changed.push(`${p(key)}: removed`);
      }
      for (const key of Object.keys(now)) if (!(key in was)) out.added.push(p(key));
    }
  } else if (was !== now) out.changed.push(`${at}: ${JSON.stringify(was)} → ${JSON.stringify(now)}`);
  return out;
}

const BASELINE = path.join(import.meta.dirname, "additive.baseline.json");

describe("responses stay additive", () => {
  it("matches the last release's responses, with only the new keys added", { timeout: 120_000 }, async () => {
    const now: Record<string, unknown[]> = {};
    for (const s of SCENARIOS) now[s.name] = await run(s);
    if (process.env.NOTONQ_BASELINE_OUT) return writeFileSync(process.env.NOTONQ_BASELINE_OUT, `${JSON.stringify(now, null, 1)}\n`);
    const was = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, unknown[]>;
    const changed: string[] = [];
    const added = new Set<string>();
    for (const s of SCENARIOS) {
      expect(now[s.name], s.name).toHaveLength(was[s.name].length);
      was[s.name].forEach((w, i) => {
        const d = diff(w, now[s.name][i], "");
        changed.push(...d.changed.map((c) => `${s.name} #${i + 1} ${c}`));
        for (const a of d.added) added.add(a.replace(/^body\./, ""));
      });
    }
    expect(changed).toEqual([]);
    expect([...added].filter((a) => !ALLOWED.some((re) => re.test(a)))).toEqual([]);
    // And the new keys are really there (the test would pass vacuously on the old code otherwise).
    expect([...added].some((a) => /^notonq\.[0-9a-f-]{36}$/i.test(a))).toBe(true);
  });
});
