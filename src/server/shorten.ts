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

