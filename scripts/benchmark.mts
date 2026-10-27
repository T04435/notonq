// The benchmark batch: real Ask questions and /q calls sent to a running NotOnQ, so every number on /proof comes from
// runs in the Ledger. Nothing is written here; the server records each run like any other, under the app "benchmark".
//
//   node --import tsx scripts/benchmark.mts [base]      (base defaults to http://localhost:3400)
//
// Needs QLOO_API_KEY, LASTFM_API_KEY (the chart sample) and NOTONQ_BENCHMARK_TOKEN (the server's) in the environment.
// Run it against the deployment whose Proof it should feed: the dev branch to test, production for the real Proof.
//
// 1. Samples: artists with a release in the last 14 days (ListenBrainz fresh releases, single-artist credits, seeded
//    shuffle) and Last.fm's global chart. 2. Coverage: per artist, /search through NotOnQ (and, when Qloo finds the
//    artist, an /v2/insights signal check for G2), one visit per artist (X-NotOnQ-Trace), then the Ask question
//    "Recommend artists similar to …". 3. Fill: five Ask questions about each of the first artists we filled in.
import { BENCHMARK_APP, COVERAGE_QUESTION, FILL_QUESTIONS } from "@/lib/benchmark";
import { getJson } from "@/server/http";
import { ARTIST, entitiesOf } from "@/server/qloo/client";
import { sameName } from "@/server/qloo/gap";

const CAPS = { perSample: 20, fill: 10, parallelAsks: 3 };
const base = (process.argv[2] ?? "http://localhost:3400").replace(/\/$/, "");
const { QLOO_API_KEY: qlooKey, LASTFM_API_KEY: lfKey, NOTONQ_BENCHMARK_TOKEN: token } = process.env;
if (!qlooKey || !lfKey || !token) throw new Error("QLOO_API_KEY, LASTFM_API_KEY and NOTONQ_BENCHMARK_TOKEN are required");

// One batch id per run: Proof shows the latest batch, and its traces name every artist it covered.
const batch = `b${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
type Sample = "fresh" | "chart";
type Artist = { name: string; sample: Sample };
type Covered = Artist & { status: "usable" | "G1" | "G2" | "error"; ambiguous?: boolean };

function shuffle<T>(xs: T[], seed = 42): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function freshSample(): Promise<Artist[]> {
  const res = await getJson("https://api.listenbrainz.org/1/explore/fresh-releases/?days=14&sort=release_date&past=true&future=false");
  const releases = ((res.json as { payload?: { releases?: { artist_credit_name: string; artist_mbids?: string[] }[] } })?.payload?.releases ?? []).filter((r) => r.artist_mbids?.length === 1);
  const unique = [...new Map(releases.map((r) => [r.artist_mbids![0], r.artist_credit_name])).values()];
  return shuffle(unique).slice(0, CAPS.perSample).map((name) => ({ name, sample: "fresh" as const }));
}

async function chartSample(): Promise<Artist[]> {
  const res = await getJson(`https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&limit=${CAPS.perSample}&format=json&api_key=${lfKey}`);
  return ((res.json as { artists?: { artist?: { name: string }[] } })?.artists?.artist ?? []).map((a) => ({ name: a.name, sample: "chart" as const }));
}

const q = async (trace: string, path: string, params: Record<string, string | number>) => {
  const res = await fetch(`${base}/q/app/${BENCHMARK_APP}${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`, {
    headers: { "X-Api-Key": qlooKey, "X-NotOnQ-Trace": trace },
    signal: AbortSignal.timeout(120_000),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

/** One coverage visit: is the artist usable in Qloo, new to Qloo (G1), or found but not yet a taste signal (G2)? */
async function cover(a: Artist): Promise<Covered> {
  // Header values must be ASCII, so the name is URL-encoded (Proof decodes it).
  const trace = `${batch}:${a.sample}:${encodeURIComponent(a.name)}`;
  try {
    const s = await q(trace, "/search", { query: a.name, types: ARTIST, take: 5 });
    const nq = s.body?.notonq as { served_by?: string; gap?: { kind?: string } } | undefined;
    // More than one artist by that name: new to Qloo, waiting for a caller to choose (not filled in, so no fill questions).
    if (nq?.served_by === "needs_choice") return { ...a, status: "G1", ambiguous: true };
    if (nq?.gap?.kind === "G1" || nq?.gap?.kind === "G2") return { ...a, status: nq.gap.kind };
    const hit = entitiesOf(s.body).find((e) => sameName(e.name, a.name));
    if (!hit) return { ...a, status: s.status === 200 ? "G1" : "error" };
    const i = await q(trace, "/v2/insights", { "filter.type": ARTIST, "signal.interests.entities": hit.entity_id, take: 1 });
    return { ...a, status: (i.body?.notonq as { gap?: { kind?: string } } | undefined)?.gap?.kind === "G2" ? "G2" : "usable" };
  } catch {
    return { ...a, status: "error" };
  }
}

/** One Ask question, read to the end of its stream (the server saves the run when it finishes). */
async function ask(question: string): Promise<string> {
  const res = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-NotOnQ-Benchmark": token! },
    body: JSON.stringify({ question, app: BENCHMARK_APP }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) return `HTTP ${res.status}`;
  const text = await res.text();
  return text.includes(`"type":"error"`) ? "error" : "ok";
}

async function inBatches<T>(items: T[], n: number, run: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(run));
}

const started = Date.now();
const artists = [...(await freshSample()), ...(await chartSample())];
console.log(`${batch}: ${artists.length} artists`);

const covered: Covered[] = [];
for (const a of artists) {
  covered.push(await cover(a));
  console.log(`cover ${a.sample} ${a.name}: ${covered.at(-1)!.status}`);
}
await inBatches(artists, CAPS.parallelAsks, async (a) => console.log(`ask ${a.name}: ${await ask(COVERAGE_QUESTION(a.name))}`));

const filled = covered.filter((c) => (c.status === "G1" || c.status === "G2") && !c.ambiguous).sort((x, y) => Number(x.sample === "chart") - Number(y.sample === "chart")).slice(0, CAPS.fill);
const fillAsks = filled.flatMap((a) => Object.values(FILL_QUESTIONS).map((f) => f(a.name)));
await inBatches(fillAsks, CAPS.parallelAsks, async (question) => console.log(`ask ${question}: ${await ask(question)}`));

const count = (s: Covered["status"]) => covered.filter((c) => c.status === s).length;
console.log(`${batch} done in ${Math.round((Date.now() - started) / 60000)} min: usable ${count("usable")}, G1 ${count("G1")}, G2 ${count("G2")} (${covered.filter((c) => c.ambiguous).length} with more than one artist by that name), error ${count("error")}; ${fillAsks.length} fill questions`);
