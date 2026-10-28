"use client";

import { CheckIcon, ChevronRightIcon, CircleAlertIcon, CircleDashedIcon, ExternalLinkIcon, PlayIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { Mark } from "@/components/brand/mark";
import { NotOnQBadge } from "@/components/brand/notonq-badge";
import { Code } from "@/components/code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupTextarea } from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AskEvent, HttpExchange, Judgement, Origin, ResultItem, Row, Source } from "@/server/agent/ask";

// Home is Ask (Console direction): the question box is the hero; asking turns the page into a chat on the same URL.
// Each run is a live log on the left and what it found on the right; the answer, where every artist came from and the
// sources follow, with a link to the run in the Ledger.

/** Example questions, and who answers each (the tag on the row). */
const EXAMPLES: { q: string; tag: string; variant: "outline" | "again" | "notonq" }[] = [
  { q: "Recommend artists similar to Taylor Swift", tag: "Qloo answers", variant: "outline" },
  { q: "Find me 60s music popular in Lagos", tag: "Qloo, asked again", variant: "again" },
  { q: "Where in the US is sombr most popular?", tag: "NotOnQ fills sombr", variant: "notonq" },
  { q: "Where are Wampi's fans, and who are they?", tag: "NotOnQ fills Wampi", variant: "notonq" },
];
/** The open sources NotOnQ fills from. */
const OPEN_SOURCES = ["MusicBrainz", "Wikidata", "Wikipedia", "Last.fm", "Deezer"];

const VERDICT: Record<Judgement["verdict"], string> = { answered: "answered", partly: "partly answered", not_answered: "not answered" };
const MET = 0.6;
const pct = (p: number) => `${Math.round(p * 100)}%`;
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const brief = (input: unknown) =>
  Object.entries((input ?? {}) as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" · ");
const plain = (text: string) => text.replace(/\*\*/g, "");

type Turn = { key: number; question: string; events: AskEvent[]; times: number[]; running: boolean; error?: string; runId?: string; started: number };

/** Home: the question box, then one turn per question asked (question, live run, answer), then a follow-up box. */
export function Ask() {
  // Links from the Ledger prefill the question (?q=); asking stays a click, since each question spends model calls.
  const prefill = useSearchParams().get("q") ?? "";
  const [turns, setTurns] = useState<Turn[]>([]);
  const busy = turns.some((t) => t.running);
  const latest = useRef<HTMLDivElement>(null);

  const patch = (key: number, f: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.key === key ? f(t) : t)));

  async function run(question: string) {
    const key = Date.now();
    const started = performance.now();
    setTurns((all) => [...all, { key, question, events: [], times: [], running: true, started: Date.now() }]);
    requestAnimationFrame(() => latest.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      if (!res.ok || !res.body) {
        const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `The request failed (${res.status}).`;
        return patch(key, (t) => ({ ...t, error }));
      }
      const runId = res.headers.get("x-notonq-run") ?? undefined;
      patch(key, (t) => ({ ...t, runId }));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        const parsed = lines.filter(Boolean).map((l) => JSON.parse(l) as AskEvent);
        const at = performance.now() - started;
        if (parsed.length) patch(key, (t) => ({ ...t, events: [...t.events, ...parsed], times: [...t.times, ...parsed.map(() => at)] }));
      }
    } catch (e) {
      patch(key, (t) => ({ ...t, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      patch(key, (t) => ({ ...t, running: false }));
    }
  }

  if (!turns.length) return <Empty prefill={prefill} onRun={run} />;
  const last = turns.at(-1)!;
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-16">
      {turns.map((t) => (
        <div key={t.key} ref={t === last ? latest : undefined} className="scroll-mt-6">
          <TurnView turn={t} onRetry={busy ? undefined : () => void run(t.question)} />
        </div>
      ))}
      <FollowUp busy={busy} failed={!!(last.error || last.events.some((e) => e.type === "error"))} question={last.question} onRun={run} />
    </div>
  );
}

