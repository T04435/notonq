"use client";

import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, Link2Icon, PlayIcon, SearchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Mark } from "@/components/brand/mark";
import { NotOnQBadge } from "@/components/brand/notonq-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type LedgerParams, toLedgerSearch, type Visit } from "@/lib/ledger-params";
import type { Answer, LedgerRow } from "@/server/store/repo";
import type { VisitCall, VisitPage } from "@/server/store/visits";
import { type LiveStatus, useLive, useTween } from "./use-live";

export type LedgerData = {
  params: LedgerParams;
  /** The moment the page was rendered: live updates resume from here. */
  renderedAt: string;
  /** The apps seen in the Ledger, busiest first (the app filter). */
  apps: string[];
  /** The most asked artists, for the "Filter by artist" bar, and how many artists there are in all. */
  top: { rows: LedgerRow[]; total: number };
  visits: VisitPage;
  openCalls?: VisitCall[];
  /** The ranked artists panel, when open (artists=open). */
  artists?: { rows: LedgerRow[]; total: number; filled: number; next?: string };
};

const ANSWER: Record<Answer, string> = { notonq: "NotOnQ", qloo: "Qloo", choice: "awaiting a choice", none: "nothing found yet" };
/** The hackathon apps come first in the app filter, then the busiest. */
const KNOWN_APPS = ["ghostq", "busk-map", "front-room", "ask"];
const MAX_APPS = 10;
const STAGGER = 12;
const SEGMENTS = 10;

/** "14:02" today, "26 Oct 14:02" before; UTC, so the server and the browser print the same. */
function when(iso: string, today: string) {
  const d = new Date(iso);
  const hm = iso.slice(11, 16);
  return iso.slice(0, 10) === today ? hm : `${d.getUTCDate()} ${d.toLocaleString("en", { month: "short", timeZone: "UTC" })} ${hm}`;
}

