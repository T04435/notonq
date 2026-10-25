/** A response cut for reading and storing: lists longer than `keep` show their first items and a count. */
export function shorten(json: unknown, keep = 3): unknown {
  if (!json || typeof json !== "object") return json;
  const j = json as { results?: unknown };
  const cut = (list: unknown[]) => (list.length > keep ? [...list.slice(0, keep), `… ${list.length - keep} more`] : list);
  if (Array.isArray(j.results)) return { ...j, results: cut(j.results) };
  if (j.results && typeof j.results === "object") {
    const r = j.results as Record<string, unknown>;
    return { ...j, results: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.isArray(v) ? cut(v) : v])) };
  }
  return json;
}

const ours = (item: unknown) => {
  const d = String((item as { properties?: { short_description?: string } } | null)?.properties?.short_description ?? "");
  return d.startsWith("Not in Qloo") || d.startsWith("Picked by NotOnQ");
};

/** For the public Ledger: Qloo's own results came with the caller's key and are not ours to republish, so only NotOnQ's
 * additions are kept; each run of Qloo results becomes one line saying how many were left out. */
export function withoutQlooData(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const strip = (list: unknown[]) => {
    const out: unknown[] = [];
    let hidden = 0;
    const flush = () => {
      if (hidden) out.push(`${hidden} Qloo result${hidden === 1 ? "" : "s"} (not stored: Qloo's data stays with the caller)`);
      hidden = 0;
    };
    for (const item of list) {
      if (ours(item)) {
        flush();
        out.push(item);
      } else hidden += 1;
    }
    flush();
    return out;
  };
  const j = json as { results?: unknown; query?: unknown };
  const { query: _query, ...rest } = j;
  void _query;
  if (Array.isArray(j.results)) return { ...rest, results: strip(j.results) };
  if (j.results && typeof j.results === "object")
    return { ...rest, results: Object.fromEntries(Object.entries(j.results as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? strip(v) : v])) };
  return rest;
}

type Item = { name?: string; label?: string; location?: string; [k: string]: unknown };
type AskStep = { type?: string; column?: string; results?: Item[]; http?: { request: string; json: unknown }[]; rows?: { origin: string; name: string; link?: string }[]; text?: string; source?: string; [k: string]: unknown };

const hiddenLine = (n: number, what: string) => `${n} Qloo ${what}${n === 1 ? "" : "s"} (not stored)`;

/** A recorded Ask run, ready for the public Ledger: Qloo's own results (artists, tags, map points, its answer text) are
 * replaced by counts; NotOnQ's additions, the checks, verdicts and the request shapes stay. The live page shows it all. */
export function askRunWithoutQlooData<T extends Record<string, unknown>>(steps: T[]): T[] {
  return steps.map((raw) => {
    const s = raw as unknown as AskStep;
    if (s.type === "call") {
      const what = s.tool === "qloo_find_tags" ? "tag" : "result";
      const results: Item[] = [];
      let hidden = 0;
      const flush = () => {
        if (hidden) results.push({ name: hiddenLine(hidden, what) });
        hidden = 0;
      };
      for (const r of s.results ?? []) {
        if (r.label) {
          flush();
          results.push(r);
        } else hidden += 1;
      }
      flush();
      return { ...raw, results, http: s.http?.map((h) => ({ ...h, json: withoutQlooData(h.json) })) } as T;
    }
    if (s.type === "answer" && s.column === "qloo") return { ...raw, text: "Qloo's answer is not stored: Qloo's data stays with the caller. The steps above show how many results each call returned." } as T;
    if (s.type === "answer" && s.source === "qloo_better") return raw;
    if (s.type === "reconcile")
      return {
        ...raw,
        rows: (s.rows ?? []).map((r, i) => (r.origin.startsWith("notonq") ? r : { ...r, name: `Qloo result ${i + 1} (not stored)`, link: undefined, facts: undefined, sources: undefined })),
      } as T;
    return raw;
  });
}