/** The empty page: what NotOnQ does, the question box and example questions. */
function Empty({ prefill, onRun }: { prefill: string; onRun: (q: string) => void }) {
  const [question, setQuestion] = useState(prefill);
  const submit = () => question.trim().length >= 3 && onRun(question.trim());
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-12 pt-6 sm:pt-12">
      <div className="flex max-w-[900px] flex-col gap-5">
        <span className="eyebrow">Qloo&apos;s MCP harness, with the gaps filled</span>
        <h1 className="text-[40px] leading-[1.04] font-extrabold tracking-[-0.05em] sm:text-[64px]">
          Ask about any artist. <span className="text-fill">We fill in the rest from open sources.</span>
        </h1>
        <p className="max-w-[62ch] text-[15px] leading-[1.7] text-subtle">
          Qloo answers first, unchanged. Jev, our judge, checks whether that answered you. If not, we ask Qloo again and fill in the rest from
          MusicBrainz, Wikidata, Wikipedia, Last.fm and Deezer. Everything we add is shown in <span className="text-fill">amber</span>, with its source.
        </p>
      </div>

      <form
        className="border border-strong bg-surface"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-2 border-b px-5 py-2.5 text-xs text-muted-foreground">
          <span>ask · new run</span>
          <span>open data: {OPEN_SOURCES.length} sources</span>
        </div>
        <InputGroup className="h-auto items-start rounded-none border-0 bg-transparent px-2 pt-5 pb-2 has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-transparent">
          <InputGroupAddon align="inline-start" className="pt-1.5">
            <PromptIcon className="size-[22px] text-fill" />
          </InputGroupAddon>
          <label htmlFor="ask-question" className="sr-only">
            Your music question
          </label>
          <InputGroupTextarea
            id="ask-question"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Where in the US is sombr most popular?"
            maxLength={300}
            className="min-h-24 text-[18px] leading-normal sm:text-[22px] md:text-[22px]"
          />
        </InputGroup>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-3 pb-5">
          <span className="text-xs text-muted-foreground">Enter to run · Shift+Enter for a new line · runs take 20 to 60 s</span>
          <Button type="submit" size="lg" className="h-12 px-6" disabled={question.trim().length < 3}>
            <PlayIcon className="fill-current" />
            Run
          </Button>
        </div>
      </form>

      <section aria-labelledby="try" className="flex flex-col">
        <h2 id="try" className="eyebrow mb-3">
          Try one
        </h2>
        <div className="border-b">
          {EXAMPLES.map((ex, i) => (
            <Button
              key={ex.q}
              type="button"
              variant="ghost"
              onClick={() => onRun(ex.q)}
              className="grid h-auto min-h-[52px] w-full grid-cols-[20px_minmax(0,1fr)] items-center justify-start gap-x-3 gap-y-1.5 border-0 border-t px-4 py-3 text-left text-sm font-normal whitespace-normal sm:grid-cols-[28px_minmax(0,1fr)_auto] sm:px-5 sm:py-0"
            >
              <span className="text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <span>{ex.q}</span>
              <Badge variant={ex.variant} className="col-start-2 sm:col-start-auto">
                {ex.tag}
              </Badge>
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}

/** The box under the last turn: a follow-up, or the same question again after a failed run. */
function FollowUp({ busy, failed, question, onRun }: { busy: boolean; failed: boolean; question: string; onRun: (q: string) => void }) {
  const [text, setText] = useState(failed ? question : "");
  const [was, setWas] = useState(failed);
  if (was !== failed) {
    setWas(failed);
    setText(failed ? question : "");
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && text.trim().length >= 3) {
          onRun(text.trim());
          setText("");
        }
      }}
    >
      <InputGroup className={`h-auto rounded-none bg-surface py-2 pr-2 pl-2 has-disabled:bg-surface has-disabled:opacity-100 dark:bg-surface dark:has-disabled:bg-surface ${busy ? "border-border" : "border-strong"}`}>
        <InputGroupAddon align="inline-start">
          <PromptIcon className={`size-[18px] ${busy ? "text-dim" : "text-fill"}`} />
        </InputGroupAddon>
        <label htmlFor="ask-follow-up" className="sr-only">
          {failed ? "Your question" : "Ask a follow-up"}
        </label>
        <InputGroupInput
          id="ask-follow-up"
          value={text}
          disabled={busy}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder={busy ? "Ask another question when this one finishes" : "Ask a follow-up, or anything else about an artist"}
          className="text-[15px] md:text-[15px]"
        />
        <InputGroupAddon align="inline-end">
          {busy ? (
            <Button type="submit" variant="outline" size="lg" disabled className="disabled:opacity-100">
              <Mark size={14} running />
              Running
            </Button>
          ) : (
            <Button type="submit" size="lg" disabled={text.trim().length < 3}>
              <PlayIcon className="fill-current" />
              Run
            </Button>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

/** The prompt glyph of the Console boards (a chevron and an underscore), drawn as an icon. */
function PromptIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true" className={className}>
      <path d="M6 6l6 6-6 6" />
      <path d="M14 18h6" />
    </svg>
  );
}

/** One question: what was asked, how the run stands, the run log beside what it found, and the answer. */
function TurnView({ turn, onRetry }: { turn: Turn; onRetry?: () => void }) {
  const now = useNow(turn.running);
  const elapsed = turn.running ? now - turn.started : (turn.times.at(-1) ?? 0);
  const failed = turn.error ?? (turn.events.find((e) => e.type === "error") as { message: string } | undefined)?.message;
  const answered = turn.events.some((e) => e.type === "answer" && e.column === "notonq");
  const steps = logLines(turn.events, turn.times).length;
  const stopped = !!failed && !answered && !turn.running;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 border-b pb-6">
        <span className="text-xs text-muted-foreground">you asked</span>
        <h1 className="text-2xl leading-[1.25] font-bold tracking-[-0.03em] break-words sm:text-[32px]">{turn.question}</h1>
        {turn.running ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-subtle">
            <span className="inline-flex items-center gap-2">
              <Mark size={14} running />
              running · step {steps} · {clock(elapsed).replace(/^0/, "")}
            </span>
            <span className="relative h-0.5 min-w-[200px] flex-1 overflow-hidden bg-border" role="progressbar" aria-label="Run in progress">
              <span className="absolute inset-y-0 left-0 w-1/3 animate-pulse bg-fill" />
            </span>
          </div>
        ) : stopped ? (
          <span className="inline-flex items-center gap-2 text-xs text-destructive">
            <CircleAlertIcon className="size-3.5" />
            stopped at step {steps} · {clock(elapsed).replace(/^0/, "")}
          </span>
        ) : null}
      </div>
      <RunView events={turn.events} times={turn.times} running={turn.running} runHref={turn.runId && !turn.running ? `/ledger/run/${turn.runId}` : undefined} error={turn.error} onRetry={onRetry} />
    </div>
  );
}

