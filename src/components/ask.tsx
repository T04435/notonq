"use client";

import { ChevronRightIcon, CircleCheckIcon, CircleDotIcon, CircleXIcon } from "lucide-react";
import { useState } from "react";
import { NotOnQBadge } from "@/components/brand/notonq-badge";
import { Code } from "@/components/code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { AskEvent, Column, Constraint, HttpExchange, Judgement, ResultItem } from "@/server/agent/ask";

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

const SOURCE: Record<string, string> = { qloo: "Qloo's own answer", qloo_better: "Qloo, asked again", notonq: "Qloo first, then NotOnQ, labelled" };

const brief = (input: unknown) =>
  Object.entries((input ?? {}) as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" · ");

/** One question, answered by Qloo's own MCP harness twice: Qloo alone, and through NotOnQ. Every step is shown. */
export function Ask() {
  const [question, setQuestion] = useState("");
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

  const constraints = (events.find((e) => e.type === "constraints") as { constraints: Constraint[] } | undefined)?.constraints;
  const failed = events.find((e) => e.type === "error") as { message: string } | undefined;

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
          Ask both
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
      {error || failed ? <p className="text-sm text-destructive">{error ?? failed?.message}</p> : null}

      {events.length || running ? (
        <div className="grid gap-4 md:grid-cols-2">
          <ColumnCard column="qloo" title="Qloo alone" description="Qloo's own MCP harness, base URL = Qloo." events={events} running={running} />
          <ColumnCard
            column="notonq"
            title="With NotOnQ"
            description="The same harness and model. NotOnQ checks Qloo's answer first and only adds what it lacks."
            events={events}
            running={running}
            constraints={constraints}
          />
        </div>
      ) : null}
    </div>
  );
}

function ColumnCard({ column, title, description, events, running, constraints }: { column: Column; title: string; description: string; events: AskEvent[]; running: boolean; constraints?: Constraint[] }) {
  const mine = events.filter((e) => ("column" in e && e.column === column) || (column === "notonq" && e.type === "judge"));
  const answer = mine.find((e) => e.type === "answer") as { text: string; source: string } | undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
        {column === "notonq" && !mine.length ? <p className="text-sm text-muted-foreground">Waiting for Qloo&apos;s answer, which NotOnQ checks first.</p> : null}
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
        {answer ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <span className="text-xs text-muted-foreground">{SOURCE[answer.source]}</span>
            <p className="whitespace-pre-wrap text-sm">{answer.text.replace(/\*\*/g, "")}</p>
          </div>
        ) : running ? (
          <Spinner />
        ) : null}
      </CardContent>
    </Card>
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
          {call.results.slice(0, 10).map((r, i) =>
            r.label ? (
              <NotOnQBadge key={i}>{r.name ?? r.location}</NotOnQBadge>
            ) : (
              <Badge key={i} variant="secondary" title={r.description}>
                {r.name ?? r.location}
              </Badge>
            ),
          )}
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
