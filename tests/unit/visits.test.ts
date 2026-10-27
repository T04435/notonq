import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULTS, matchVisit, parseLedgerParams, toLedgerSearch } from "@/lib/ledger-params";
import { memoryDb, type Sql } from "@/server/store/db";
import { saveRun } from "@/server/store/repo";
import { SCHEMA } from "@/server/store/schema";
import { listVisits, visitCalls, visitsChangedSince } from "@/server/store/visits";

let sql: Sql;
beforeEach(async () => {
  sql = await memoryDb();
});

const call = (over: Partial<Parameters<typeof saveRun>[1]> = {}) =>
  saveRun(sql, { id: crypto.randomUUID(), kind: "api", title: "GET /q/search?query=Fcukers", servedBy: "fallback", appLabel: "ghostq", callerHash: "c1", events: [], ...over });

describe("visits", () => {
  it("groups one app's calls from one caller, less than 2 minutes apart, into one visit", async () => {
    const a = await call({ subject: "Fcukers" });
    const b = await call({ title: "GET /q/v2/insights?filter.type=urn:demographics", servedBy: "qloo" });
    expect(b).toBe(a);
    const other = await call({ callerHash: "c2" });
    expect(other).not.toBe(a);
    // A gap of more than 2 minutes starts a new visit.
    await sql(`UPDATE visits SET last_at = now() - interval '3 minutes' WHERE id = $1`, [a]);
    expect(await call()).not.toBe(a);
    const [v] = (await listVisits(sql, { ...DEFAULTS, view: "all" })).rows.filter((x) => x.id === a);
    expect(v).toMatchObject({ calls: 2, helped: 1, subject: "Fcukers", appLabel: "ghostq" });
    expect((await visitCalls(sql, a)).map((c) => c.helped)).toEqual([true, false]);
  });

  it("groups by X-NotOnQ-Trace exactly when the app sends one, and keeps every Ask question on its own", async () => {
    const t1 = await call({ trace: "song-1" });
    expect(await call({ trace: "song-1" })).toBe(t1);
    expect(await call({ trace: "song-2" })).not.toBe(t1);
    const q1 = await saveRun(sql, { id: crypto.randomUUID(), kind: "ask", title: "60s music in Lagos", servedBy: "notonq", appLabel: "ask", callerHash: "c1", events: [] });
    const q2 = await saveRun(sql, { id: crypto.randomUUID(), kind: "ask", title: "60s music in Lagos", servedBy: "qloo", appLabel: "ask", callerHash: "c1", events: [] });
    expect(q2).not.toBe(q1);
  });

  it("filters, counts and pages as the URL says", async () => {
    for (let i = 0; i < 3; i++) await call({ callerHash: `h${i}`, subject: `Act ${i}` });
    await call({ callerHash: "q", servedBy: "qloo", subject: "Taylor Swift", appLabel: "busk-map" });
    const helped = await listVisits(sql, DEFAULTS, 2);
    expect(helped).toMatchObject({ total: 3, helped: 3 });
    expect(helped.rows).toHaveLength(2);
    const older = await listVisits(sql, { ...DEFAULTS, before: helped.next }, 2);
    expect(older.rows.map((r) => r.id)).not.toContain(helped.rows[0].id);
    expect(older.rows).toHaveLength(1);
    expect((await listVisits(sql, { ...DEFAULTS, view: "qloo" })).rows.map((r) => r.subject)).toEqual(["Taylor Swift"]);
    expect((await listVisits(sql, { ...DEFAULTS, view: "all", app: ["busk-map"] })).total).toBe(1);
    expect((await listVisits(sql, { ...DEFAULTS, view: "all", q: "act 1" })).rows.map((r) => r.subject)).toEqual(["Act 1"]);
  });

  it("tails visits that changed after a moment, for the live push", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const id = await call();
    expect((await visitsChangedSince(sql, since)).map((v) => v.id)).toEqual([id]);
    expect(await visitsChangedSince(sql, new Date(Date.now() + 60_000).toISOString())).toEqual([]);
  });

  it("doesn't send the newest visit again when the page resumes from its time (ms vs µs)", async () => {
    await call();
    await sql(`UPDATE visits SET last_at = '2026-10-27T12:08:12.141523Z'`);
    expect(await visitsChangedSince(sql, "2026-10-27T12:08:12.141Z")).toEqual([]);
    expect(await visitsChangedSince(sql, "2026-10-27T12:08:12.140Z")).not.toEqual([]);
  });

  it("groups runs recorded before visits existed, once", async () => {
    const pg = await (await import("@electric-sql/pglite")).PGlite.create();
    await pg.exec(SCHEMA);
    const insert = (id: string, at: string, caller = "c", served = "qloo") =>
      pg.query(`INSERT INTO runs (id, kind, title, served_by, app_label, caller_hash, events, created_at) VALUES ($1,'api',$2,$3,'ghostq',$4,'[]',$5)`, [id, `GET /q/search?query=${id}`, served, caller, at]);
    await pg.query(`DELETE FROM visits`);
    await insert("a", "2026-10-27T01:00:00Z", "c", "fallback");
    await insert("b", "2026-10-27T01:00:30Z");
    await insert("c", "2026-10-27T01:10:00Z");
    await pg.exec(SCHEMA);
    await pg.exec(SCHEMA);
    const visits = (await pg.query<{ calls: number; helped: number; subject: string }>(`SELECT calls, helped, subject FROM visits ORDER BY first_at`)).rows;
    expect(visits).toEqual([
      { calls: 2, helped: 1, subject: "a" },
      { calls: 1, helped: 0, subject: "c" },
    ]);
  });
});

describe("the Ledger's URL", () => {
  it("round-trips every filter, writing only what differs from the defaults", () => {
    const p = parseLedgerParams(new URLSearchParams("view=all&app=ghostq,busk-map&kind=api&q=fcukers&live=0&open=v-1&tab=artists&result=notonq&at=2026-10-27T01:00:00.000Z"));
    expect(p).toMatchObject({ view: "all", app: ["busk-map", "ghostq"], kind: "api", q: "fcukers", live: false, open: "v-1", tab: "artists", result: "notonq" });
    expect(toLedgerSearch(p)).toBe("?tab=artists&view=all&app=busk-map%2Cghostq&kind=api&result=notonq&q=fcukers&at=2026-10-27T01%3A00%3A00.000Z&live=0&open=v-1");
    expect(parseLedgerParams(new URLSearchParams(toLedgerSearch(p)))).toEqual(p);
    expect(toLedgerSearch(DEFAULTS)).toBe("");
    expect(parseLedgerParams({ view: "nonsense", live: "1" })).toMatchObject({ view: "helped", live: true });
  });

  it("matches pushed rows with the same filter the server uses", () => {
    const v = { id: "v", kind: "api" as const, appLabel: "ghostq", subject: "Fcukers", title: "GET /q/search", calls: 3, helped: 1, firstAt: "", lastAt: "" };
    expect(matchVisit(v, DEFAULTS)).toBe(true);
    expect(matchVisit({ ...v, helped: 0 }, DEFAULTS)).toBe(false);
    expect(matchVisit(v, { ...DEFAULTS, app: ["busk-map"] })).toBe(false);
    expect(matchVisit(v, { ...DEFAULTS, q: "fcuk" })).toBe(true);
  });
});
