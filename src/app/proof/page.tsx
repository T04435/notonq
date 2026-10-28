import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Mark } from "@/components/brand/mark";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { PageSpinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FillQuestion } from "@/lib/benchmark";
import { db } from "@/server/store/db";
import { ARTIST_ROWS, type ProofArtist, proofStats, type ProofStats } from "@/server/store/proof-stats";

export const metadata = { title: "Proof · NotOnQ" };

const share = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const num = (n: number) => n.toLocaleString("en");
/** "25 Oct 06:41", in UTC. */
const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleString("en", { month: "short", timeZone: "UTC" })} ${iso.slice(11, 16)} UTC`;
};
const proofHref = (app?: string) => (app ? `/proof?app=${encodeURIComponent(app)}` : "/proof");
const ASK: [FillQuestion, string][] = [
  ["who", "who / from"],
  ["genre", "genre"],
  ["similar", "similar"],
  ["map", "where popular"],
  ["ages", "what ages"],
];

// Proof: what the build has, counted from Ledger runs only. One layer over every app, filterable by app; live means
// since the first lookup (no time window).
export default function ProofPage({ searchParams }: PageProps<"/proof">) {
  return (
    <section className="flex flex-col gap-12">
      <h1 className="sr-only">Proof</h1>
      <Suspense fallback={<PageSpinner />}>
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
  return (
    <>
      <Live s={s} app={app} />
      {s.artistRows.length ? <Artists s={s} /> : null}
      <Terms />
    </>
  );
}

function Bar({ value, max, label, fill = true }: { value: number; max: number; label: string; fill?: boolean }) {
  return (
    <span className="grid grid-cols-[minmax(64px,1fr)_56px] items-center gap-3">
      <i aria-hidden="true" className="block h-1.5 bg-muted">
        <b className="block h-full bg-fill" style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} />
      </i>
      <span className={`text-right tabular-nums ${fill ? "text-fill" : ""}`}>{label}</span>
    </span>
  );
}

function AppFilter({ s, app }: { s: ProofStats; app?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 font-normal">
          <span className="text-muted-foreground">app</span>
          <b className="font-medium">{app ?? "any"}</b>
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Scope Proof to one app</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={app ?? ""}>
          {[undefined, ...s.apps.map((a) => a.app)].map((a) => (
            <DropdownMenuRadioItem key={a ?? "any"} value={a ?? ""} asChild>
              <Link href={proofHref(a)}>{a ?? "any app"}</Link>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Live({ s, app }: { s: ProofStats; app?: string }) {
  const f = s.filled;
  return (
    <section aria-labelledby="live" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 id="live" className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[13px] font-medium">
          <Mark size={16} running />
          live
          <small className="text-xs font-normal text-muted-foreground">
            {s.since ? `every artist lookup since ${day(s.since)}` : "every artist lookup"}
            {app ? `, from ${app}` : ", through Ask, the drop-in API and the Qloo harness"}
          </small>
        </h2>
        <AppFilter s={s} app={app} />
      </div>

      {!s.artists.total && !s.asks.total ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No artist lookups yet{app ? ` from ${app}` : ""}</EmptyTitle>
            <EmptyDescription>Ask a question, call the drop-in API, or run the benchmark batch, and the numbers start here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 border md:grid-cols-4">
            <Stat value={num(s.artists.total)} label={`artists looked up · ${num(s.lookups)} lookups`} />
            <Stat
              value={num(f.artists)}
              fill
              label={`filled in by NotOnQ (${share(f.artists, s.artists.total)}%) · ${num(f.G1)} new to Qloo, ${num(f.G2)} not yet a taste signal`}
            />
            <Stat value={`${share(f.similar, f.artists)}%`} label={`of those also get Qloo taste answers through stand-ins · ${num(s.standInCalls)} stand-in calls`} />
            <Stat value={`${share(s.cache.hits, s.cache.of)}%`} label={`instant from cache · ${num(s.artists.ambiguous)} waiting for someone to choose the artist`} />
          </div>
          <p className="text-xs text-muted-foreground">
            {num(s.asks.total)} Ask questions: {num(s.asks.notonq)} filled in by NotOnQ, {num(s.asks.qloo)} answered by Qloo alone ·{" "}
            <Link href={`/ledger?view=all${app ? `&app=${encodeURIComponent(app)}` : ""}`} className="underline underline-offset-4">
              {num(s.runs)} runs in the Ledger
            </Link>
          </p>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            {f.artists ? (
              <div className="border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>what we filled in, per artist</TableHead>
                      <TableHead className="text-right">share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(
                      [
                        ["a sourced artist record", f.artists],
                        ["where they're from", f.home],
                        ["stand-ins Qloo can answer for", f.similar],
                        ["popularity", f.popularity],
                        ["genres", f.genres],
                        ["a description", f.description],
                        ["an image", f.image],
                      ] as const
                    ).map(([label, v], i) => (
                      <TableRow key={label}>
                        <TableCell className="whitespace-normal">{label}</TableCell>
                        <TableCell className="w-[45%]">
                          <Bar value={v} max={f.artists} label={`${share(v, f.artists)}%`} fill={i < 2} />
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="whitespace-normal text-muted-foreground">low confidence (no MusicBrainz record)</TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">{share(f.lowConfidence, f.artists)}%</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="whitespace-normal text-muted-foreground">cited fields per record, average</TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">{f.citedFields}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="whitespace-normal text-muted-foreground">researched artists · claims verified · rejected</TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {num(s.research.artists)} · {num(s.research.verified)} · {num(s.research.rejected)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ) : null}

            <div className="flex flex-col gap-3.5">
              <div className="border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>app</TableHead>
                      <TableHead className="text-right">lookups</TableHead>
                      <TableHead className="text-right">artists</TableHead>
                      <TableHead>we filled in</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.apps.map((a) => (
                      <TableRow key={a.app} data-state={a.app === app ? "selected" : undefined}>
                        <TableCell>
                          <Link href={proofHref(a.app === app ? undefined : a.app)} aria-current={a.app === app ? "page" : undefined} className="underline-offset-4 hover:underline">
                            {a.app}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{num(a.lookups)}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(a.artists)}</TableCell>
                        <TableCell className="w-[40%]">{a.artists ? <Bar value={a.gapPct} max={100} label={`${a.gapPct}%`} fill={false} /> : <span className="text-muted-foreground">no lookups</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs leading-[1.6] text-muted-foreground">
                Each artist counts once, by its latest lookup. Apps are the label callers give: /q/app/&lt;label&gt; or X-NotOnQ-App. Pick an app here or in the
                filter to scope live and artists to it. The benchmark batch is the app &quot;benchmark&quot;.
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ value, label, fill }: { value: string; label: string; fill?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-l px-4 py-3.5 [&:nth-child(-n+2)]:border-t-0 [&:nth-child(odd)]:border-l-0 md:border-t-0 md:[&:nth-child(odd)]:border-l md:[&:first-child]:border-l-0">
      <b className={`text-[28px] leading-none font-extrabold tracking-[-0.04em] tabular-nums ${fill ? "text-fill" : ""}`}>{value}</b>
      <span className="text-xs leading-normal text-muted-foreground">{label}</span>
    </div>
  );
}

const plus = (list: string[]) => (list.length ? `${list[0]}${list.length > 1 ? ` +${list.length - 1}` : ""}` : undefined);

function Value({ children, title }: { children?: React.ReactNode; title?: string }) {
  return children === undefined || children === false ? (
    <span className="text-dim">none</span>
  ) : (
    <span className="text-fill" title={title}>
      {children}
    </span>
  );
}

function Artists({ s }: { s: ProofStats }) {
  const rows = s.artistRows;
  const max = Math.max(1, ...rows.map((r) => r.lookups));
  const asked = (k: FillQuestion) => rows.filter((r) => r.ask[k]?.answered).length;
  const f = s.filled;
  return (
    <section aria-labelledby="asked" className="flex flex-col gap-3.5">
      <h2 id="asked" className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] font-medium">
        artists
        <small className="text-xs font-normal text-muted-foreground">
          filled in by NotOnQ, most looked up first{s.since ? ` · since ${day(s.since)}` : ""}
          {f.artists > rows.length ? ` · top ${ARTIST_ROWS} of ${num(f.artists)}` : ""}
        </small>
      </h2>
      <div className="border">
        <Table className="[&_td]:py-2.5 [&_th]:py-2.5">
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="text-right">
                #
              </TableHead>
              <TableHead rowSpan={2}>artist</TableHead>
              <TableHead rowSpan={2} className="min-w-40">
                lookups
              </TableHead>
              <TableHead colSpan={6} className="border-b">
                record
              </TableHead>
              <TableHead colSpan={5} className="border-b">
                Ask questions
              </TableHead>
            </TableRow>
            <TableRow>
              <TableHead>home</TableHead>
              <TableHead>genres</TableHead>
              <TableHead>similar, in Qloo</TableHead>
              <TableHead>description</TableHead>
              <TableHead>image</TableHead>
              <TableHead>popularity</TableHead>
              {ASK.map(([k, label]) => (
                <TableHead key={k}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <ArtistRow key={r.nameKey} r={r} rank={i + 1} max={max} />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell />
              <TableCell>all</TableCell>
              <TableCell className="text-muted-foreground">{num(f.artists)} artists</TableCell>
              {[f.home, f.genres, f.similar, f.description, f.image, f.popularity].map((n, i) => (
                <TableCell key={i} className="tabular-nums">
                  {num(n)} <span className="font-normal text-muted-foreground">({share(n, f.artists)}%)</span>
                </TableCell>
              ))}
              {ASK.map(([k]) => (
                <TableCell key={k} className="tabular-nums">
                  {num(asked(k))} <span className="font-normal text-muted-foreground">answered</span>
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <p className="text-xs leading-[1.6] text-muted-foreground">
        Ask columns fill in for artists with Ask runs (the benchmark batch asks five questions per artist); empty means no run yet. Pick app benchmark to see that batch&apos;s artists and totals.
      </p>
    </section>
  );
}

function ArtistRow({ r, rank, max }: { r: ProofArtist; rank: number; max: number }) {
  return (
    <TableRow>
      <TableCell className="text-right text-muted-foreground tabular-nums">{rank}</TableCell>
      <TableCell>
        <Link href={`/ledger/${encodeURIComponent(r.nameKey)}`} className="font-medium text-fill underline-offset-4 hover:underline">
          {r.name}
        </Link>
        {r.lowConfidence ? <span className="ml-2 text-[11px] text-muted-foreground">low confidence</span> : null}
      </TableCell>
      <TableCell>
        <Bar value={r.lookups} max={max} label={num(r.lookups)} fill={false} />
      </TableCell>
      <TableCell>
        <Value>{r.record.home}</Value>
      </TableCell>
      <TableCell>
        <Value title={r.record.genres.join(", ")}>{plus(r.record.genres)}</Value>
      </TableCell>
      <TableCell>
        <Value title={r.record.similar.join(", ")}>{plus(r.record.similar)}</Value>
      </TableCell>
      <TableCell>
        <Value>{r.record.description && "Wikipedia"}</Value>
      </TableCell>
      <TableCell>
        <Value>{r.record.image && "yes"}</Value>
      </TableCell>
      <TableCell>
        <Value>{r.record.popularity?.toFixed(2)}</Value>
      </TableCell>
      {ASK.map(([k, label]) => {
        const q = r.ask[k];
        return (
          <TableCell key={k}>
            {q ? (
              <Link href={`/ledger/run/${q.runId}`} className={q.answered ? "text-fill underline-offset-4 hover:underline" : "text-muted-foreground underline-offset-4 hover:underline"}>
                {q.answered ? "answered" : "asked"}
                <span className="sr-only">: {label}, see the run</span>
              </Link>
            ) : (
              <span className="sr-only">no run yet</span>
            )}
          </TableCell>
        );
      })}
    </TableRow>
  );
}

function Terms() {
  return (
    <section aria-label="Terms">
      <dl className="grid grid-cols-1 border-b text-xs leading-[1.6] text-subtle sm:grid-cols-[180px_minmax(0,1fr)]">
        <dt className="border-t pt-2 text-muted-foreground sm:py-2">G1 · new to Qloo</dt>
        <dd className="pb-2 sm:border-t sm:pt-2">No Qloo entity yet by MusicBrainz ID or exact name. We fill in the whole record, from open sources.</dd>
        <dt className="border-t pt-2 text-muted-foreground sm:py-2">G2 · not yet a taste signal</dt>
        <dd className="pb-2 sm:border-t sm:pt-2">Qloo has the entity, but /v2/insights doesn&apos;t take it as a signal yet. We answer through stand-ins, similar artists Qloo knows.</dd>
      </dl>
    </section>
  );
}
