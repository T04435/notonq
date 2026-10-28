"use client";

import { ChevronDownIcon, ChevronRightIcon, Link2Icon, PlayIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
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
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type LedgerParams, toLedgerSearch, type Visit } from "@/lib/ledger-params";
import type { VisitCall, VisitPage } from "@/server/store/visits";
import { type LiveStatus, useLive, useTween } from "./use-live";

export type LedgerData = {
  params: LedgerParams;
  /** The moment the page was rendered: live updates resume from here. */
  renderedAt: string;
  /** The apps seen in the Ledger, busiest first (the app filter). */
  apps: string[];
  visits: VisitPage;
  openCalls?: VisitCall[];
};

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
  const [counts, setCounts] = useState({ total: data.visits.total, helped: data.visits.helped, all: data.visits.all });
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [held, setHeld] = useState<Map<string, Visit>>(new Map());
  const [heldCounts, setHeldCounts] = useState<typeof counts | null>(null);
  const [shown, setShown] = useState(data);
  if (shown !== data) {
    setShown(data);
    setRows(data.visits.rows);
    setCounts({ total: data.visits.total, helped: data.visits.helped, all: data.visits.all });
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
      setCounts({ total: c.total, helped: c.helped, all: c.all });
    } else if (!params.before && c.rows.length) {
      setHeld((h) => new Map([...h, ...c.rows.map((v) => [v.id, v] as const)]));
      setHeldCounts({ total: c.total, helped: c.helped, all: c.all });
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
      <section aria-labelledby="visits" className="flex flex-col">
        <Filters params={params} apps={data.apps} go={go} />
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

/** The visits filters: what NotOnQ did, app and kind. */
function Filters({ params, apps, go }: { params: LedgerParams; apps: string[]; go: (p: Partial<LedgerParams>) => void }) {
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
  counts: { total: number; helped: number; all: number };
  params: LedgerParams;
  fresh: Set<string>;
  today: string;
  openCalls?: VisitCall[];
  next?: string;
  go: (p: Partial<LedgerParams>) => void;
}) {
  const total = useTween(counts.total);
  const helped = useTween(counts.helped);
  const all = useTween(counts.all);
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
          {params.view === "all" ? ` · ${helped} where we filled in` : ` · ${all} in all`}
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

/** An open visit lists its first calls; the rest are a click away (the board shows four). */
const FIRST_CALLS = 4;

function VisitRow({ v, today, open, isNew, delay, calls, onOpen }: { v: Visit; today: string; open: boolean; isNew: boolean; delay?: number; calls?: VisitCall[]; onOpen: (open: boolean) => void }) {
  const [showAll, setShowAll] = useState(false);
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
            <>
              {(showAll ? calls : calls.slice(0, FIRST_CALLS)).map((c) => (
                <li key={c.id} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 border-t py-2 text-xs animate-in fade-in motion-reduce:animate-none md:grid-cols-[64px_minmax(0,180px)_110px_minmax(0,1fr)_auto]">
                  <span className="text-muted-foreground tabular-nums">{c.createdAt.slice(11, 19)}</span>
                  <span className="min-w-0 truncate" title={c.title}>
                    {c.name}
                  </span>
                  <span className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
                    {c.servedBy === "needs_choice" ? <Badge variant="again">choice</Badge> : c.helped ? <NotOnQBadge>NotOnQ</NotOnQBadge> : <Badge variant="outline">Qloo</Badge>}
                  </span>
                  <span className={`col-span-2 col-start-2 min-w-0 break-words md:col-span-1 md:col-start-auto ${c.helped ? "text-subtle" : "text-muted-foreground"}`}>{c.detail}</span>
                  {c.helped || c.kind === "ask" ? (
                    <Button asChild variant="outline" size="sm" className="col-start-3 row-start-2 justify-self-end font-normal md:col-start-auto md:row-start-auto">
                      <Link href={`/ledger/run/${c.id}`}>
                        <PlayIcon className="fill-current" />
                        Replay
                      </Link>
                    </Button>
                  ) : (
                    // Qloo answered alone: its data isn't kept, only the count, so there is nothing to replay.
                    <span className="col-start-3 row-start-2 justify-self-end text-[11px] text-muted-foreground md:col-start-auto md:row-start-auto">counts only</span>
                  )}
                </li>
              ))}
              {calls.length > FIRST_CALLS ? (
                <li className="border-t py-2 text-xs md:pl-[78px]">
                  <Button variant="ghost" size="sm" className="font-normal text-muted-foreground" onClick={() => setShowAll(!showAll)}>
                    {showAll ? "Show fewer calls" : `+ ${calls.length - FIRST_CALLS} more call${calls.length - FIRST_CALLS === 1 ? "" : "s"}`}
                  </Button>
                </li>
              ) : null}
            </>
          ) : (
            <li className="py-2 text-xs text-muted-foreground">Loading calls</li>
          )}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
