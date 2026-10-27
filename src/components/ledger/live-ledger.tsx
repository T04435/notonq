"use client";

import { ChevronRight, Link2, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { NotOnQBadge } from "@/components/brand/notonq-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type LedgerParams, toLedgerSearch, type Visit } from "@/lib/ledger-params";
import type { ServerMessage } from "@/server/ledger-hub";
import type { Answer, LedgerRow } from "@/server/store/repo";
import type { LedgerSummary, VisitCall, VisitPage } from "@/server/store/visits";
import { type LiveStatus, useLive, useTween } from "./use-live";

export type LedgerData = {
  params: LedgerParams;
  /** The moment the page was rendered: the live socket resumes from here. */
  renderedAt: string;
  summary: LedgerSummary;
  visits?: VisitPage;
  openCalls?: VisitCall[];
  artists?: { rows: LedgerRow[]; total: number; next?: string };
};

const ANSWER: Record<Answer, string> = { notonq: "NotOnQ", qloo: "Qloo", choice: "Awaiting a choice", none: "Nothing found yet" };
/** The apps offered as filters: the hackathon apps, then the busiest in the last 24 h, then whatever the URL names. */
const KNOWN_APPS = ["ghostq", "busk-map", "front-room", "ask"];
const MAX_APPS = 8;
const STAGGER = 12;

export function LiveLedger({ data }: { data: LedgerData }) {
  const { params } = data;
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const go = (next: Partial<LedgerParams>) => startTransition(() => router.replace(`${pathname}${toLedgerSearch({ ...params, ...next })}`, { scroll: false }));

  // Rows on screen: the server's page, plus what the socket pushed since. Reset whenever the server renders anew.
  const [rows, setRows] = useState<Visit[]>(data.visits?.rows ?? []);
  const [counts, setCounts] = useState({ total: data.visits?.total ?? 0, helped: data.visits?.helped ?? 0 });
  const [summary, setSummary] = useState(data.summary);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [held, setHeld] = useState<Map<string, Visit>>(new Map());
  const [heldCounts, setHeldCounts] = useState<typeof counts | null>(null);
  // A new server render (filters, page, "as of") replaces what's on screen; rows new to it animate in as they mount.
  const [shown, setShown] = useState(data);
  if (shown !== data) {
    setShown(data);
    setRows(data.visits?.rows ?? []);
    setCounts({ total: data.visits?.total ?? 0, helped: data.visits?.helped ?? 0 });
    setSummary(data.summary);
    setHeld(new Map());
    setHeldCounts(null);
    setFresh(new Set());
  }

  const live = params.live && !params.before && !params.at;
  const apply = (incoming: Visit[]) => {
    setRows((now) => {
      const byId = new Map(now.map((v) => [v.id, v]));
      for (const v of incoming) byId.set(v.id, v);
      return [...byId.values()].sort((a, b) => (a.lastAt === b.lastAt ? b.id.localeCompare(a.id) : b.lastAt.localeCompare(a.lastAt)));
    });
    setFresh(new Set(incoming.map((v) => v.id)));
  };

  const status = useLive(params, data.renderedAt, (m: ServerMessage) => {
    if (m.type === "visits") {
      if (live) {
        apply(m.rows);
        setCounts({ total: m.total, helped: m.helped });
      } else if (!params.before) {
        setHeld((h) => new Map([...h, ...m.rows.map((v) => [v.id, v] as const)]));
        setHeldCounts({ total: m.total, helped: m.helped });
      }
    } else if (m.type === "summary" && live) setSummary(m.summary);
    else if (m.type === "artists" && live && params.tab === "artists") startTransition(() => router.refresh());
  });

  // Paused: hold still; "Show" brings in what arrived (and the URL moves its "as of" to now, so a shared link matches).
  const showHeld = () => {
    apply([...held.values()]);
    if (heldCounts) setCounts(heldCounts);
    setHeld(new Map());
    setHeldCounts(null);
    if (params.at) go({ at: new Date().toISOString() });
  };
  const setLive = (on: boolean) => (on ? go({ live: true, at: undefined, before: undefined }) : go({ live: false, at: new Date().toISOString() }));

  return (
    <div className="flex flex-col gap-5">
      <SummaryStrip summary={summary} onApp={(app) => go({ app: [app], before: undefined })} />
      <Toolbar params={params} status={status} live={live} held={held.size} onShow={showHeld} onLive={setLive} go={go} apps={summary.apps.map((a) => a.app)} />
      {params.tab === "requests" ? (
        <Visits
          rows={rows}
          counts={counts}
          params={params}
          fresh={fresh}
          stagger
          openCalls={data.openCalls}
          next={data.visits?.next}
          onOpen={(id) => go({ open: params.open === id ? undefined : id })}
          go={go}
        />
      ) : (
        <Artists data={data.artists} go={go} />
      )}
    </div>
  );
}

function SummaryStrip({ summary, onApp }: { summary: LedgerSummary; onApp: (app: string) => void }) {
  const visits = useTween(summary.visits);
  const helped = useTween(summary.helped);
  const share = summary.visits ? Math.round((summary.helped / summary.visits) * 100) : 0;
  return (
    <section aria-label="Last 24 hours" className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-[auto_auto_1fr_1fr]">
      <Stat label="Visits, 24 h" value={visits} />
      <Stat label="NotOnQ helped" value={helped} note={`${share}%`} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-muted-foreground uppercase">Calls by app</span>
        <div className="flex flex-wrap gap-1.5">
          {summary.apps.length ? (
            summary.apps.map((a) => (
              <button key={a.app} type="button" onClick={() => onApp(a.app)} className="rounded-md border px-2 py-0.5 font-mono text-xs hover:bg-accent">
                {a.app} · {a.calls}
                {a.helped ? ` (${a.helped} NotOnQ)` : ""}
              </button>
            ))
          ) : (
            <span className="text-muted-foreground">none yet</span>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-muted-foreground uppercase">Most asked, not in Qloo</span>
        <div className="flex flex-wrap gap-1.5">
          {summary.missing.length ? (
            summary.missing.map((m) => (
              <Link key={m.nameKey} href={`/ledger/${encodeURIComponent(m.nameKey)}`} className="underline-offset-4 hover:underline">
                {m.name} <span className="text-muted-foreground">×{m.requests}</span>
              </Link>
            ))
          ) : (
            <span className="text-muted-foreground">none yet</span>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="flex flex-col gap-1 pr-4">
      <span className="text-xs text-muted-foreground uppercase">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">
        {value}
        {note && <span className="ml-1.5 text-sm font-normal text-muted-foreground">{note}</span>}
      </span>
    </div>
  );
}

const STATUS: Record<LiveStatus, string> = { connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…", unavailable: "Live updates unavailable" };

function Toolbar({
  params,
  status,
  live,
  held,
  onShow,
  onLive,
  go,
  apps,
}: {
  params: LedgerParams;
  status: LiveStatus;
  live: boolean;
  held: number;
  onShow: () => void;
  onLive: (on: boolean) => void;
  go: (p: Partial<LedgerParams>) => void;
  apps: string[];
}) {
  const [q, setQ] = useState(params.q ?? "");
  const [urlQ, setUrlQ] = useState(params.q);
  if (urlQ !== params.q) {
    setUrlQ(params.q);
    setQ(params.q ?? "");
  }
  useEffect(() => {
    if ((params.q ?? "") === q) return;
    const t = setTimeout(() => go({ q: q || undefined, before: undefined, open: undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const appList = useMemo(() => [...new Set([...KNOWN_APPS, ...apps])].slice(0, MAX_APPS).concat(params.app.filter((a) => ![...KNOWN_APPS, ...apps].slice(0, MAX_APPS).includes(a))), [apps, params.app]);
  const dot = live && status === "live" ? "bg-success animate-pulse" : status === "unavailable" ? "bg-destructive" : "bg-muted-foreground";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={params.tab} onValueChange={(tab) => go({ tab: tab as LedgerParams["tab"], before: undefined, open: undefined })}>
          <TabsList>
            <TabsTrigger value="requests">Requests</TabsTrigger>
            <TabsTrigger value="artists">Artists</TabsTrigger>
          </TabsList>
        </Tabs>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={params.live} onCheckedChange={onLive} aria-label="Live updates" />
          <span className={`size-2 rounded-full ${dot}`} aria-hidden />
          <span>{params.live ? STATUS[status] : "Paused"}</span>
        </label>
        {!live && held > 0 && (
          <Button size="sm" variant="secondary" onClick={onShow} className="animate-in fade-in">
            {held} new since you paused · Show
          </Button>
        )}
        {params.before && (
          <Button size="sm" variant="ghost" onClick={() => go({ before: undefined })}>
            Back to newest
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artist or request" aria-label="Search the Ledger" className="w-56 pl-8" />
          </div>
          <Button size="sm" variant="outline" onClick={copy}>
            <Link2 aria-hidden /> {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {params.tab === "requests" ? (
          <>
            <ToggleGroup type="single" size="sm" variant="outline" value={params.view} onValueChange={(v) => v && go({ view: v as LedgerParams["view"], before: undefined })} aria-label="Show">
              <ToggleGroupItem value="helped">NotOnQ helped</ToggleGroupItem>
              <ToggleGroupItem value="qloo">Qloo only</ToggleGroupItem>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup type="single" size="sm" variant="outline" value={params.kind ?? "both"} onValueChange={(v) => v && go({ kind: v === "both" ? undefined : (v as "api" | "ask"), before: undefined })} aria-label="Kind">
              <ToggleGroupItem value="both">API and Ask</ToggleGroupItem>
              <ToggleGroupItem value="api">API</ToggleGroupItem>
              <ToggleGroupItem value="ask">Ask</ToggleGroupItem>
            </ToggleGroup>
          </>
        ) : (
          <ToggleGroup type="single" size="sm" variant="outline" value={params.result ?? "any"} onValueChange={(v) => v && go({ result: v === "any" ? undefined : (v as Answer), before: undefined })} aria-label="Answered by">
            <ToggleGroupItem value="any">Anyone</ToggleGroupItem>
            <ToggleGroupItem value="notonq">NotOnQ</ToggleGroupItem>
            <ToggleGroupItem value="qloo">Qloo</ToggleGroupItem>
            <ToggleGroupItem value="choice">Awaiting a choice</ToggleGroupItem>
          </ToggleGroup>
        )}
        <ToggleGroup type="multiple" size="sm" variant="outline" value={params.app} onValueChange={(app) => go({ app, before: undefined })} aria-label="Apps" className="flex-wrap">
          {appList.map((a) => (
            <ToggleGroupItem key={a} value={a} className="font-mono text-xs">
              {a}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}

function Visits({
  rows,
  counts,
  params,
  fresh,
  stagger,
  openCalls,
  next,
  onOpen,
  go,
}: {
  rows: Visit[];
  counts: { total: number; helped: number };
  params: LedgerParams;
  fresh: Set<string>;
  stagger: boolean;
  openCalls?: VisitCall[];
  next?: string;
  onOpen: (id: string) => void;
  go: (p: Partial<LedgerParams>) => void;
}) {
  const total = useTween(counts.total);
  const helped = useTween(counts.helped);
  if (!rows.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing here yet</EmptyTitle>
          <EmptyDescription>
            {params.view === "helped" ? "No visit where NotOnQ added data matches these filters. Try All." : "No visit matches these filters."} New ones appear here as they happen.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        Showing {rows.length} of {total} visits · {helped} where NotOnQ helped{params.at ? ` · as of ${params.at.slice(0, 16).replace("T", " ")} UTC` : ""}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Last call (UTC)</TableHead>
            <TableHead>Visit</TableHead>
            <TableHead>App</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead>NotOnQ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((v, i) => {
            const open = params.open === v.id;
            const motion = fresh.has(v.id) ? "ledger-new animate-in fade-in slide-in-from-top-2 duration-300" : stagger && i < STAGGER ? "animate-in fade-in slide-in-from-top-1 duration-300 fill-mode-both" : "";
            return (
              <VisitRow key={v.id} v={v} open={open} motion={motion} delay={stagger && !fresh.has(v.id) && i < STAGGER ? i * 30 : 0} calls={open ? openCalls : undefined} onOpen={() => onOpen(v.id)} />
            );
          })}
        </TableBody>
      </Table>
      {next && (
        <Button variant="outline" className="self-start" onClick={() => go({ before: next, open: undefined })}>
          Load older
        </Button>
      )}
    </div>
  );
}

function VisitRow({ v, open, motion, delay, calls, onOpen }: { v: Visit; open: boolean; motion: string; delay: number; calls?: VisitCall[]; onOpen: () => void }) {
  return (
    <>
      <TableRow className={`cursor-pointer motion-reduce:animate-none ${motion}`} style={delay ? { animationDelay: `${delay}ms` } : undefined} onClick={onOpen} aria-expanded={open}>
        <TableCell>
          <ChevronRight className={`size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} aria-hidden />
        </TableCell>
        <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{v.lastAt.slice(0, 16).replace("T", " ")}</TableCell>
        <TableCell className="max-w-md font-medium whitespace-normal break-words">
          {v.kind === "ask" ? <Badge variant="outline" className="mr-2">Ask</Badge> : null}
          {v.subject ?? v.title}
        </TableCell>
        <TableCell className="font-mono text-xs">{v.appLabel ?? "unlabelled"}</TableCell>
        <TableCell className="text-right tabular-nums">{v.calls}</TableCell>
        <TableCell>{v.helped ? <NotOnQBadge>{v.kind === "ask" ? "answered" : `${v.helped} of ${v.calls}`}</NotOnQBadge> : <Badge variant="secondary">Qloo only</Badge>}</TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell />
          <TableCell colSpan={5} className="whitespace-normal">
            {calls ? (
              <ol className="flex flex-col gap-1.5 py-1 text-sm">
                {calls.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline gap-2 animate-in fade-in motion-reduce:animate-none">
                    <span className="w-14 text-xs text-muted-foreground tabular-nums">{c.createdAt.slice(11, 19)}</span>
                    {c.helped ? <NotOnQBadge>NotOnQ</NotOnQBadge> : <Badge variant="secondary">Qloo</Badge>}
                    <Link href={`/ledger/run/${c.id}`} className="min-w-0 font-mono text-xs break-all underline-offset-4 hover:underline">
                      {c.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">{c.summary}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <span className="text-sm text-muted-foreground">Loading calls…</span>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function Artists({ data, go }: { data?: LedgerData["artists"]; go: (p: Partial<LedgerParams>) => void }) {
  const total = useTween(data?.total ?? 0);
  if (!data?.rows.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No artists match</EmptyTitle>
          <EmptyDescription>Artists looked up through NotOnQ appear here as they happen.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        Showing {data.rows.length} of {total} artists
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Artist</TableHead>
            <TableHead>Answered by</TableHead>
            <TableHead className="text-right">Lookups</TableHead>
            <TableHead className="text-right">Callers</TableHead>
            <TableHead>Apps</TableHead>
            <TableHead>Stand-ins</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((r, i) => (
            <TableRow key={r.nameKey} className={i < STAGGER ? "animate-in fade-in slide-in-from-top-1 duration-300 fill-mode-both motion-reduce:animate-none" : ""} style={i < STAGGER ? { animationDelay: `${i * 30}ms` } : undefined}>
              <TableCell className="font-medium">
                <Link href={`/ledger/${encodeURIComponent(r.nameKey)}`} className="underline-offset-4 hover:underline">
                  {r.name}
                </Link>
                {r.confidence === "low" && r.answer === "notonq" && (
                  <Badge variant="outline" className="ml-2">
                    low confidence
                  </Badge>
                )}
                {r.resolvedByQlooAt && (
                  <Badge variant="secondary" className="ml-2">
                    now in Qloo
                  </Badge>
                )}
              </TableCell>
              <TableCell>{r.answer === "notonq" ? <NotOnQBadge>NotOnQ</NotOnQBadge> : <Badge variant={r.answer === "qloo" ? "secondary" : "outline"}>{ANSWER[r.answer]}</Badge>}</TableCell>
              <TableCell className="text-right tabular-nums">{r.requests}</TableCell>
              <TableCell className="text-right tabular-nums">{r.callers}</TableCell>
              <TableCell className="max-w-48 whitespace-normal font-mono text-xs">{r.apps.join(", ")}</TableCell>
              <TableCell className="max-w-64 whitespace-normal text-xs text-muted-foreground">{r.standIns.map((s) => s.name).join(", ") || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data.next && (
        <Button variant="outline" className="self-start" onClick={() => go({ before: data.next })}>
          Load older
        </Button>
      )}
    </div>
  );
}