/** A clock that ticks once a second while a run is live. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

type LogLine = { t?: number; kind: "ok" | "miss" | "fill" | "error"; head: string; text?: string; redacted?: string };

/** The run log: one line per step, in the order the engine sent them. */
function logLines(events: AskEvent[], times: number[]): LogLine[] {
  const out: LogLine[] = [];
  events.forEach((e, i) => {
    const t = times[i];
    if (e.type === "call") {
      const filled = e.results.filter((r) => r.label);
      if (filled.length) {
        const sources = [...new Set(filled.flatMap((r) => r.sources?.map((s) => s.source) ?? []))];
        out.push({ t, kind: "fill", head: "notonq fill", text: `${[...new Set(filled.map((r) => r.name).filter(Boolean))].join(", ")}${sources.length ? ` from ${sources.join(", ")}` : ""} · ${e.tool}` });
      } else {
        const ok = e.status === "ok";
        const n = e.results.length;
        out.push({
          t,
          kind: ok ? "ok" : "miss",
          head: e.tool,
          text: [brief(e.input), ok ? (n ? `${n} result${n === 1 ? "" : "s"}` : "no results") : e.status.replace(/_/g, " ")].filter(Boolean).join(" · "),
        });
      }
    } else if (e.type === "stage") out.push({ t, kind: "ok", head: e.title, text: e.detail });
    else if (e.type === "judge")
      out.push({
        t,
        kind: e.judgement.verdict === "answered" ? "ok" : "miss",
        head: "Jev, the judge",
        text: `${VERDICT[e.judgement.verdict]}. ${e.judgement.met.map((c) => `${c.kind.replace("_", " ")}: ${c.value} ${pct(c.p)}`).join(", ")}. Met at 60%.`,
      });
    else if (e.type === "answer") out.push({ t, kind: "ok", head: e.column === "qloo" ? "qloo answer" : "answer", text: e.column === "qloo" ? "Qloo's first answer is in" : "written" });
    else if (e.type === "error") out.push({ t, kind: "error", head: e.column === "qloo" ? "qloo" : "run", text: e.message });
  });
  return out;
}

