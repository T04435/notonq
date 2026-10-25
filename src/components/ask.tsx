"use client";

import { ChevronRightIcon, CircleCheckIcon, CircleDotIcon, CircleXIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Mark } from "@/components/brand/mark";
import { NotOnQBadge } from "@/components/brand/notonq-badge";
import { Code } from "@/components/code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AskEvent, Column, Constraint, HttpExchange, Judgement, Origin, ResultItem, Row } from "@/server/agent/ask";

const EXAMPLES = [
  "Where in the US is sombr most popular, and what artists would his fans like?",
  "Find me 60s music popular in Lagos",
  "Recommend artists similar to Taylor Swift",
];

const VERDICT: Record<Judgement["verdict"], { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  answered: { label: "answered", variant: "secondary" },
  partly: { label: "partly answered", variant: "outline" },
  not_answered: { label: "not answered", variant: "destructive" },
};

const SOURCE: Record<string, string> = { qloo: "Answer", qloo_better: "In short", notonq: "In short" };

const brief = (input: unknown) =>
  Object.entries((input ?? {}) as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" · ");

/** One question, answered by Qloo's own MCP harness twice: Qloo alone, and through NotOnQ. Every step is shown. */
export function Ask() {
  // Links from the Ledger prefill the question (?q=); asking stays a click, since each question spends model calls.
  const [question, setQuestion] = useState(useSearchParams().get("q") ?? "");
  const [events, setEvents] = useState<AskEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();

  async function run(q: string) {
    setQuestion(q);
    setEvents([]);
    setError(undefined);
    setRunning(true);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
      if (!res.ok || !res.body) {
        setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `The request failed (${res.status}).`);
        return;
      }
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
        if (parsed.length) setEvents((prev) => [...prev, ...parsed]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }


  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim().length >= 3) void run(question.trim());
        }}
      >
        <label htmlFor="ask-question" className="sr-only">
          Your question
        </label>
        <Input id="ask-question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask what you would ask Qloo's MCP, e.g. find me 60s music popular in Lagos" />
        <Button type="submit" disabled={running}>
          {running ? <Spinner /> : null}
          Ask
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        Try:
        {EXAMPLES.map((q) => (
          <Button key={q} variant="outline" size="sm" disabled={running} onClick={() => void run(q)} className="h-auto whitespace-normal text-left">
            {q}
          </Button>
        ))}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {events.length || running ? <RunView events={events} running={running} /> : null}
    </div>
  );
}

/** One run, step by step: shared by Ask (live) and the Ledger's replay (recorded steps shown again). */
export function RunView({ events, running }: { events: AskEvent[]; running: boolean }) {
  const constraints = (events.find((e) => e.type === "constraints") as { constraints: Constraint[] } | undefined)?.constraints;
  const failed = events.find((e) => e.type === "error") as { message: string } | undefined;
  return (
    <div className="flex flex-col gap-4">
      {failed ? <p className="text-sm text-destructive">{failed.message}</p> : null}
      {/* One timeline: Qloo answers first through its own harness; NotOnQ carries on from that answer, below it. */}
      <Card>
          <CardContent className="flex flex-col gap-6">
            <Section
              column="qloo"
              step="1"
              title="Qloo, through its own MCP harness"
              description="Qloo's harness and tools, unchanged, base URL = Qloo. This is what any Qloo MCP user gets today."
              events={events}
              running={running}
            />
            <Section
              column="notonq"
              step="2"
              title="NotOnQ carries on from Qloo's answer"
              description="Same harness and model. It checks whether Qloo's answer meets the question; only if not does it ask Qloo again, then add open data, labelled."
              events={events}
              running={running}
              constraints={constraints}
            />
          </CardContent>
      </Card>
    </div>
  );
}

