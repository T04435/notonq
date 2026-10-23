import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import benchmark from "@/data/proof.json";
import { db } from "@/server/store/db";
import { liveStats } from "@/server/store/stats";

export const metadata = { title: "Proof · NotOnQ" };

const pct = (v: number) => `${v}%`;

export default function ProofPage() {
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Proof</h1>
        <p className="text-muted-foreground">
          Live: every artist lookup NotOnQ has handled, through the playground, the drop-in API or MCP, updating as it happens. Below it, a fixed
          benchmark run that measures what live traffic can&apos;t.
        </p>
      </header>
      <Suspense fallback={<Spinner />}>
        <Live />
      </Suspense>
      <AutoRefresh />
      <Benchmark />
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
          <EmptyDescription>Look up an artist in the playground or call the drop-in API, and the live numbers start here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  const f = s.filled;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-medium">Live{s.since ? ` · since ${new Date(s.since).toUTCString()}` : ""}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Artists Qloo couldn&apos;t use</CardDescription>
            <CardTitle className="text-3xl">{pct(s.gapRatePct)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {s.gaps} of {s.artists} artists looked up ({s.unknownG1} unknown, {s.notInTasteGraphG2} not in the taste graph), {s.lookups} lookups in all
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Gaps NotOnQ filled</CardDescription>
            <CardTitle className="text-3xl">{pct(f.entityPct)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {f.artists} filled with a sourced entity; {s.awaitingChoice} waiting for someone to choose which artist; {pct(f.standInsPct)} of fills have stand-ins
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Served from cache</CardDescription>
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
            ["Fills with stand-ins Qloo can answer for", pct(f.standInsPct)],
            ["Fills with derived popularity", pct(f.popularityPct)],
            ["Fills with genres", pct(f.genresPct)],
            ["Fills with a description", pct(f.descriptionPct)],
            ["Fills with an image", pct(f.imagePct)],
            ["Low confidence (no MusicBrainz record)", pct(f.lowConfidencePct)],
            ["Cited fields per fill, on average", String(f.meanCitedFields)],
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
              <TableHead className="text-right">Qloo couldn&apos;t use</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.apps.map((a) => (
              <TableRow key={a.app}>
                <TableCell className="font-mono text-xs">{a.app}</TableCell>
                <TableCell className="text-right">{a.lookups}</TableCell>
                <TableCell className="text-right">{a.artists}</TableCell>
                <TableCell className="text-right">{pct(a.gapRatePct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        Each artist counts once, by the outcome of its latest lookup. Apps are the X-NotOnQ-App label callers send (unlabelled otherwise).
      </p>
    </div>
  );
}

function Benchmark() {
  const { coverage, fill, backtest, method } = benchmark;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-medium">Benchmark run · {new Date(benchmark.ranAt).toUTCString()}</h2>
      <p className="text-sm text-muted-foreground">
        A fixed sample, so the numbers mean the same thing for everyone. It compares new artists with chart artists, and tests the stand-ins against
        Qloo&apos;s own answers, which live traffic can&apos;t. It used {method.qlooCalls} Qloo calls; rerun with{" "}
        <code>node --import tsx scripts/proof.mts</code>.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Sample</TableHead>
            <TableHead className="text-right">Artists</TableHead>
            <TableHead className="text-right">Usable in Qloo</TableHead>
            <TableHead className="text-right">Unknown (G1)</TableHead>
            <TableHead className="text-right">Not in taste graph (G2)</TableHead>
            <TableHead className="text-right">Gap</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(["fresh", "chart"] as const).map((k) => (
            <TableRow key={k}>
              <TableCell className="whitespace-normal">{method.samples[k]}</TableCell>
              <TableCell className="text-right">{coverage[k].artists}</TableCell>
              <TableCell className="text-right">{coverage[k].usableInQloo}</TableCell>
              <TableCell className="text-right">{coverage[k].unknownG1}</TableCell>
              <TableCell className="text-right">{coverage[k].notInTasteGraphG2}</TableCell>
              <TableCell className="text-right">{pct(coverage[k].gapRatePct)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        <li>
          Fill ({fill.artists} gap artists, open data and stand-ins only): sourced entity {pct(fill.entityPct)}, stand-ins {pct(fill.standInsPct)},
          popularity {pct(fill.popularityPct)}, genres {pct(fill.genresPct)}, description {pct(fill.descriptionPct)}, image {pct(fill.imagePct)}.
        </li>
        <li>
          Backtest ({backtest.artists} artists Qloo knows, each hidden): stand-ins alone recover {pct(Math.round(backtest.meanOverlapAt20 * 1000) / 10)} of
          Qloo&apos;s own top 20 &quot;fans also like&quot; ({pct(Math.round(backtest.meanOverlapAt10 * 1000) / 10)} of the top 10).
        </li>
        <li>{method.gap}</li>
      </ul>
    </div>
  );
}
