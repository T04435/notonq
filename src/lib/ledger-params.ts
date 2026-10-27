// The Ledger's whole state, in the URL: anyone opening a shared link gets the same view. Parsed the same way on the
// server (first paint) and the client (changes), and written back with only the values that differ from the defaults.
import { z } from "zod";

const list = z
  .preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : String(v).split(",")), z.array(z.string().trim().min(1).max(64)).max(12))
  .transform((a) => [...new Set(a)].sort());
const iso = z.string().datetime({ offset: true });

export const ledgerParams = z.object({
  tab: z.enum(["requests", "artists"]).catch("requests"),
  /** helped: visits where NotOnQ added or swapped data; qloo: Qloo answered alone; all. */
  view: z.enum(["helped", "qloo", "all"]).catch("helped"),
  app: list.catch([]),
  kind: z.enum(["api", "ask"]).optional().catch(undefined),
  /** Artists tab: who answered the artist's latest lookup. */
  result: z.enum(["notonq", "qloo", "choice", "none"]).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  /** Older pages: the last row shown, as "<lastAt>~<id>". */
  before: z.string().regex(/^[^~]+~.+$/).max(200).optional().catch(undefined),
  /** As of this moment: a shared paused view shows the rows as they were. */
  at: iso.optional().catch(undefined),
  live: z.preprocess((v) => v !== "0" && v !== false, z.boolean()).catch(true),
  open: z.string().max(80).optional().catch(undefined),
});

export type LedgerParams = z.infer<typeof ledgerParams>;
export const DEFAULTS: LedgerParams = ledgerParams.parse({});
export const PAGE = 50;

type Raw = Record<string, string | string[] | undefined> | URLSearchParams;

export function parseLedgerParams(raw: Raw): LedgerParams {
  const o: Record<string, string | string[]> = {};
  const set = (k: string, v: string) => (o[k] = k === "app" ? [...((o[k] as string[]) ?? []), ...v.split(",")] : v);
  if (raw instanceof URLSearchParams) raw.forEach((v, k) => set(k, v));
  else for (const [k, v] of Object.entries(raw)) for (const x of v === undefined ? [] : Array.isArray(v) ? v : [v]) set(k, x);
  return ledgerParams.parse(o);
}

/** Only what differs from the defaults, in a fixed order, so equal views give equal links. */
export function toLedgerSearch(p: Partial<LedgerParams>): string {
  const s = new URLSearchParams();
  const v = { ...DEFAULTS, ...p };
  if (v.tab !== DEFAULTS.tab) s.set("tab", v.tab);
  if (v.view !== DEFAULTS.view) s.set("view", v.view);
  if (v.app.length) s.set("app", [...new Set(v.app)].sort().join(","));
  if (v.kind) s.set("kind", v.kind);
  if (v.result) s.set("result", v.result);
  if (v.q) s.set("q", v.q);
  if (v.before) s.set("before", v.before);
  if (v.at) s.set("at", v.at);
  if (!v.live) s.set("live", "0");
  if (v.open) s.set("open", v.open);
  const q = s.toString();
  return q ? `?${q}` : "";
}

/** One Ledger row: the calls from one app and caller close together (or one Ask question). */
export type Visit = {
  id: string;
  kind: "api" | "ask";
  appLabel?: string;
  subject?: string;
  title: string;
  calls: number;
  helped: number;
  firstAt: string;
  lastAt: string;
};

/** The same filter the server applies in SQL, for rows pushed live. */
export function matchVisit(v: Visit, p: LedgerParams): boolean {
  if (p.view === "helped" && v.helped === 0) return false;
  if (p.view === "qloo" && v.helped > 0) return false;
  if (p.app.length && !p.app.includes(v.appLabel ?? "unlabelled")) return false;
  if (p.kind && v.kind !== p.kind) return false;
  if (p.q && !`${v.subject ?? ""} ${v.title}`.toLowerCase().includes(p.q.toLowerCase())) return false;
  return true;
}

export const cursorOf = (v: Pick<Visit, "lastAt" | "id">) => `${v.lastAt}~${v.id}`;
