"use client";

import { createRealtimeClient, type LiveQueryState, QueryRefreshController, type SealedLiveQuery } from "@neon/realtime/client";
import { useEffect, useRef, useState } from "react";
import { type LedgerParams, toLedgerSearch } from "@/lib/ledger-params";
import type { LatestChange } from "@/server/realtime";
import type { LedgerChanges } from "@/server/store/visits";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "unavailable";

type Capability = { url: string; query: SealedLiveQuery<LatestChange> };

async function capability(): Promise<Capability | null> {
  const res = await fetch("/api/ledger/live", { cache: "no-store" });
  return res.status === 200 ? ((await res.json()) as Capability) : null;
}

/**
 * The Ledger's live updates. The page subscribes through Neon Realtime to the newest visit change (renewing the 60 s
 * capability before it expires); each time Neon pushes a change, it asks /api/ledger/changes for what changed since
 * its last answer, for its current view, so nothing is missed or repeated across reconnects. Nothing polls. Where
 * Realtime isn't set up it reports "unavailable" and the page keeps what it rendered.
 */
export function useLive(params: LedgerParams, renderedAt: string, onChanges: (c: LedgerChanges) => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const since = useRef(renderedAt);
  const view = useRef(params);
  const handler = useRef(onChanges);
  useEffect(() => {
    handler.current = onChanges;
    view.current = params;
  });

  // A new render (filters changed, or "Show" applied) moves the resume point to that render.
  useEffect(() => {
    since.current = renderedAt;
  }, [renderedAt]);

  useEffect(() => {
    let closed = false;
    let busy = false;
    let again = false;
    // One request at a time; a push that arrives meanwhile asks once more after it.
    const pull = async () => {
      if (busy) return void (again = true);
      busy = true;
      try {
        do {
          again = false;
          const search = toLedgerSearch(view.current);
          const res = await fetch(`/api/ledger/changes${search ? `${search}&` : "?"}since=${encodeURIComponent(since.current)}`, { cache: "no-store" });
          if (!res.ok || closed) break;
          const c = (await res.json()) as LedgerChanges;
          since.current = c.at > since.current ? c.at : since.current;
          handler.current(c);
        } while (again && !closed);
      } finally {
        busy = false;
      }
    };

    let stop = () => {};
    capability()
      .then((cap) => {
        if (closed) return;
        if (!cap) return setStatus("unavailable");
        const client = createRealtimeClient({ url: cap.url });
        const sub = client.subscribe(cap.query);
        const refresh = new QueryRefreshController({
          query: cap.query,
          refreshQuery: async () => (await capability())?.query ?? Promise.reject(new Error("Realtime isn't set up")),
          renewSubscription: (q) => sub.renew(q),
          onRefreshExhausted: () => setStatus("unavailable"),
          subscription: sub,
        });
        refresh.start();
        const show = (s: LiveQueryState) => setStatus(s.status === "live" ? "live" : s.status === "error" || s.status === "closed" ? "unavailable" : "reconnecting");
        const offState = sub.onStateChange(show);
        // The first result and every change after it: catch up on what changed since the render or the last answer.
        // A result arriving means the subscription is live, even if its state event came first.
        const offUpdate = sub.onUpdate(() => {
          setStatus("live");
          void pull();
        });
        stop = () => {
          offState();
          offUpdate();
          refresh.stop();
          sub.unsubscribe();
          client.close();
        };
      })
      .catch(() => !closed && setStatus("unavailable"));
    return () => {
      closed = true;
      stop();
    };
  }, []);

  return status;
}

/** A number that counts to its new value instead of jumping (instantly with reduced motion). */
export function useTween(value: number, ms = 400) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setShown(Math.round(a + (value - a) * (1 - (1 - k) ** 3)));
      if (k < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}
