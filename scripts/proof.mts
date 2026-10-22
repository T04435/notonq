// The proof run: how often Qloo can't use an artist, how much NotOnQ fills, and how close the stand-in proxy gets
// to Qloo's own answer. Writes aggregates only to src/data/proof.json (committed: counts and percentages, no Qloo
// response data) and the per-artist working to .data/proof-run.json (local, gitignored).
//
//   node --import tsx scripts/proof.mts            (needs QLOO_API_KEY and LASTFM_API_KEY in the environment)
//
// Two samples: artists with a release in the last 14 days (ListenBrainz fresh releases, MusicBrainz data, CC0) and
// Last.fm's global chart. Qloo call budget is capped (see CAPS).
import { mkdirSync, writeFileSync } from "node:fs";
import * as lastfm from "@/server/adapters/lastfm";
import { buildFallback } from "@/server/engine/artist";
import { lookupBatch, pickStandIns, type Similar } from "@/server/engine/standins";
import { getJson } from "@/server/http";
import { ARTIST, entitiesOf, qlooClient, type QlooEntity } from "@/server/qloo/client";
import { readInsights, sameName } from "@/server/qloo/gap";
import { externalOf } from "@/server/engine/standins";

const CAPS = { perSample: 100, gapFills: 30, backtest: 15 };
const qlooKey = process.env.QLOO_API_KEY;
const lfKey = process.env.LASTFM_API_KEY;
if (!qlooKey || !lfKey) throw new Error("QLOO_API_KEY and LASTFM_API_KEY are required");
let qlooCalls = 0;
const base = qlooClient({ apiKey: qlooKey });
const qloo = { ...base, get: (p: string, q: Record<string, string | number | undefined>) => (qlooCalls++, base.get(p, q)) };
const q = {
  ...qloo,
  searchArtist: (name: string, take = 5) => qloo.get("/search", { query: name, types: ARTIST, take }),
  entitiesByMbids: (mbids: string[]) => qloo.get("/entities", { "external.musicbrainz.ids": mbids.join(",") }),
  insights: (params: Record<string, string | number | undefined>) => qloo.get("/v2/insights", params),
};

type Artist = { name: string; mbid?: string; sample: "fresh" | "chart" };

// A seeded shuffle so a rerun picks the same sample from the same feed.
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
  const releases = ((res.json as { payload?: { releases?: { artist_credit_name: string; artist_mbids?: string[] }[] } })?.payload?.releases ?? []).filter(
    (r) => r.artist_mbids?.length === 1,
  );
  const unique = [...new Map(releases.map((r) => [r.artist_mbids![0], { name: r.artist_credit_name, mbid: r.artist_mbids![0], sample: "fresh" as const }])).values()];
  return shuffle(unique).slice(0, CAPS.perSample);
}

async function chartSample(): Promise<Artist[]> {
  const res = await getJson(`https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&limit=${CAPS.perSample}&format=json&api_key=${lfKey}`);
  const list = (res.json as { artists?: { artist?: { name: string; mbid?: string }[] } })?.artists?.artist ?? [];
  return list.map((a) => ({ name: a.name, mbid: a.mbid || undefined, sample: "chart" as const }));
}

type Coverage = Artist & { status: "usable" | "G1" | "G2"; qlooId?: string; via?: "mbid" | "name" };

async function coverage(artists: Artist[]): Promise<Coverage[]> {
  const byMbid = new Map<string, QlooEntity>();
  const mbids = artists.flatMap((a) => (a.mbid ? [a.mbid.toLowerCase()] : []));
  for (let i = 0; i < mbids.length; i += 25) {
    for (const e of entitiesOf((await q.entitiesByMbids(mbids.slice(i, i + 25))).json))
      for (const mb of externalOf(e, "musicbrainz")) if (typeof mb.id === "string" && !byMbid.has(mb.id.toLowerCase())) byMbid.set(mb.id.toLowerCase(), e);
  }
  const out: Coverage[] = [];
  for (const a of artists) {
    let hit = a.mbid ? byMbid.get(a.mbid.toLowerCase()) : undefined;
    let via: Coverage["via"] = hit ? "mbid" : undefined;
    if (!hit) {
      hit = entitiesOf((await q.searchArtist(a.name, 5)).json).find((e) => sameName(e.name, a.name));
      via = hit ? "name" : undefined;
    }
    if (!hit) {
      out.push({ ...a, status: "G1" });
      continue;
    }
    let g2 = false;
    try {
      g2 = readInsights(await q.insights({ "filter.type": ARTIST, "signal.interests.entities": hit.entity_id, take: 1 }))?.kind === "G2";
    } catch {
      g2 = false;
    }
    out.push({ ...a, status: g2 ? "G2" : "usable", qlooId: hit.entity_id, via });
  }
  return out;
}