export function LiveLedger({ data }: { data: LedgerData }) {
  const { params } = data;
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const go = (next: Partial<LedgerParams>) => startTransition(() => router.replace(`${pathname}${toLedgerSearch({ ...params, ...next })}`, { scroll: false }));

  // Rows on screen: the server's page, plus what arrived live since. Reset whenever the server renders anew.
  const [rows, setRows] = useState<Visit[]>(data.visits.rows);
  const [counts, setCounts] = useState({ total: data.visits.total, helped: data.visits.helped });
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [held, setHeld] = useState<Map<string, Visit>>(new Map());
  const [heldCounts, setHeldCounts] = useState<typeof counts | null>(null);
  const [shown, setShown] = useState(data);
  if (shown !== data) {
    setShown(data);
    setRows(data.visits.rows);
    setCounts({ total: data.visits.total, helped: data.visits.helped });
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

  const status = useLive(params, data.renderedAt, (c) => {
    if (live) {
      if (c.rows.length) apply(c.rows);
      setCounts({ total: c.total, helped: c.helped });
      // The artist bar and an open panel are server-rendered: refresh them when something changed.
      if (c.artists) startTransition(() => router.refresh());
    } else if (!params.before && c.rows.length) {
      setHeld((h) => new Map([...h, ...c.rows.map((v) => [v.id, v] as const)]));
      setHeldCounts({ total: c.total, helped: c.helped });
    }
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
  const today = data.renderedAt.slice(0, 10);

  return (
    <div className="flex flex-col gap-9">
      <LiveBar params={params} status={status} live={live} held={held.size} onShow={showHeld} onLive={setLive} go={go} />
      <ArtistBar top={data.top} params={params} go={go} />
      <section aria-labelledby="visits" className="flex flex-col">
        <Filters params={params} apps={data.apps} go={go} />
        {data.artists ? <ArtistsPanel data={data.artists} params={params} go={go} /> : null}
        <Visits rows={rows} counts={counts} params={params} fresh={fresh} today={today} openCalls={data.openCalls} next={data.visits.next} go={go} />
      </section>
    </div>
  );
}

const STATUS: Record<LiveStatus, string> = { connecting: "Connecting", live: "Live", reconnecting: "Reconnecting", unavailable: "Live updates unavailable" };

/** Live switch (pause holds the view still and counts what arrives), Copy link, and the way back from older pages. */
function LiveBar({ params, status, live, held, onShow, onLive, go }: { params: LedgerParams; status: LiveStatus; live: boolean; held: number; onShow: () => void; onLive: (on: boolean) => void; go: (p: Partial<LedgerParams>) => void }) {
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
  return (
    <div className="flex flex-wrap items-center justify-end gap-2.5">
      {params.before ? (
        <Button variant="ghost" size="lg" className="mr-auto font-normal" onClick={() => go({ before: undefined })}>
          Back to newest
        </Button>
      ) : null}
      {!live && held > 0 ? (
        <Button variant="outline" size="lg" onClick={onShow} className="border-fill font-normal text-fill animate-in fade-in">
          {held} new since you paused · Show
        </Button>
      ) : null}
      <Button variant="outline" size="lg" onClick={copy} className="font-normal">
        <Link2Icon aria-hidden />
        {copied ? "Copied" : "Copy link"}
      </Button>
      <label className={`inline-flex h-11 cursor-pointer items-center gap-2.5 border px-3.5 text-[13px] ${params.live ? "border-fill text-foreground" : "border-strong text-subtle"}`}>
        <Mark size={16} running={live && status === "live"} />
        {params.live ? STATUS[status] : "Paused"}
        <Switch checked={params.live} onCheckedChange={onLive} aria-label="Live updates" />
      </label>
    </div>
  );
}

/** The most asked artists as one-click filters (q=<name>), and the way into the full ranked list. */
function ArtistBar({ top, params, go }: { top: LedgerData["top"]; params: LedgerParams; go: (p: Partial<LedgerParams>) => void }) {
  if (!top.total) return null;
  const picked = params.q?.toLowerCase();
  return (
    <nav aria-label="Filter by artist" className="flex flex-col gap-3 border-b pb-6 sm:flex-row sm:flex-wrap sm:items-center">
      <h2 className="eyebrow sm:mr-2">Filter by artist</h2>
      <div className="flex flex-wrap items-center gap-2">
        {top.rows.map((a) => {
          const on = picked === a.name.toLowerCase();
          return (
            <Button
              key={a.nameKey}
              variant="outline"
              aria-pressed={on}
              onClick={() => go({ q: on ? undefined : a.name, before: undefined, open: undefined })}
              className={`h-9 font-normal ${on ? "border-fill bg-fill-ground text-fill" : ""} ${a.answer === "notonq" && !on ? "text-fill" : ""}`}
            >
              {a.name}
              <span className="text-muted-foreground tabular-nums">{a.requests}</span>
            </Button>
          );
        })}
        <Button
          variant="ghost"
          aria-expanded={params.artists}
          onClick={() => go({ artists: !params.artists, apage: undefined })}
          className="h-9 font-normal underline underline-offset-[5px]"
        >
          All {top.total} artists, most asked first
          {params.artists ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </Button>
      </div>
    </nav>
  );
}

/** The visits filters: what NotOnQ did, search, app and kind. */
function Filters({ params, apps, go }: { params: LedgerParams; apps: string[]; go: (p: Partial<LedgerParams>) => void }) {
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
  const appList = useMemo(() => {
    const base = [...new Set([...KNOWN_APPS, ...apps])].slice(0, MAX_APPS);
    return base.concat(params.app.filter((a) => !base.includes(a)));
  }, [apps, params.app]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3.5">
      <h2 id="visits" className="eyebrow">
        Visits
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={params.view} onValueChange={(v) => v && go({ view: v as LedgerParams["view"], before: undefined })} aria-label="Show">
          <ToggleGroupItem value="helped">Where we filled in</ToggleGroupItem>
          <ToggleGroupItem value="qloo">Qloo alone</ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
        </ToggleGroup>
        <InputGroup className="h-9 w-full rounded-none border-strong bg-transparent sm:w-56 dark:bg-transparent">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artist or question" aria-label="Search the Ledger" className="text-xs md:text-xs" />
          {q ? (
            <InputGroupAddon align="inline-end">
              <Button variant="ghost" size="icon-xs" aria-label="Clear the search" onClick={() => setQ("")}>
                <XIcon />
              </Button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9 font-normal">
              <span className="text-muted-foreground">app</span>
              <b className="font-medium">{params.app.length ? params.app.join(", ") : "any"}</b>
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Apps</DropdownMenuLabel>
            {appList.map((a) => (
              <DropdownMenuCheckboxItem
                key={a}
                checked={params.app.includes(a)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(on) => go({ app: on ? [...params.app, a] : params.app.filter((x) => x !== a), before: undefined })}
              >
                {a}
              </DropdownMenuCheckboxItem>
            ))}
            {params.app.length ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={false} onCheckedChange={() => go({ app: [], before: undefined })}>
                  Any app
                </DropdownMenuCheckboxItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9 font-normal">
              <span className="text-muted-foreground">kind</span>
              <b className="font-medium">{params.kind === "api" ? "API" : params.kind === "ask" ? "Ask" : "API + Ask"}</b>
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={params.kind ?? "both"} onValueChange={(v) => go({ kind: v === "both" ? undefined : (v as "api" | "ask"), before: undefined })}>
              <DropdownMenuRadioItem value="both">API + Ask</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="api">API (apps and Qloo&apos;s MCP)</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="ask">Ask questions</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Every artist looked up, most asked first; pick one to see its visits. Replaces the old Artists tab. */
function ArtistsPanel({ data, params, go }: { data: NonNullable<LedgerData["artists"]>; params: LedgerParams; go: (p: Partial<LedgerParams>) => void }) {
  const total = useTween(data.total);
  const max = Math.max(1, ...data.rows.map((r) => r.requests));
  const picked = params.q?.toLowerCase();
  return (
    <section aria-labelledby="artists" className="mb-6 flex flex-col gap-3 border border-fill bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 id="artists" className="eyebrow">
          Pick an artist · most asked first
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            value={params.result ?? "any"}
            onValueChange={(v) => v && go({ result: v === "any" ? undefined : (v as Answer), apage: undefined })}
            aria-label="Answered by"
          >
            <ToggleGroupItem value="any">anyone</ToggleGroupItem>
            <ToggleGroupItem value="notonq">NotOnQ</ToggleGroupItem>
            <ToggleGroupItem value="qloo">Qloo</ToggleGroupItem>
            <ToggleGroupItem value="choice">awaiting a choice</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" className="h-9 font-normal" aria-expanded="true" onClick={() => go({ artists: false, apage: undefined, result: undefined })}>
            Close
            <ChevronUpIcon />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        Showing {data.rows.length} of {total} artists · {data.filled} we filled in from open sources. Pick one to see its visits.
      </p>
      {data.rows.length ? (
        <div className="border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>artist</TableHead>
                <TableHead className="text-right">lookups</TableHead>
                <TableHead className="text-right">callers</TableHead>
                <TableHead>apps</TableHead>
                <TableHead>stand-ins Qloo knows</TableHead>
                <TableHead>answered by</TableHead>
                <TableHead>
                  <span className="sr-only">Record</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => {
                const on = picked === r.name.toLowerCase();
                return (
                  <TableRow
                    key={r.nameKey}
                    data-state={on ? "selected" : undefined}
                    aria-selected={on}
                    className={`cursor-pointer ${on ? "[&>td:first-child]:shadow-[inset_2px_0_0_var(--fill)]" : ""}`}
                    onClick={() => go({ q: on ? undefined : r.name, before: undefined, open: undefined })}
                  >
                    <TableCell className="text-muted-foreground tabular-nums">{r.rank}</TableCell>
                    <TableCell className="font-medium whitespace-normal">
                      <button type="button" className={`text-left hover:underline ${r.answer === "notonq" ? "text-fill" : ""}`}>
                        {r.name}
                      </button>
                      {r.confidence === "low" && r.answer === "notonq" ? (
                        <Badge variant="outline" className="ml-2">
                          low confidence
                        </Badge>
                      ) : null}
                      {r.resolvedByQlooAt ? (
                        <Badge variant="outline" className="ml-2">
                          now in Qloo
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="grid grid-cols-[48px_28px] items-center justify-end gap-2.5 text-xs tabular-nums sm:grid-cols-[100px_28px]">
                        <Bar share={r.requests / max} />
                        <span className="text-right">{r.requests}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.callers}</TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="inline-flex flex-wrap gap-1">
                        {r.apps.map((a) => (
                          <AppTag key={a}>{a}</AppTag>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-64 text-xs whitespace-normal text-muted-foreground">{r.standIns.map((s) => s.name).join(", ") || (r.answer === "notonq" ? "none yet" : "")}</TableCell>
                    <TableCell>{r.answer === "notonq" ? <NotOnQBadge>NotOnQ</NotOnQBadge> : <Badge variant="outline">{ANSWER[r.answer]}</Badge>}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Button asChild variant="outline" size="sm" className="font-normal">
                        <Link href={`/ledger/${encodeURIComponent(r.nameKey)}`}>
                          Record
                          <ChevronRightIcon />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No artist matches these filters.</p>
      )}
      <div className="flex justify-center gap-2">
        {params.apage ? (
          <Button variant="ghost" size="lg" className="font-normal" onClick={() => go({ apage: undefined })}>
            Back to most asked
          </Button>
        ) : null}
        {data.next ? (
          <Button variant="outline" size="lg" className="font-normal" onClick={() => go({ apage: data.next })}>
            More artists
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** A share of a whole, as an amber bar on a dark track. */
function Bar({ share }: { share: number }) {
  return (
    <i aria-hidden="true" className="block h-1.5 bg-border">
      <b className="block h-full bg-fill" style={{ width: `${Math.round(Math.min(1, share) * 100)}%` }} />
    </i>
  );
}

function AppTag({ children }: { children: React.ReactNode }) {
  return <Badge className="bg-muted px-1.5 text-foreground">{children}</Badge>;
}

/** How much of a visit NotOnQ answered: one segment per call (at most ten), amber where NotOnQ filled in. */
function Segments({ calls, helped }: { calls: number; helped: number }) {
  const n = Math.max(1, Math.min(SEGMENTS, calls));
  const f = calls ? Math.round((helped / calls) * n) : 0;
  return (
    <span aria-hidden="true" className="flex h-2 gap-0.5">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={`flex-1 ${i < f ? "bg-fill" : "bg-track"}`} />
      ))}
    </span>
  );
}

function Visits({
  rows,
  counts,
  params,
  fresh,
  today,
  openCalls,
  next,
  go,
}: {
  rows: Visit[];
  counts: { total: number; helped: number };
  params: LedgerParams;
  fresh: Set<string>;
  today: string;
  openCalls?: VisitCall[];
  next?: string;
  go: (p: Partial<LedgerParams>) => void;
}) {
  const total = useTween(counts.total);
  const helped = useTween(counts.helped);
  if (!rows.length)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>Nothing here yet</EmptyTitle>
          <EmptyDescription>
            {params.view === "helped" ? "No visit where we filled in matches these filters. Try All." : "No visit matches these filters."} New ones appear here as they happen.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  const what = params.view === "helped" ? " where we filled in" : params.view === "qloo" ? " Qloo answered alone" : "";
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap justify-between gap-2 pb-2.5 text-xs text-muted-foreground tabular-nums">
        <span>
          Showing {rows.length} of {total} visits{what}
          {params.q ? ` that mention ${params.q}` : ""}
          {params.view !== "helped" ? ` · ${helped} where we filled in` : ""}
          {params.at ? ` · as of ${params.at.slice(0, 16).replace("T", " ")} UTC` : ""}
        </span>
        <span>newest first · UTC</span>
      </div>
      <div className="border border-t-0" aria-live="polite">
        {rows.map((v, i) => (
          <VisitRow
            key={v.id}
            v={v}
            today={today}
            open={params.open === v.id}
            isNew={fresh.has(v.id)}
            delay={!fresh.has(v.id) && i < STAGGER ? i * 30 : undefined}
            calls={params.open === v.id ? openCalls : undefined}
            onOpen={(open) => go({ open: open ? v.id : undefined })}
          />
        ))}
      </div>
      {next ? (
        <div className="flex justify-center pt-5">
          <Button variant="outline" size="lg" className="font-normal" onClick={() => go({ before: next, open: undefined })}>
            Load older
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function VisitRow({ v, today, open, isNew, delay, calls, onOpen }: { v: Visit; today: string; open: boolean; isNew: boolean; delay?: number; calls?: VisitCall[]; onOpen: (open: boolean) => void }) {
  const motion = isNew ? "ledger-new animate-in fade-in slide-in-from-top-2 duration-300 bg-fill-ground shadow-[inset_2px_0_0_var(--fill)]" : delay !== undefined ? "animate-in fade-in slide-in-from-top-1 duration-300 fill-mode-both" : "";
  const help = v.kind === "ask" ? (v.helped ? "Ask · we filled in" : "Ask · Qloo answered") : `${v.calls} call${v.calls === 1 ? "" : "s"} · ${v.helped ? `NotOnQ answered ${v.helped}` : "Qloo answered all"}`;
  return (
    <Collapsible open={open} onOpenChange={onOpen}>
      <CollapsibleTrigger
        className={`grid min-h-14 w-full grid-cols-[64px_minmax(0,1fr)_24px] items-center gap-x-3 gap-y-2 border-t px-4 py-3.5 text-left text-[13px] hover:bg-surface motion-reduce:animate-none md:grid-cols-[76px_140px_minmax(0,1fr)_210px_24px] md:gap-4 ${open ? "bg-surface" : ""} ${motion}`}
        style={delay ? { animationDelay: `${delay}ms` } : undefined}
      >
        <span className={isNew ? "text-fill" : "text-muted-foreground tabular-nums"}>{isNew ? "just now" : when(v.lastAt, today)}</span>
        <span className="col-start-2 row-start-2 md:col-start-auto md:row-start-auto">
          <AppTag>{v.appLabel ?? "unlabelled"}</AppTag>
        </span>
        <span className={`col-start-2 row-start-1 min-w-0 break-words md:col-start-auto md:row-start-auto ${v.kind === "api" ? "font-medium" : ""}`}>{v.subject ?? v.title}</span>
        <span className="col-span-full flex flex-col gap-1.5 md:col-span-1">
          <Segments calls={v.calls} helped={v.helped} />
          <span className="text-[11px] text-subtle">{help}</span>
        </span>
        <span className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
          {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4 text-muted-foreground" />}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol aria-label="Calls in this visit" className="flex flex-col bg-surface px-3 pt-1 pb-4 md:pl-[108px] md:pr-4">
          {calls ? (
            calls.map((c) => (
              <li key={c.id} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 border-t py-2 text-xs animate-in fade-in motion-reduce:animate-none md:grid-cols-[64px_minmax(0,220px)_110px_minmax(0,1fr)_auto]">
                <span className="text-muted-foreground tabular-nums">{c.createdAt.slice(11, 19)}</span>
                <span className="min-w-0 truncate" title={c.title}>
                  {c.title}
                </span>
                <span className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
                  {c.servedBy === "needs_choice" ? <Badge variant="again">choice</Badge> : c.helped ? <NotOnQBadge>NotOnQ</NotOnQBadge> : <Badge variant="outline">Qloo</Badge>}
                </span>
                <span className="col-span-2 col-start-2 min-w-0 break-words text-subtle md:col-span-1 md:col-start-auto">{c.summary}</span>
                <Button asChild variant="outline" size="sm" className="col-start-3 row-start-2 justify-self-end font-normal md:col-start-auto md:row-start-auto">
                  <Link href={`/ledger/run/${c.id}`}>
                    <PlayIcon className="fill-current" />
                    Replay
                  </Link>
                </Button>
              </li>
            ))
          ) : (
            <li className="py-2 text-xs text-muted-foreground">Loading calls</li>
          )}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
