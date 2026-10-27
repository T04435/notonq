import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toLedgerSearch } from "@/lib/ledger-params";
import { db } from "@/server/store/db";
import { proofStats, type TasteQuestion } from "@/server/store/proof-stats";

export const metadata = { title: "Proof · NotOnQ" };

const pct = (n: number, d: number) => `${d ? Math.round((n / d) * 1000) / 10 : 0}%`;
const ledger = (app?: string) => `/ledger${toLedgerSearch({ view: "all", app: app ? [app] : [] })}`;
const TASTE: [TasteQuestion, string][] = [
  ["similar", "Similar artists"],
  ["map", "Where they're popular"],
  ["ages", "What ages listen"],
];

export default function ProofPage({ searchParams }: PageProps<"/proof">) {
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Proof</h1>
        <p className="text-muted-foreground">
          Artists only. Every number here is counted from runs in the{" "}
          <Link href="/ledger" className="underline underline-offset-4">
            Ledger
          </Link>
          , from every app that calls NotOnQ: Ask, apps on the drop-in API and the Qloo harness, and the benchmark batch (the app &quot;benchmark&quot;:
          real questions run by <code>scripts/benchmark.mts</code>). Filter by app to see one app&apos;s numbers.
        </p>
      </header>
      <Suspense fallback={<Spinner />}>
        <Numbers searchParams={searchParams} />
      </Suspense>
      <AutoRefresh />
    </section>
  );
}

async function Numbers({ searchParams }: { searchParams: PageProps<"/proof">["searchParams"] }) {
  await connection();
  const raw = (await searchParams).app;
  const app = typeof raw === "string" && raw.length <= 64 ? raw : undefined;
  const s = await proofStats(await db(), app);
  const f = s.filled;
  const gaps = s.artists.G1 + s.artists.G2;
  const filledIn = gaps - s.artists.ambiguous;
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Filter by app" className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">App:</span>
        {[undefined, ...s.apps.map((a) => a.app)].map((a) => (
          <Link
            key={a ?? "all"}
            href={a ? `/proof?app=${encodeURIComponent(a)}` : "/proof"}
            aria-current={a === app ? "page" : undefined}
            className={`rounded-md border px-2 py-0.5 font-mono text-xs ${a === app ? "bg-accent" : "hover:bg-accent"}`}
          >
            {a ?? "all"}
          </Link>
        ))}
      </nav>

      {!s.artists.total && !s.asks.total ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No artist searches yet{app ? ` from ${app}` : ""}</EmptyTitle>
            <EmptyDescription>Ask a question, call the drop-in API, or run the benchmark batch, and the numbers start here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <h2 className="font-medium">
            {app ?? "All apps"}
            {s.since ? ` · since ${new Date(s.since).toUTCString()}` : ""} ·{" "}
            <Link href={ledger(app)} className="underline underline-offset-4">
              {s.runs} runs in the Ledger
            </Link>
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription>Artists we filled in</CardDescription>
                <CardTitle className="text-3xl">{filledIn}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                of {s.artists.total} artists searched. Qloo could use {s.artists.usable} as they are; {gaps} ({pct(gaps, s.artists.total)}) it couldn&apos;t:{" "}
                {s.artists.G1} new to Qloo, {s.artists.G2} not yet a taste signal
                {s.artists.ambiguous ? `. ${s.artists.ambiguous} of those have more than one artist by that name and wait for a caller to choose` : ""}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Taste answers through similar artists Qloo knows</CardDescription>
                <CardTitle className="text-3xl">{s.standInCalls}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                insights calls (recommendations, maps, audiences) Qloo answered for similar artists it knows, in place of an artist it has no taste data for;{" "}
                {f.similar} of {f.artists} filled-in artists have them
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Ask questions</CardDescription>
                <CardTitle className="text-3xl">{s.asks.total}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {s.asks.qloo} answered by Qloo alone, {s.asks.notonq} filled in by NotOnQ; {s.cache.hits} of {s.cache.of} filled-in responses came from cache
              </CardContent>
            </Card>
          </div>

          {f.artists > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>The {f.artists} records we filled in</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  [
                    ["Where they're from", f.home],
                    ["Similar artists Qloo knows", f.similar],
                    ["Image", f.image],
                    ["Popularity", f.popularity],
                    ["Genres", f.genres],
                    ["Wikipedia description", f.description],
                    ["Low confidence (no MusicBrainz record)", f.lowConfidence],
                  ] as const
                ).map(([label, v]) => (
                  <TableRow key={label}>
                    <TableCell>{label}</TableCell>
                    <TableCell className="text-right">
                      {pct(v, f.artists)} <span className="text-muted-foreground">({v})</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {s.asks.total > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Taste questions in Ask, where NotOnQ&apos;s step ran</TableHead>
                  <TableHead className="text-right">Got data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TASTE.map(([k, label]) => (
                  <TableRow key={k}>
                    <TableCell>{label}</TableCell>
                    <TableCell className="text-right">
                      {s.asks.taste[k].answered} of {s.asks.taste[k].asked}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {s.mostAsked.length > 0 && (
            <p className="text-sm">
              <span className="text-muted-foreground">Most searched, filled in: </span>
              {s.mostAsked.map((m, i) => (
                <span key={m.nameKey}>
                  {i ? ", " : ""}
                  <Link href={`/ledger/${encodeURIComponent(m.nameKey)}`} className="underline-offset-4 hover:underline">
                    {m.name}
                  </Link>{" "}
                  <span className="text-muted-foreground">×{m.searches}</span>
                </span>
              ))}
            </p>
          )}
        </>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>App</TableHead>
            <TableHead className="text-right">Runs</TableHead>
            <TableHead className="text-right">Share of runs</TableHead>
            <TableHead className="text-right">Artists searched</TableHead>
            <TableHead className="text-right">Filled in</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {s.apps.map((a) => (
            <TableRow key={a.app}>
              <TableCell className="font-mono text-xs">
                <Link href={ledger(a.app)} className="underline-offset-4 hover:underline">
                  {a.app}
                </Link>
              </TableCell>
              <TableCell className="text-right">{a.runs}</TableCell>
              <TableCell className="text-right">{a.sharePct}%</TableCell>
              <TableCell className="text-right">{a.artists}</TableCell>
              <TableCell className="text-right">{a.artists ? `${a.gapPct}%` : "none searched"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Each artist counts once, by its latest artist search through /q. Apps are the label callers give (/q/app/&lt;label&gt; or X-NotOnQ-App;
        unlabelled otherwise). Ask questions are the app &quot;ask&quot;; the calls behind them are &quot;playground-ask&quot;.
      </p>
    </div>
  );
}
