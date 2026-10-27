"use client";

import { useEffect, useRef, useState } from "react";
import type { LedgerParams } from "@/lib/ledger-params";
import type { ServerMessage } from "@/server/ledger-hub";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "unavailable";

/**
 * The Ledger's WebSocket. One connection for the page's life: it subscribes with the view's filters and the moment the
 * page was rendered, re-subscribes (without reconnecting) when the filters change, and reconnects with backoff (1 s up
 * to 30 s) when the server closes it (Vercel ends a socket at the function's max duration), resuming from the last
 * message so nothing is missed or repeated. After 4 failed tries in a row it reports "unavailable" (for example under
 * `next dev`, which can't upgrade sockets; use `vc dev`).
 */
export function useLive(params: LedgerParams, renderedAt: string, onMessage: (m: ServerMessage) => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const ws = useRef<WebSocket | null>(null);
  const since = useRef(renderedAt);
  const sub = useRef(params);
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  });

  // A new render (filters changed, or "Show" applied) moves the resume point to that render.
  useEffect(() => {
    since.current = renderedAt;
  }, [renderedAt]);

  useEffect(() => {
    sub.current = params;
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: "subscribe", params, since: since.current }));
  }, [params]);

  useEffect(() => {
    let closed = false;
    let delay = 1000;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ledger/live`);
      ws.current = socket;
      socket.addEventListener("open", () => {
        delay = 1000;
        failures = 0;
        setStatus("live");
        socket.send(JSON.stringify({ type: "subscribe", params: sub.current, since: since.current }));
      });
      socket.addEventListener("message", (e) => {
        const m = JSON.parse(String(e.data)) as ServerMessage;
        if ("at" in m && m.type !== "ping" && m.type !== "hello") since.current = m.at;
        handler.current(m);
      });
      socket.addEventListener("close", () => {
        if (closed) return;
        failures++;
        setStatus(failures >= 4 ? "unavailable" : "reconnecting");
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      });
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws.current?.close();
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
