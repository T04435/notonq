// The Ledger's Requests tab: visits (calls from one app and caller close together, or one Ask question), filtered as
// the URL says, with real counts, keyset pages and a live tail. The same filter runs in SQL here and in matchVisit for
// rows pushed live.
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

export type VisitPage = { rows: Visit[]; total: number; helped: number; next?: string };

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
    sql<{ n: number }>(`SELECT count(*)::int AS n FROM visits WHERE ${[...hw, "helped > 0"].join(" AND ")}`, helpedArgs),
  ]);
  const page = rows.slice(0, limit).map(toVisit);
  const last = page.at(-1);
  return { rows: page, total: Number(c.n), helped: Number(h.n), next: rows.length > limit && last ? `${last.lastAt}~${last.id}` : undefined };
}

/** Just the counts for a view (for live updates). */
export async function countVisits(sql: Sql, p: LedgerParams): Promise<{ total: number; helped: number }> {
  const { total, helped } = await listVisits(sql, { ...p, before: undefined }, 0);
  return { total, helped };
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
export type VisitCall = Omit<Run, "events"> & { helped: boolean };

export async function visitCalls(sql: Sql, id: string): Promise<VisitCall[]> {
  const rows = await sql(`SELECT id, kind, title, summary, served_by, app_label, ms, created_at, helped FROM runs WHERE visit_id = $1 ORDER BY created_at, id`, [id]);
  return rows.map((r) => ({
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

export type LedgerSummary = {
  visits: number;
  helped: number;
  calls: number;
  apps: { app: string; calls: number; helped: number }[];
  missing: { nameKey: string; name: string; requests: number }[];
};

/** The last 24 hours, for the strip above the table, and the artists Qloo lacks that callers ask for most. */
export async function ledgerSummary(sql: Sql): Promise<LedgerSummary> {
  const [[v], apps, missing] = await Promise.all([
    sql(`SELECT count(*)::int AS visits, count(*) FILTER (WHERE helped > 0)::int AS helped, coalesce(sum(calls), 0)::int AS calls FROM visits WHERE last_at > now() - interval '24 hours'`),
    sql(
      `SELECT coalesce(app_label, 'unlabelled') AS app, count(*)::int AS calls, count(*) FILTER (WHERE helped)::int AS helped
       FROM runs WHERE created_at > now() - interval '24 hours' GROUP BY 1 ORDER BY calls DESC LIMIT 6`,
    ),
    sql(
      `SELECT r.name_key, coalesce(max(f.name), max(r.query), r.name_key) AS name, count(*)::int AS requests
       FROM requests r LEFT JOIN fallback_entities f ON f.id = r.entity_id
       WHERE r.served_by IN ('fallback', 'mixed') AND r.created_at > now() - interval '24 hours' AND (r.gap_kind IS NULL OR r.gap_kind <> 'G4')
       GROUP BY r.name_key ORDER BY requests DESC LIMIT 5`,
    ),
  ]);
  return {
    visits: Number(v.visits),
    helped: Number(v.helped),
    calls: Number(v.calls),
    apps: apps.map((a) => ({ app: String(a.app), calls: Number(a.calls), helped: Number(a.helped) })),
    missing: missing.map((m) => ({ nameKey: String(m.name_key), name: String(m.name), requests: Number(m.requests) })),
  };
}

/** What a page sends after "since", for its view: the Ledger's live update. */
export type LedgerChanges = { rows: Visit[]; total: number; helped: number; summary: LedgerSummary; artists: boolean; at: string };

/**
 * The visits that changed after a moment and match the view, with the view's fresh counts and the summary strip. A
 * paging or "as of" view gets counts only (it shows a fixed slice); the Artists tab only learns that something changed.
 */
export async function ledgerChanges(sql: Sql, p: LedgerParams, since: string): Promise<LedgerChanges> {
  const changed = await visitsChangedSince(sql, since);
  const at = changed.at(-1)?.lastAt ?? since;
  const fixed = !!p.before || !!p.at;
  const rows = p.tab === "artists" || fixed ? [] : changed.filter((v) => matchVisit(v, p));
  const [{ total, helped }, summary] = await Promise.all([countVisits(sql, { ...p, at: undefined }), ledgerSummary(sql)]);
  return { rows, total, helped, summary, artists: changed.length > 0, at };
}
