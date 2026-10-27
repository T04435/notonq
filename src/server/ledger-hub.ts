// The live Ledger, server side. Each WebSocket on this instance says what it is looking at (the Ledger's URL state)
// and from when; one shared tail per instance reads the visits that changed since its last look, about once a second
// and only while a socket is open, and pushes each socket the ones that match its filters, with fresh counts.
// Instances share no memory, so the database is the meeting point: a call recorded on any instance reaches every
// socket. Load grows with instances, not viewers. (Redis pub/sub could replace the tail later; the page wouldn't change.)
import type { WebSocket } from "ws";
import { type LedgerParams, ledgerParams, matchVisit, type Visit } from "@/lib/ledger-params";
import { db } from "@/server/store/db";
import { countVisits, latestChange, ledgerSummary, visitsChangedSince } from "@/server/store/visits";

export type ServerMessage =
  | { type: "hello"; at: string }
  | { type: "visits"; rows: Visit[]; total: number; helped: number; at: string }
  | { type: "artists"; at: string }
  | { type: "summary"; summary: Awaited<ReturnType<typeof ledgerSummary>> }
  | { type: "ping"; at: string };

export type ClientMessage = { type: "subscribe"; params: unknown; since?: string };

type Sub = { params: LedgerParams; since: string };
type Hub = { subs: Map<WebSocket, Sub | null>; cursor?: string; timer?: ReturnType<typeof setInterval>; busy: boolean; pings?: ReturnType<typeof setInterval> };

const TICK_MS = 1000;
const PING_MS = 20_000;
const shared = globalThis as typeof globalThis & { __notonqLedgerHub?: Hub };
const hub: Hub = (shared.__notonqLedgerHub ??= { subs: new Map(), busy: false } as Hub);

const send = (ws: WebSocket, m: ServerMessage) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
};

/** Rows that match a socket's filters, with its counts. A paging or "as of" view gets no rows (it shows a fixed slice). */
async function pushTo(ws: WebSocket, sub: Sub, changed: Visit[], at: string) {
  const sql = await db();
  if (sub.params.tab === "artists") {
    if (changed.length) send(ws, { type: "artists", at });
    return;
  }
  const rows = changed.filter((v) => v.lastAt > sub.since && matchVisit(v, sub.params));
  const fixed = !!sub.params.before || !!sub.params.at;
  if (!rows.length && !fixed) return;
  const { total, helped } = await countVisits(sql, { ...sub.params, at: undefined });
  send(ws, { type: "visits", rows, total, helped, at });
  sub.since = at;
}

async function tick() {
  if (hub.busy) return;
  hub.busy = true;
  try {
    const sql = await db();
    hub.cursor ??= await latestChange(sql);
    const changed = await visitsChangedSince(sql, hub.cursor);
    if (!changed.length) return;
    const at = changed.at(-1)!.lastAt;
    hub.cursor = at;
    const summary = await ledgerSummary(sql);
    await Promise.all(
      [...hub.subs].map(async ([ws, sub]) => {
        if (!sub) return;
        await pushTo(ws, sub, changed, at);
        send(ws, { type: "summary", summary });
      }),
    );
  } catch (e) {
    console.error("ledger tail failed", e instanceof Error ? e.stack : e);
  } finally {
    hub.busy = false;
  }
}

function start() {
  hub.timer ??= setInterval(tick, TICK_MS);
  hub.pings ??= setInterval(() => {
    const at = new Date().toISOString();
    for (const ws of hub.subs.keys()) send(ws, { type: "ping", at });
  }, PING_MS);
}

// A reloaded module (dev) replaces the timers, so the tail always runs the current code.
if (hub.timer) {
  clearInterval(hub.timer);
  clearInterval(hub.pings);
  hub.timer = hub.pings = undefined;
  if (hub.subs.size) start();
}

function stopIfIdle() {
  if (hub.subs.size) return;
  clearInterval(hub.timer);
  clearInterval(hub.pings);
  hub.timer = hub.pings = hub.cursor = undefined;
}

/** A new socket: it subscribes (and re-subscribes when its filters change) with the moment its page was rendered,
 * gets what changed since then right away, then live updates. */
export function join(ws: WebSocket) {
  hub.subs.set(ws, null);
  start();
  ws.on("message", async (data) => {
    let m: ClientMessage;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    if (m.type !== "subscribe") return;
    const params = ledgerParams.parse(m.params ?? {});
    const sql = await db();
    const now = await latestChange(sql);
    const since = typeof m.since === "string" && !Number.isNaN(Date.parse(m.since)) ? new Date(m.since).toISOString() : now;
    const sub: Sub = { params, since };
    hub.subs.set(ws, sub);
    send(ws, { type: "hello", at: now });
    // Catch up on anything recorded between the page render (or the last message before a reconnect) and now.
    if (since < now) await pushTo(ws, sub, await visitsChangedSince(sql, since), now);
  });
  ws.on("close", () => {
    hub.subs.delete(ws);
    stopIfIdle();
  });
  ws.on("error", () => ws.close());
}
