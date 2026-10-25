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
