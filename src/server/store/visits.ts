// The Ledger's visits list: visits (calls from one app and caller close together, or one Ask question), filtered as
// the URL says, with real counts, keyset pages and a live tail. The same filter runs in SQL here and in matchVisit for
// rows pushed live.
import { callDetail, callName } from "@/lib/call-label";
import { type LedgerParams, matchVisit, PAGE, type Visit } from "@/lib/ledger-params";
import type { Sql } from "@/server/store/db";
import type { Run } from "@/server/store/repo";

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export const toVisit = (r: Row): Visit => ({
  id: String(r.id),
  kind: r.kind as Visit["kind"],
  appLabel: (r.app_label as string) ?? undefined,
  subject: (r.subject as string) ?? undefined,
  title: String(r.title),
  calls: Number(r.calls),
  helped: Number(r.helped),
  firstAt: iso(r.first_at),
  lastAt: iso(r.last_at),
});

type Filters = Pick<LedgerParams, "view" | "app" | "kind" | "q" | "at">;

function where(f: Filters, args: unknown[]) {
  const arg = (v: unknown) => `$${args.push(v)}`;
  const w: string[] = [];
  if (f.view === "helped") w.push("helped > 0");
  if (f.view === "qloo") w.push("helped = 0");
  if (f.app.length) w.push(`coalesce(app_label, 'unlabelled') = ANY(${arg(f.app)}::text[])`);
  if (f.kind) w.push(`kind = ${arg(f.kind)}`);
  if (f.q) w.push(`(coalesce(subject, '') || ' ' || title) ILIKE ${arg(`%${f.q}%`)}`);
  if (f.at) w.push(`first_at <= ${arg(f.at)}::timestamptz`);
  return w;
}

/** total: visits in this view; helped: where we filled in; all: every visit (same filters, any view). */
export type VisitPage = { rows: Visit[]; total: number; helped: number; all: number; next?: string };

/** One page of visits, newest activity first, and the counts for the same filters (before paging). */
export async function listVisits(sql: Sql, p: LedgerParams, limit = PAGE): Promise<VisitPage> {
  const args: unknown[] = [];
  const w = where(p, args);
  const countWhere = w.length ? `WHERE ${w.join(" AND ")}` : "";
  const countArgs = [...args];
  // helped is counted on the same filters, minus the view, so "612 where NotOnQ helped" holds on every view.
  const helpedArgs: unknown[] = [];
  const hw = where({ ...p, view: "all" }, helpedArgs);
  if (p.before) {
    const [at, id] = p.before.split("~");
    w.push(`(last_at, id) < ($${args.push(at)}::timestamptz, $${args.push(id)})`);
  }
  const [rows, [c], [h]] = await Promise.all([
    sql(`SELECT * FROM visits ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY last_at DESC, id DESC LIMIT ${limit + 1}`, args),
    sql<{ n: number }>(`SELECT count(*)::int AS n FROM visits ${countWhere}`, countArgs),
    sql<{ n: number; all: number }>(`SELECT count(*) FILTER (WHERE helped > 0)::int AS n, count(*)::int AS all FROM visits ${hw.length ? `WHERE ${hw.join(" AND ")}` : ""}`, helpedArgs),
  ]);
  const page = rows.slice(0, limit).map(toVisit);
  const last = page.at(-1);
  return { rows: page, total: Number(c.n), helped: Number(h.n), all: Number(h.all), next: rows.length > limit && last ? `${last.lastAt}~${last.id}` : undefined };
}

/** Just the counts for a view (for live updates). */
export async function countVisits(sql: Sql, p: LedgerParams): Promise<{ total: number; helped: number; all: number }> {
  const { total, helped, all } = await listVisits(sql, { ...p, before: undefined }, 0);
  return { total, helped, all };
}

/** Visits that changed after a moment (new, or a new call in one), oldest change first: the live tail. Compared at
 * millisecond precision, the precision of the ISO times pages send back, or the newest visit would come back again. */
export async function visitsChangedSince(sql: Sql, since: string, limit = 200): Promise<Visit[]> {
  return (await sql(`SELECT * FROM visits WHERE date_trunc('milliseconds', last_at) > $1::timestamptz ORDER BY last_at ASC LIMIT ${limit}`, [since])).map(toVisit);
}

export async function latestChange(sql: Sql): Promise<string> {
  const [r] = await sql(`SELECT coalesce(max(last_at), now()) AS t FROM visits`);
  return iso(r.t);
}

/** The calls in one visit, oldest first (events left out: each call opens on its own replay page). */
/** A call in a visit, with its plain-words name and what came back (lib/call-label). */
export type VisitCall = Omit<Run, "events"> & { helped: boolean; name: string; detail: string };

export async function visitCalls(sql: Sql, id: string): Promise<VisitCall[]> {
  const rows = await sql(
    `SELECT id, kind, title, summary, served_by, app_label, ms, created_at, helped,
            (events->1->>'status')::int AS status, events->1->'body'->>'note' AS note, events->1->'body'->'notonq' AS notonq
     FROM runs WHERE visit_id = $1 ORDER BY created_at, id`,
    [id],
  );
  return rows.map((r) => ({
    name: r.kind === "ask" ? "ask" : callName(String(r.title)),
    detail: r.kind === "ask" ? String(r.summary ?? "") : callDetail((r.served_by as string) ?? undefined, r.status === null ? undefined : Number(r.status), (r.note as string) ?? undefined, typeof r.notonq === "string" ? JSON.parse(r.notonq) : (r.notonq as never)),
    id: String(r.id),
    kind: r.kind as Run["kind"],
    title: String(r.title),
    summary: (r.summary as string) ?? undefined,
    servedBy: (r.served_by as string) ?? undefined,
    appLabel: (r.app_label as string) ?? undefined,
    ms: r.ms === null || r.ms === undefined ? undefined : Number(r.ms),
    createdAt: iso(r.created_at),
    helped: Boolean(r.helped),
  }));
}

/** The apps seen in the Ledger, busiest first: the app filter's options. */
export async function ledgerApps(sql: Sql, limit = 12): Promise<string[]> {
  const rows = await sql(`SELECT coalesce(app_label, 'unlabelled') AS app, count(*)::int AS n FROM visits GROUP BY 1 ORDER BY n DESC, app LIMIT ${limit}`);
  return rows.map((r) => String(r.app));
}

/** What a page sends after "since", for its view: the Ledger's live update. */
export type LedgerChanges = { rows: Visit[]; total: number; helped: number; all: number; artists: boolean; at: string };

/**
 * The visits that changed after a moment and match the view, with the view's fresh counts. A paging or "as of" view
 * gets counts only (it shows a fixed slice). `artists` says something changed, so an open artists panel can refresh.
 */
export async function ledgerChanges(sql: Sql, p: LedgerParams, since: string): Promise<LedgerChanges> {
  const changed = await visitsChangedSince(sql, since);
  const at = changed.at(-1)?.lastAt ?? since;
  const fixed = !!p.before || !!p.at;
  const rows = fixed ? [] : changed.filter((v) => matchVisit(v, p));
  const { total, helped, all } = await countVisits(sql, { ...p, at: undefined });
  return { rows, total, helped, all, artists: changed.length > 0, at };
}
