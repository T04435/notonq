import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/server/store/db";
import Link from "next/link";
import { toLedgerSearch } from "@/lib/ledger-params";
import { FILL_QUESTIONS, type FillQuestion } from "@/lib/benchmark";
import { benchmarkStats, type FilledArtist } from "@/server/store/benchmark-stats";
import { liveStats } from "@/server/store/stats";

export const metadata = { title: "Proof · NotOnQ" };

const pct = (v: number) => `${v}%`;

export default function ProofPage() {
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Proof</h1>
        <p className="text-muted-foreground">
          Artists only. Every number here is counted from runs in the <Link href="/ledger" className="underline underline-offset-4">Ledger</Link>: real traffic
          through Ask, the drop-in API and the Qloo harness, and a benchmark batch of real Ask questions run through the app. Each section links to its runs.
        </p>
      </header>
      <Suspense fallback={<Spinner />}>
        <Live />
      </Suspense>
      <AutoRefresh />
      <Suspense fallback={<Spinner />}>
        <Benchmark />
      </Suspense>
    </section>
  );
}

async function Live() {
  await connection();
  const s = await liveStats(await db());
  if (!s.artists)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No lookups yet</EmptyTitle>
          <EmptyDescription>Ask a question on the home page or call the drop-in API, and the live numbers start here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  const f = s.filled;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-medium">Live traffic{s.since ? ` · since ${new Date(s.since).toUTCString()}` : ""}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Artists NotOnQ answered</CardDescription>
            <CardTitle className="text-3xl">{f.artists}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            of {s.artists} artists looked up ({pct(s.gapRatePct)} needed NotOnQ: {s.unknownG1} unknown to Qloo, {s.notInTasteGraphG2} not in its taste graph);{" "}
            {s.lookups} lookups in all
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Taste answers through stand-ins</CardDescription>
            <CardTitle className="text-3xl">{pct(f.standInsPct)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            of NotOnQ&apos;s answers can still get Qloo&apos;s recommendations, heatmaps and demographics, via similar artists Qloo knows;{" "}
            {s.standInSwaps} such calls so far; {s.awaitingChoice} waiting for someone to choose which artist
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Instant from cache</CardDescription>
            <CardTitle className="text-3xl">{pct(s.cacheHitPct)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            of fallback answers needed no new lookups; {s.standInSwaps} insights calls answered by Qloo through stand-ins
          </CardContent>
        </Card>
      </div>

      <Table>
        <TableBody>
          {[
            ["NotOnQ answers with a sourced entity", pct(f.entityPct)],
            ["NotOnQ answers with stand-ins Qloo can answer for", pct(f.standInsPct)],
            ["…with derived popularity", pct(f.popularityPct)],
            ["…with genres", pct(f.genresPct)],
            ["…with a description", pct(f.descriptionPct)],
            ["…with an image", pct(f.imagePct)],
            ["Low confidence (no MusicBrainz record)", pct(f.lowConfidencePct)],
            ["Cited fields per answer, on average", String(f.meanCitedFields)],
            ["Research runs · verified claims · rejected claims", `${s.research.runs} · ${s.research.verifiedClaims} · ${s.research.rejectedClaims}`],
          ].map(([label, v]) => (
            <TableRow key={label}>
              <TableCell>{label}</TableCell>
              <TableCell className="text-right">{v}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {s.apps.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>App</TableHead>
              <TableHead className="text-right">Lookups</TableHead>
              <TableHead className="text-right">Artists</TableHead>
              <TableHead className="text-right">Needed NotOnQ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.apps.map((a) => (
              <TableRow key={a.app}>
                <TableCell className="font-mono text-xs">
                  <Link href={`/ledger${toLedgerSearch({ view: "all", app: [a.app] })}`} className="underline-offset-4 hover:underline">
                    {a.app}
                  </Link>
                </TableCell>
                <TableCell className="text-right">{a.lookups}</TableCell>
                <TableCell className="text-right">{a.artists}</TableCell>
                <TableCell className="text-right">{pct(a.gapRatePct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        Each artist counts once, by the outcome of its latest lookup. Apps are the label callers give (/q/app/&lt;label&gt; or X-NotOnQ-App; unlabelled otherwise).
        The benchmark batch (apps benchmark-*) is counted below, not here.
      </p>
    </div>
  );
}

const SAMPLES = {
  fresh: "Artists with a release in the last 14 days (ListenBrainz fresh releases), seeded random sample",
  chart: "Last.fm global top artists chart",
} as const;
const RECORD: [keyof FilledArtist["record"], string][] = [
  ["home", "Home"],
  ["genres", "Genres"],
  ["similar", "Similar artists Qloo knows"],
  ["description", "Wikipedia description"],
  ["image", "Image"],
  ["popularity", "Popularity"],
];
const ledger = (p: Parameters<typeof toLedgerSearch>[0]) => `/ledger${toLedgerSearch({ view: "all", ...p })}`;

async function Benchmark() {
  await connection();
  const b = await benchmarkStats(await db());
  if (!b)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No benchmark batch yet</EmptyTitle>
          <EmptyDescription>
            Run <code>node --import tsx scripts/benchmark.mts</code> against this deployment: it asks real questions through the app, and its runs land in the Ledger.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  const questions = Object.keys(FILL_QUESTIONS) as FillQuestion[];
  const share = (k: FillQuestion) => {
    const asked = b.filled.filter((f) => f.asks[k]);
    return `${pct(asked.length ? Math.round((asked.filter((f) => f.asks[k]!.answered).length / asked.length) * 1000) / 10 : 0)} of ${asked.length}`;
  };
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-medium">
        Benchmark batch {b.batch} · {new Date(b.ranAt).toUTCString()}
      </h2>
      <p className="text-sm text-muted-foreground">
        Real questions run through the app, so they are in the Ledger like any other run, labelled benchmark-fresh, benchmark-chart and benchmark-fill. It
        compares new artists with chart artists, then asks five questions about each artist we filled in. Rerun with{" "}
        <code>node --import tsx scripts/benchmark.mts</code>.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Sample</TableHead>
            <TableHead className="text-right">Artists</TableHead>
            <TableHead className="text-right">Usable in Qloo</TableHead>
            <TableHead className="text-right">New to Qloo (G1)</TableHead>
            <TableHead className="text-right">Not yet a taste signal (G2)</TableHead>
            <TableHead className="text-right">Of those, more than one artist by that name</TableHead>
            <TableHead className="text-right">Not usable in Qloo</TableHead>
            <TableHead>Runs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(["fresh", "chart"] as const).map((k) => (
            <TableRow key={k}>
              <TableCell className="whitespace-normal">{SAMPLES[k]}</TableCell>
              <TableCell className="text-right">{b.coverage[k].artists}</TableCell>
              <TableCell className="text-right">{b.coverage[k].usable}</TableCell>
              <TableCell className="text-right">{b.coverage[k].G1}</TableCell>
              <TableCell className="text-right">{b.coverage[k].G2}</TableCell>
              <TableCell className="text-right">{b.coverage[k].ambiguous}</TableCell>
              <TableCell className="text-right">{pct(b.coverage[k].gapPct)}</TableCell>
              <TableCell>
                <Link href={ledger({ app: [`benchmark-${k}`] })} className="underline underline-offset-4">
                  benchmark-{k}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-sm text-muted-foreground">
        Each artist is one visit in the Ledger: a /search through NotOnQ, a taste-signal check when Qloo finds the artist, and the Ask question &quot;Recommend
        artists similar to …&quot;. Of those {b.coverageAsks.runs} questions, Qloo answered {b.coverageAsks.qloo} alone and NotOnQ filled in {b.coverageAsks.notonq}.
      </p>

      {b.filled.length > 0 && (
        <>
          <h3 className="text-sm font-medium">What we filled in, for {b.filled.length} artists new to Qloo</h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artist</TableHead>
                  {RECORD.map(([k, label]) => (
                    <TableHead key={k}>{label}</TableHead>
                  ))}
                  {questions.map((k) => (
                    <TableHead key={k} className="whitespace-normal">
                      {FILL_QUESTIONS[k]("…")}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.filled.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell>
                      <Link href={ledger({ app: ["benchmark-fresh", "benchmark-chart"], open: f.visitId })} className="underline-offset-4 hover:underline">
                        {f.name}
                      </Link>
                    </TableCell>
                    {RECORD.map(([k]) => (
                      <TableCell key={k}>{f.record[k] ? "yes" : "no"}</TableCell>
                    ))}
                    {questions.map((k) => (
                      <TableCell key={k}>
                        {f.asks[k] ? (
                          <Link href={`/ledger/run/${f.asks[k]!.runId}`} className="underline underline-offset-4">
                            {f.asks[k]!.answered ? "answered" : "no data"}
                          </Link>
                        ) : (
                          "not asked"
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-medium">All</TableCell>
                  {RECORD.map(([k]) => (
                    <TableCell key={k}>{pct(Math.round((b.filled.filter((f) => f.record[k]).length / b.filled.length) * 1000) / 10)}</TableCell>
                  ))}
                  {questions.map((k) => (
                    <TableCell key={k}>{share(k)}</TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            The record columns are what the filled-in record holds, each with a source in its provenance. The question columns link to the Ask run; &quot;answered&quot;
            means its NotOnQ step got data back from the tool that answers it (for the map and ages, Qloo&apos;s answer for similar artists it knows).
          </p>
        </>
      )}
    </div>
  );
}