async function fill(gaps: Coverage[]) {
  const rows = [];
  for (const g of gaps.slice(0, CAPS.gapFills)) {
    const anchor = g.mbid ? { key: `mb:${g.mbid}`, name: g.name, exact: true, mbid: g.mbid, links: [] } : undefined;
    const r = await buildFallback(g.name, { qloo: q, lastfmKey: lfKey }, anchor);
    const e = r.entity;
    rows.push({
      name: g.name,
      sample: g.sample,
      status: g.status,
      entity: !!e,
      fields: Object.keys(r.provenance).filter((p) => !p.startsWith("standIns.")).length,
      description: !!e?.properties.short_description,
      genres: (e?.tags.length ?? 0) > 0,
      image: !!e?.properties.image,
      popularity: e?.popularity !== undefined,
      standIns: r.standIns.length,
    });
  }
  return rows;
}

async function backtest(usable: Coverage[]) {
  const rows = [];
  for (const a of usable.filter((u) => u.mbid).slice(0, CAPS.backtest)) {
    const similar = (await lastfm.similarArtists(a.name, lfKey!)).filter((s) => s.mbid && !sameName(s.name, a.name));
    const cands: Similar[] = similar.map((s) => ({ name: s.name, mbid: s.mbid!, match: s.match, source: "lastfm" }));
    const batch = lookupBatch(cands);
    const standIns = pickStandIns(cands, batch.length ? entitiesOf((await q.entitiesByMbids(batch)).json) : []).filter((s) => s.entityId !== a.qlooId);
    if (standIns.length < 2) continue;
    const ask = async (signal: string) => entitiesOf((await q.insights({ "filter.type": ARTIST, "signal.interests.entities": signal, take: 30 })).json).map((e) => e.entity_id);
    const exclude = new Set([a.qlooId!, ...standIns.map((s) => s.entityId)]);
    const real = (await ask(a.qlooId!)).filter((id) => !exclude.has(id)).slice(0, 20);
    const proxy = (await ask(standIns.map((s) => s.entityId).join(","))).filter((id) => !exclude.has(id)).slice(0, 20);
    const at = (k: number) => real.slice(0, k).filter((id) => proxy.slice(0, k).includes(id)).length / Math.max(1, Math.min(k, real.length));
    rows.push({ name: a.name, standIns: standIns.length, overlapAt10: at(10), overlapAt20: at(20) });
  }
  return rows;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : 0);

const started = new Date();
const artists = [...(await freshSample()), ...(await chartSample())];
console.error(`sample: ${artists.length} artists`);
const cov = await coverage(artists);
console.error(`coverage done (${qlooCalls} Qloo calls)`);
const gaps = cov.filter((c) => c.status !== "usable").sort((a, b) => Number(a.sample === "chart") - Number(b.sample === "chart"));
const fills = await fill(gaps);
console.error(`fills done (${qlooCalls} Qloo calls)`);
const bt = await backtest(cov.filter((c) => c.status === "usable" && c.sample === "chart"));
console.error(`backtest done (${qlooCalls} Qloo calls)`);

const bySample = (s: Artist["sample"]) => {
  const c = cov.filter((x) => x.sample === s);
  return { artists: c.length, usableInQloo: c.filter((x) => x.status === "usable").length, unknownG1: c.filter((x) => x.status === "G1").length, notInTasteGraphG2: c.filter((x) => x.status === "G2").length, gapRatePct: pct(c.filter((x) => x.status !== "usable").length, c.length) };
};
const proof = {
  ranAt: started.toISOString(),
  method: {
    samples: {
      fresh: "Artists with a release in the last 14 days (ListenBrainz fresh releases, single-artist credits), seeded random sample",
      chart: "Last.fm global top artists chart",
    },
    gap: "G1: Qloo has no entity (MusicBrainz ID or exact name). G2: Qloo finds the entity but /v2/insights rejects it as a signal.",
    fill: `NotOnQ tiers 1–2 (open data + stand-ins), first ${CAPS.gapFills} gap artists, no research agent`,
    backtest: `Artists Qloo does know: Qloo's own top-20 'fans also like' vs the answer from up to 5 stand-ins (the artist itself hidden), first ${CAPS.backtest} with enough stand-ins`,
    qlooCalls,
  },
  coverage: { fresh: bySample("fresh"), chart: bySample("chart") },
  fill: {
    artists: fills.length,
    entityPct: pct(fills.filter((f) => f.entity).length, fills.length),
    standInsPct: pct(fills.filter((f) => f.standIns > 0).length, fills.length),
    descriptionPct: pct(fills.filter((f) => f.description).length, fills.length),
    genresPct: pct(fills.filter((f) => f.genres).length, fills.length),
    imagePct: pct(fills.filter((f) => f.image).length, fills.length),
    popularityPct: pct(fills.filter((f) => f.popularity).length, fills.length),
    meanSourcedFields: mean(fills.map((f) => f.fields)),
  },
  backtest: { artists: bt.length, meanOverlapAt10: mean(bt.map((b) => b.overlapAt10)), meanOverlapAt20: mean(bt.map((b) => b.overlapAt20)) },
};

mkdirSync("src/data", { recursive: true });
writeFileSync("src/data/proof.json", `${JSON.stringify(proof, null, 2)}\n`);
mkdirSync(".data", { recursive: true });
writeFileSync(".data/proof-run.json", JSON.stringify({ coverage: cov, fills, backtest: bt }, null, 2));
console.log(JSON.stringify(proof, null, 2));
