"use client";

import { PauseIcon, PlayIcon, RotateCcwIcon, SkipForwardIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { RunView } from "@/components/ask";
import { Code } from "@/components/code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AskEvent } from "@/server/agent/ask";
import type { Run, RunEvent } from "@/server/store/repo";

/** Recorded gaps are kept, but never longer than this, so a slow model step doesn't stall the replay. */
const MAX_GAP_MS = 1200;

/** A recorded run shown again step by step, with its original results and timing. Nothing is re-run. */
export function Replay({ run }: { run: Run }) {
  const steps = run.events;
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing || shown >= steps.length) return;
    const gap = shown === 0 ? 300 : Math.min(MAX_GAP_MS, Math.max(150, steps[shown].t - steps[shown - 1].t));
    const timer = setTimeout(() => setShown((s) => s + 1), gap);
    return () => clearTimeout(timer);
  }, [playing, shown, steps]);

  const done = shown >= steps.length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setPlaying((p) => !p)} disabled={done}>
          {playing && !done ? <PauseIcon /> : <PlayIcon />}
          {playing && !done ? "Pause" : "Play"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setShown(0);
            setPlaying(true);
          }}
        >
          <RotateCcwIcon />
          Replay from the start
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShown(steps.length)} disabled={done}>
          <SkipForwardIcon />
          Skip to the end
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          step {Math.min(shown, steps.length)} of {steps.length}
          {run.ms ? ` · originally took ${(run.ms / 1000).toFixed(1)} s` : ""}
        </span>
      </div>
      {run.kind === "ask" ? (
        <RunView events={steps.slice(0, shown) as unknown as AskEvent[]} running={!done} />
      ) : (
        <ApiSteps steps={steps.slice(0, shown)} />
      )}
    </div>
  );
}

function ApiSteps({ steps }: { steps: RunEvent[] }) {
  return (
    <div className="flex flex-col gap-4">
      {steps.map((s, i) =>
        s.type === "request" ? (
          <Code
            key={i}
            language="json"
            title={`Request · ${String(s.method)} ${String(s.path)} (the caller's key is never stored)`}
            code={JSON.stringify({ params: s.params, ...(s.body ? { body: s.body } : {}) }, null, 2)}
          />
        ) : (
          <div key={i} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm">
              Response <Badge variant="outline">{String(s.status)}</Badge>
              <Badge variant={s.servedBy === "qloo" ? "secondary" : "notonq"}>
                {s.servedBy === "qloo" ? "Qloo answered" : `NotOnQ: ${String(s.servedBy)}`}
              </Badge>
              <span className="text-xs text-muted-foreground">after {Math.round(s.t)} ms</span>
            </div>
            <Code
              language="json"
              title="Response (Qloo's own data redacted; long lists cut to 3)"
              code={JSON.stringify(s.body, null, 2)}
              className="max-h-[32rem] overflow-auto"
            />
          </div>
        ),
      )}
    </div>
  );
}