function LogIcon({ kind, now }: { kind: LogLine["kind"]; now: boolean }) {
  if (now) return <Mark size={14} running className="text-foreground" />;
  if (kind === "fill") return <PlusIcon className="size-3.5 text-fill" strokeWidth={2.5} />;
  if (kind === "miss") return <XIcon className="size-3.5 text-dim" />;
  if (kind === "error") return <CircleAlertIcon className="size-3.5 text-destructive" />;
  return <CheckIcon className="size-3.5 text-success" strokeWidth={2.5} />;
}

/**
 * One run: the log beside what it found, then the answer. Shared by Home (live) and the Ledger's replay (recorded
 * steps shown again, with their recorded times).
 */
export function RunView({ events, times, running, runHref, error, onRetry }: { events: AskEvent[]; times?: number[]; running: boolean; runHref?: string; error?: string; onRetry?: () => void }) {
  const lines = logLines(events, times ?? []);
  const failed = error ?? (events.find((e) => e.type === "error") as { message: string } | undefined)?.message;
  const answer = events.findLast((e) => e.type === "answer" && e.column === "notonq") as { text: string; source: string } | undefined;
  const qlooAnswer = events.find((e) => e.type === "answer" && e.column === "qloo") as { text: string } | undefined;
  const judge = events.findLast((e) => e.type === "judge") as { judgement: Judgement } | undefined;
  const reconcile = events.findLast((e) => e.type === "reconcile") as { rows: Row[]; places: number } | undefined;
  const calls = events.filter((e) => e.type === "call") as Extract<AskEvent, { type: "call" }>[];
  const stopped = !!failed && !answer && !running;

  return (
    <div className="grid items-start gap-12 min-[900px]:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <aside aria-label="Run log" className="flex flex-col gap-3 min-[900px]:sticky min-[900px]:top-6">
        <div className="flex justify-between gap-3 text-xs">
          <h2 className="eyebrow">Run log</h2>
          <span className="text-muted-foreground">{running ? "live" : `${lines.length} steps${times?.length ? ` · ${Math.round((times.at(-1) ?? 0) / 1000)} s` : ""}`}</span>
        </div>
        <ol className="flex flex-col" aria-live={running ? "polite" : undefined}>
          {lines.map((l, i) => {
            const now = running && i === lines.length - 1;
            return (
              <li key={i} className={`grid grid-cols-[52px_16px_minmax(0,1fr)] gap-2.5 border-t py-2.5 text-xs leading-[1.6] text-subtle ${now ? "bg-raised" : ""}`}>
                <time className="text-dim tabular-nums">{l.t === undefined ? "" : clock(l.t)}</time>
                <span className="pt-0.5">
                  <LogIcon kind={l.kind} now={now} />
                </span>
                <span className="min-w-0 break-words">
                  <b className={`font-medium ${l.kind === "fill" ? "text-fill" : l.kind === "error" ? "text-destructive" : "text-foreground"}`}>{l.head}</b> {l.text}
                </span>
              </li>
            );
          })}
          {running ? (
            <li className="grid grid-cols-[52px_16px_minmax(0,1fr)] gap-2.5 border-t py-2.5 text-xs text-dim">
              <span />
              <CircleDashedIcon className="mt-0.5 size-3.5" />
              <span>next step</span>
            </li>
          ) : stopped ? (
            <li className="grid grid-cols-[52px_16px_minmax(0,1fr)] gap-2.5 border-t py-2.5 text-xs text-dim">
              <span />
              <CircleDashedIcon className="mt-0.5 size-3.5" />
              <span>
                <b className="font-normal">the rest</b> not run
              </span>
            </li>
          ) : null}
        </ol>
        {runHref ? (
          <Button asChild variant="outline" size="lg" className="text-[13px] font-normal">
            <Link href={runHref}>
              {stopped ? "Open what ran in the Ledger" : "Open this run in the Ledger"}
              <ExternalLinkIcon />
            </Link>
          </Button>
        ) : null}
      </aside>

      <section aria-label={answer ? "Answer" : "What the run has found so far"} className="flex min-w-0 flex-col gap-10">
        {stopped ? <Stopped message={failed!} qlooAnswer={qlooAnswer?.text} onRetry={onRetry} /> : null}
        {answer ? (
          <>
            {answer.source === "qloo" ? (
              // Qloo answered the question by itself: its answer is the answer.
              <div className="flex flex-col gap-3.5">
                <h2 className="eyebrow">Answer · Qloo</h2>
                <p className="max-w-[64ch] text-base leading-[1.75] whitespace-pre-wrap sm:text-lg">{plain(qlooAnswer?.text ?? answer.text)}</p>
              </div>
            ) : (
              // We filled in: ours first, in the fill colour, and Qloo's right under it, so the difference shows at once.
              <div className="flex flex-col gap-8">
                <div className="flex flex-col gap-3.5">
                  <h2 className="eyebrow text-fill">Answer · filled in by NotOnQ</h2>
                  <p className="max-w-[64ch] text-base leading-[1.75] whitespace-pre-wrap text-fill sm:text-lg">{plain(answer.text)}</p>
                </div>
                {qlooAnswer ? (
                  <div className="flex flex-col gap-3.5 border-l-2 border-strong pl-4">
                    <h2 className="eyebrow">Qloo&apos;s answer, unchanged</h2>
                    <p className="max-w-[64ch] text-sm leading-[1.7] whitespace-pre-wrap text-subtle">{plain(qlooAnswer.text)}</p>
                  </div>
                ) : null}
              </div>
            )}
            <Origins rows={reconcile?.rows ?? []} places={reconcile?.places ?? 0} />
            <SourceList calls={calls} rows={reconcile?.rows ?? []} />
          </>
        ) : !stopped ? (
          <>
            {judge ? <JudgeCard judgement={judge.judgement} /> : null}
            <Filled calls={calls} />
            {running ? (
              <div className="flex flex-col gap-2.5 border border-dashed border-strong p-5">
                <h2 className="eyebrow">Answer</h2>
                <span className="text-[13px] text-muted-foreground">Written once the last step is in. Usually 20 to 60 s in all.</span>
                <div aria-hidden="true" className="flex flex-col gap-2.5 pt-1.5">
                  <span className="block h-2.5 w-[92%] bg-muted" />
                  <span className="block h-2.5 w-[84%] bg-muted" />
                  <span className="block h-2.5 w-[60%] bg-muted" />
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

/** The run stopped before an answer: say what happened, offer to run it again. */
function Stopped({ message, qlooAnswer, onRetry }: { message: string; qlooAnswer?: string; onRetry?: () => void }) {
  return (
    <>
      <div role="alert" className="flex flex-col gap-4 border border-destructive p-6">
        <div className="flex items-start gap-3.5">
          <CircleAlertIcon className="mt-1 size-6 shrink-0 text-destructive" />
          <div className="flex flex-col gap-2">
            <h2 className="text-[22px] leading-[1.35] font-bold tracking-[-0.02em]">The run stopped before an answer.</h2>
            <p className="max-w-[60ch] text-sm leading-[1.7] break-words text-subtle">
              {message} Nothing after that ran, and nothing was filled or guessed. Your question is still in the box below.
            </p>
          </div>
        </div>
        {onRetry ? (
          <div className="flex flex-wrap gap-2.5 sm:pl-[38px]">
            <Button size="lg" className="h-12 px-6" onClick={onRetry}>
              <RotateCcwIcon />
              Run it again
            </Button>
          </div>
        ) : null}
      </div>
      {qlooAnswer ? <QlooAnswer text={qlooAnswer} open /> : null}
    </>
  );
}

/** Qloo's own first answer, as its harness wrote it: shown, never hidden, but folded under ours. */
function QlooAnswer({ text, open }: { text: string; open?: boolean }) {
  return (
    <Collapsible defaultOpen={open} className="flex flex-col gap-2.5">
      <CollapsibleTrigger className="group flex w-fit items-center gap-1.5 text-left">
        <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <h2 className="eyebrow">Qloo&apos;s first answer, unchanged</h2>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="max-w-[64ch] text-[13px] leading-[1.7] whitespace-pre-wrap text-subtle">{plain(text)}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Jev's check of Qloo's answer: one meter per thing the question asks for, met at 60%. */
function JudgeCard({ judgement }: { judgement: Judgement }) {
  return (
    <div className="flex flex-col gap-3.5 border border-strong p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="eyebrow">Jev, the judge: did Qloo answer the question?</h2>
        <Badge variant="outline" className="border-foreground text-foreground">
          {VERDICT[judgement.verdict]}
        </Badge>
      </div>
      {judgement.met.map((c, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_80px_40px] items-center gap-3.5 text-[13px] sm:grid-cols-[minmax(0,1fr)_160px_44px]">
          <span className="min-w-0 break-words" title={c.check}>
            {c.kind.replace("_", " ")}: {c.value}
          </span>
          <Meter p={c.p} label={`${pct(c.p)}, met at 60%`} />
          <span className="text-right text-subtle tabular-nums">{pct(c.p)}</span>
        </div>
      ))}
      <span className="text-xs text-muted-foreground">Met at 60% or more.</span>
    </div>
  );
}

/** A score bar with the 60% line marked. */
function Meter({ p, label, fill }: { p: number; label?: string; fill?: boolean }) {
  return (
    <span className="relative" role="img" aria-label={label ?? pct(p)}>
      <Progress value={Math.round(p * 100)} className={`h-1.5 bg-border ${fill ? "" : "[&>[data-slot=progress-indicator]]:bg-foreground"}`} />
      <span aria-hidden="true" className="absolute -inset-y-1 left-[60%] w-px bg-muted-foreground" />
    </span>
  );
}

/** Every artist NotOnQ filled in so far in this run, with what it found and where. */
function Filled({ calls }: { calls: Extract<AskEvent, { type: "call" }>[] }) {
  const seen = new Map<string, { r: ResultItem; http?: HttpExchange[] }>();
  for (const c of calls)
    for (const r of c.results.filter((x) => x.label && x.name)) if (!seen.has(r.name!)) seen.set(r.name!, { r, http: (c as { http?: HttpExchange[] }).http });
  if (!seen.size) return null;
  return (
    <>
      {[...seen.values()].map(({ r, http }) => (
        <div key={r.name} className="flex flex-col gap-3 border border-fill p-5">
          <h2 className="eyebrow text-fill">{r.label === "picked" ? "Qloo's own record, picked by NotOnQ from open data" : "Filled in by NotOnQ, from open sources"}</h2>
          <span className="text-2xl font-bold tracking-[-0.03em] text-fill">{r.name}</span>
          {r.facts?.length ? (
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {r.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
          <SourceChips sources={r.sources} />
          {http?.length ? (
            <Collapsible className="flex flex-col gap-2 border-t pt-3">
              <CollapsibleTrigger className="group flex w-fit items-center gap-1.5 text-left text-xs text-subtle hover:text-foreground">
                <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]:rotate-90" />
                Request and response JSON (what your app gets from NotOnQ)
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-2">
                {http.map((h, i) => (
                  <Fragment key={i}>
                    <Code code={h.request} language="bash" title="Request (add your X-Api-Key header)" />
                    <Code code={JSON.stringify(h.json, null, 2)} language="json" title="Response" className="max-h-96 overflow-auto" />
                  </Fragment>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      ))}
    </>
  );
}

function SourceChips({ sources }: { sources?: Source[] }) {
  if (!sources?.length) return null;
  return (
    <span className="flex flex-wrap gap-2">
      {sources.map((s) =>
        s.url ? (
          <Badge key={s.source} asChild variant="notonq" title={s.licence}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.source}
            </a>
          </Badge>
        ) : (
          <Badge key={s.source} variant="notonq" title={s.licence}>
            {s.source}
          </Badge>
        ),
      )}
    </span>
  );
}

/** Who an artist came from: Qloo (first, again, or answering for stand-ins) or NotOnQ (picked or filled in). */
const FROM: Record<Origin, { tag: string; variant: "outline" | "again" | "notonq"; detail: string }> = {
  qloo: { tag: "Qloo", variant: "outline", detail: "first answer" },
  qloo_again: { tag: "Qloo, asked again", variant: "again", detail: "a second, different question" },
  qloo_lookup: { tag: "Qloo", variant: "outline", detail: "looked up by a name the agent chose" },
  qloo_via_notonq: { tag: "Qloo, asked again", variant: "again", detail: "answer for similar artists Qloo knows" },
  notonq_picked: { tag: "NotOnQ", variant: "notonq", detail: "Qloo's record, picked from open data" },
  notonq_added: { tag: "NotOnQ", variant: "notonq", detail: "filled in from open sources" },
};
const ORDER: Origin[] = ["notonq_added", "notonq_picked", "qloo_via_notonq", "qloo_again", "qloo_lookup", "qloo"];

function why(r: Row) {
  const failed = r.scores.filter((s) => s.p < MET);
  if (r.status === "removed") return `Misses ${failed.map((s) => `${s.kind.replace("_", " ")} ${s.value} (${pct(s.p)})`).join(", ")}`;
  if (r.status === "kept")
    return r.scores.length
      ? `${r.scores.every((s) => s.p >= MET) ? "Meets" : "Kept as Qloo returned it; scores"} ${r.scores.map((s) => `${s.kind.replace("_", " ")} (${pct(s.p)})`).join(", ")}`
      : "Returned for the question";
  return [r.facts?.join(" · "), r.scores.length ? r.scores.map((s) => `${s.kind.replace("_", " ")} ${pct(s.p)}`).join(", ") : ""].filter(Boolean).join(" · ");
}

/** Every artist in the run, where it came from, Jev's lowest score for it, and whether it stayed in the answer. */
function Origins({ rows, places }: { rows: Row[]; places: number }) {
  if (!rows.length) return null;
  const sorted = rows.toSorted((a, b) => ORDER.indexOf(a.origin) - ORDER.indexOf(b.origin));
  return (
    <div className="flex flex-col gap-3">
      <h2 className="eyebrow">Every artist, where it came from</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>artist</TableHead>
            <TableHead>from</TableHead>
            <TableHead>Jev</TableHead>
            <TableHead>in the answer</TableHead>
            <TableHead>why</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r, i) => {
            const f = FROM[r.origin];
            const low = r.scores.length ? Math.min(...r.scores.map((s) => s.p)) : undefined;
            return (
              <TableRow key={`${r.id}-${i}`} className="align-top">
                <TableCell className={`align-top font-medium whitespace-normal ${f.variant === "notonq" ? "text-fill" : ""}`}>
                  {r.link ? (
                    <a href={r.link} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                      {r.name}
                    </a>
                  ) : (
                    r.name
                  )}
                </TableCell>
                <TableCell className="align-top">
                  <Badge variant={f.variant}>{f.tag}</Badge>
                  <div className="mt-1 text-[11px] whitespace-normal text-muted-foreground">{f.detail}</div>
                </TableCell>
                <TableCell className="align-top">
                  {low === undefined ? (
                    <span className="text-muted-foreground">not scored</span>
                  ) : (
                    <span className="grid grid-cols-[48px_34px] items-center gap-2 text-xs tabular-nums">
                      <Meter p={low} />
                      {pct(low)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="align-top">{r.status === "added" ? <NotOnQBadge>added</NotOnQBadge> : r.status}</TableCell>
                <TableCell className="min-w-56 align-top text-xs whitespace-normal text-subtle">{why(r)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {places ? <span className="text-xs text-muted-foreground">Map answers ({places} points) are in the run log.</span> : null}
    </div>
  );
}

/** Every source behind the answer: Qloo's API for what Qloo answered, and each open source for what we filled in. */
function SourceList({ calls, rows }: { calls: Extract<AskEvent, { type: "call" }>[]; rows: Row[] }) {
  const open = new Map<string, { s: Source; names: Set<string> }>();
  const add = (s: Source, name?: string) => {
    const e = open.get(s.source) ?? { s, names: new Set<string>() };
    if (name) e.names.add(name);
    open.set(s.source, e);
  };
  for (const c of calls) for (const r of c.results) for (const s of r.sources ?? []) add(s, r.name);
  for (const r of rows) for (const s of r.sources ?? []) add(s, r.name);
  const qlooTools = [...new Set(calls.filter((c) => c.status === "ok" && !c.results.some((r) => r.label)).map((c) => c.tool))];
  const count = open.size + (qlooTools.length ? 1 : 0);
  if (!count) return null;
  return (
    <div id="sources" className="flex flex-col gap-2">
      <h2 className="eyebrow mb-1">Sources · {count}</h2>
      <Table>
        <TableBody>
          {qlooTools.length ? (
            <TableRow>
              <TableCell className="w-28 align-top">Qloo</TableCell>
              <TableCell className="text-xs whitespace-normal text-subtle">{qlooTools.join(", ")}</TableCell>
              <TableCell className="text-right text-xs text-dim">Qloo API</TableCell>
            </TableRow>
          ) : null}
          {[...open.values()].map(({ s, names }) => (
            <TableRow key={s.source}>
              <TableCell className="w-28 align-top text-fill">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                    {s.source}
                  </a>
                ) : (
                  s.source
                )}
              </TableCell>
              <TableCell className="text-xs whitespace-normal text-subtle">{[...names].join(", ")}</TableCell>
              <TableCell className="text-right text-xs text-dim">{s.licence ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