function Section({ column, step, title, description, events, running, constraints }: { column: Column; step: string; title: string; description: string; events: AskEvent[]; running: boolean; constraints?: Constraint[] }) {
  const mine = events.filter((e) => ("column" in e && e.column === column) || (column === "notonq" && e.type === "judge"));
  const answer = mine.find((e) => e.type === "answer") as { text: string; source: string } | undefined;
  const qlooDone = events.some((e) => e.type === "answer" && e.column === "qloo");
  if (column === "notonq" && !qlooDone && !mine.length) return null;
  return (
    <section className={column === "notonq" ? "flex flex-col gap-4 border-t pt-6" : "flex flex-col gap-4"}>
      <header className="flex flex-col gap-1">
        <h2 className="flex items-baseline gap-2 text-base font-medium">
          <span className="text-xs text-muted-foreground tabular-nums">{step}</span>
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      <div className="flex flex-col gap-4">
        {column === "notonq" && constraints ? (
          <div className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">What the question asks for</span>
            <div className="flex flex-wrap gap-1.5">
              {constraints.map((c, i) => (
                <Badge key={i} variant="outline">
                  {c.kind.replace("_", " ")}: {c.value}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        <Trace>
          {mine.map((e, i) =>
            e.type === "call" ? (
              <CallLine key={i} call={e} />
            ) : e.type === "stage" ? (
              <div key={i} className="flex flex-col gap-0.5 pt-2">
                <TraceLine className="items-start">
                  <TraceIcon className="mt-0.5">
                    <CircleDotIcon />
                  </TraceIcon>
                  <TraceTitle className="whitespace-normal font-medium text-foreground">{e.title}</TraceTitle>
                </TraceLine>
                {e.detail ? <span className="pl-6 text-xs break-words text-muted-foreground">{e.detail}</span> : null}
              </div>
            ) : e.type === "judge" ? (
              <JudgeBlock key={i} judgement={e.judgement} />
            ) : null,
          )}
        </Trace>
        {column === "notonq" ? <Reconcile event={events.find((e) => e.type === "reconcile") as { rows: Row[]; places: number } | undefined} /> : null}
        {answer ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <span className="text-xs text-muted-foreground">{SOURCE[answer.source]}</span>
            <p className="whitespace-pre-wrap text-sm">{answer.text.replace(/\*\*/g, "")}</p>
          </div>
        ) : running ? (
          <Spinner />
        ) : null}
      </div>
    </section>
  );
}

function CallLine({ call }: { call: { tool: string; input: unknown; status: string; results: ResultItem[]; http?: HttpExchange[] } }) {
  const ok = call.status === "ok";
  return (
    <div className="flex flex-col gap-1.5">
      <TraceLine status={call.status === "error" ? "error" : undefined} className="items-start">
        <TraceIcon className="mt-0.5">{ok ? <CircleCheckIcon /> : <CircleXIcon />}</TraceIcon>
        <TraceTitle className="whitespace-normal">
          <span className="font-medium text-foreground">{call.tool}</span> {call.status !== "ok" ? `· ${call.status.replace("_", " ")}` : ""}
          {call.tool === "qloo_describe" ? <span className="text-muted-foreground"> · a lookup by a name the agent chose</span> : null}
        </TraceTitle>
      </TraceLine>
      <span className="pl-6 text-xs break-words text-muted-foreground">{brief(call.input)}</span>
      {call.results.some((r) => r.sources?.length || r.facts?.length) ? (
        <ul className="flex flex-col gap-2 pl-6">
          {call.results
            .filter((r) => r.sources?.length || r.facts?.length)
            .map((r, i) => (
              <li key={i} className="flex flex-col gap-1 border-l border-dashed pl-3 text-xs">
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground"> · {r.label === "picked" ? "Qloo's own record, picked by NotOnQ" : "not in Qloo, filled by NotOnQ"}</span>
                </span>
                {r.facts?.length ? <span className="text-muted-foreground">{r.facts.join(" · ")}</span> : null}
                {r.sources?.length ? (
                  <span className="flex flex-wrap gap-1">
                    {r.sources.map((s) =>
                      s.url ? (
                        <Badge key={s.source} asChild variant="outline" title={s.licence}>
                          <a href={s.url} target="_blank" rel="noreferrer">
                            {s.source}
                          </a>
                        </Badge>
                      ) : (
                        <Badge key={s.source} variant="outline" title={s.licence}>
                          {s.source}
                        </Badge>
                      ),
                    )}
                  </span>
                ) : null}
              </li>
            ))}
        </ul>
      ) : null}
      {call.http?.map((h, i) => (
        <Collapsible key={`h${i}`} className="flex flex-col gap-1.5 pl-6">
          <CollapsibleTrigger className="flex items-center gap-1 text-left text-xs underline-offset-4 hover:underline">
            <ChevronRightIcon className="size-3 shrink-0 transition-transform [[data-state=open]>&]:rotate-90" />
            What your app gets from NotOnQ (JSON)
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-2">
            <Code code={h.request} language="bash" title="Request (add your X-Api-Key header)" />
            <Code code={JSON.stringify(h.json, null, 2)} language="json" title="Response" className="max-h-96 overflow-auto" />
          </CollapsibleContent>
        </Collapsible>
      ))}
      {call.results.length ? (
        <div className="flex flex-wrap gap-1.5 pl-6">
          {(call.tool === "qloo_find_tags" ? call.results.filter((r, i, all) => all.findIndex((x) => x.name?.toLowerCase() === r.name?.toLowerCase()) === i) : call.results)
            .slice(0, 10)
            .map((r, i) => {
              const text = r.name ?? r.location;
              const chip = r.label ? (
                <NotOnQBadge>{text}</NotOnQBadge>
              ) : (
                <Badge variant="secondary" title={r.description}>
                  {text}
                </Badge>
              );
              return r.link ? (
                <a key={i} href={r.link} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline" title={r.description}>
                  {chip}
                </a>
              ) : (
                <span key={i}>{chip}</span>
              );
            })}
        </div>
      ) : null}
    </div>
  );
}

function JudgeBlock({ judgement }: { judgement: Judgement }) {
  const v = VERDICT[judgement.verdict];
  return (
    <div className="flex flex-col gap-2 border p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>Judge (Jev): did these results answer the question? Met at 60% or more.</span>
        <Badge variant={v.variant}>{v.label}</Badge>
      </div>
      {judgement.met.map((c, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-center gap-2 text-xs">
          <span className="truncate" title={c.check}>
            {c.kind.replace("_", " ")}: {c.value}
          </span>
          <span className="h-1.5 bg-muted" aria-hidden="true">
            <span className="block h-full bg-foreground" style={{ width: `${Math.round(c.p * 100)}%` }} />
          </span>
          <span className="text-right tabular-nums text-muted-foreground">{Math.round(c.p * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

/** Who an artist came from, at a glance: a plain Qloo badge (never Qloo's logo: not affiliated) or NotOnQ's mark. */
const FROM: Record<Origin, { who: "qloo" | "notonq"; detail: string }> = {
  qloo: { who: "qloo", detail: "first answer" },
  qloo_again: { who: "qloo", detail: "asked again" },
  qloo_lookup: { who: "qloo", detail: "looked up by a name the agent chose" },
  qloo_via_notonq: { who: "qloo", detail: "answer for NotOnQ's stand-ins" },
  notonq_picked: { who: "notonq", detail: "Qloo's record, picked from open data" },
  notonq_added: { who: "notonq", detail: "not in Qloo, from open data" },
};

function From({ origin }: { origin: Origin }) {
  const f = FROM[origin];
  return (
    <span className="flex flex-col gap-1">
      {f.who === "qloo" ? (
        <Badge variant="secondary" className="w-fit">
          Qloo
        </Badge>
      ) : (
        <span className="inline-flex w-fit items-center gap-1.5 text-xs font-medium">
          <Mark size={16} />
          NotOnQ
        </span>
      )}
      <span className="text-xs text-muted-foreground">{f.detail}</span>
    </span>
  );
}
const ORDER: Origin[] = ["qloo", "qloo_again", "qloo_lookup", "qloo_via_notonq", "notonq_picked", "notonq_added"];
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** What Qloo returned, what stayed and why, what was removed and why, and what NotOnQ added: built from the data. */
function Reconcile({ event }: { event?: { rows: Row[]; places: number } }) {
  if (!event?.rows.length) return null;
  const rows = event.rows.toSorted((a, b) => ORDER.indexOf(a.origin) - ORDER.indexOf(b.origin));
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <span className="text-sm font-medium">Every artist, where it came from, and whether it answers the question</span>
      <span className="text-xs text-muted-foreground">
        Each artist is checked on its own against what the question asks for (Jev, met at 60% or more).{event.places ? ` Map answers (${event.places} points) are shown in the steps above.` : ""}
      </span>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Artist</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Why</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, idx) => {
              const failed = r.scores.filter((s) => s.p < 0.6);
              const why =
                r.status === "removed"
                  ? `Misses ${failed.map((s) => `${s.kind.replace("_", " ")} ${s.value} (${pct(s.p)})`).join(", ")}`
                  : r.status === "kept"
                    ? r.scores.length
                      ? `${r.scores.every((s) => s.p >= 0.6) ? "Meets" : "Kept as Qloo returned it; scores"} ${r.scores.map((s) => `${s.kind.replace("_", " ")} (${pct(s.p)})`).join(", ")}`
                      : "Returned for the question"
                    : [r.facts?.join(" · "), r.scores.length ? r.scores.map((s) => `${s.kind.replace("_", " ")} ${pct(s.p)}`).join(", ") : ""].filter(Boolean).join(" · ");
              return (
                <TableRow key={`${r.id}-${idx}`}>
                  <TableCell className="font-medium whitespace-normal">
                    {r.link ? (
                      <a href={r.link} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                        {r.name}
                      </a>
                    ) : (
                      r.name
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <From origin={r.origin} />
                  </TableCell>
                  <TableCell>
                    {r.status === "added" ? <NotOnQBadge>added</NotOnQBadge> : <Badge variant={r.status === "kept" ? "secondary" : "outline"}>{r.status}</Badge>}
                  </TableCell>
                  <TableCell className="text-xs whitespace-normal text-muted-foreground">
                    {why}
                    {r.sources?.length ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {r.sources.map((s) =>
                          s.url ? (
                            <Badge key={s.source} asChild variant="outline" title={s.licence}>
                              <a href={s.url} target="_blank" rel="noreferrer">
                                {s.source}
                              </a>
                            </Badge>
                          ) : (
                            <Badge key={s.source} variant="outline" title={s.licence}>
                              {s.source}
                            </Badge>
                          ),
                        )}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
