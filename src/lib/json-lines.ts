// A response printed as JSON lines, each marked as NotOnQ's or Qloo's, so our pages can show what NotOnQ added apart
// from Qloo's data. What is NotOnQ's is read from the response itself: the notonq block, any notonq:-prefixed key,
// entities NotOnQ filled or offered ("Not in Qloo…"), tags with a notonq: ID, and the label NotOnQ puts on a Qloo
// record it matched ("Matched by NotOnQ…"). Everything else is Qloo's.

export type JsonLine = { text: string; ours: boolean };

const OUR_LABEL = /^(Not in Qloo|Matched by NotOnQ)/;

function isOurs(key: string | undefined, v: unknown): boolean {
  if (key === "notonq" || key?.startsWith("notonq:")) return true;
  if (typeof v === "string") return OUR_LABEL.test(v);
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as { properties?: { short_description?: unknown }; tag_id?: unknown };
  return (typeof o.properties?.short_description === "string" && o.properties.short_description.startsWith("Not in Qloo")) || (typeof o.tag_id === "string" && o.tag_id.startsWith("notonq:"));
}

function emit(out: JsonLine[], v: unknown, depth: number, key: string | undefined, parentOurs: boolean, comma: string) {
  const pad = "  ".repeat(depth);
  const label = key === undefined ? "" : `${JSON.stringify(key)}: `;
  const ours = parentOurs || isOurs(key, v);
  if (v && typeof v === "object") {
    const entries: [string | undefined, unknown][] = Array.isArray(v) ? v.map((x) => [undefined, x]) : Object.entries(v).filter(([, x]) => x !== undefined);
    const [open, close] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
    if (!entries.length) {
      out.push({ text: `${pad}${label}${open}${close}${comma}`, ours });
      return;
    }
    out.push({ text: `${pad}${label}${open}`, ours });
    entries.forEach(([k, x], i) => emit(out, x, depth + 1, k, ours, i < entries.length - 1 ? "," : ""));
    out.push({ text: `${pad}${close}${comma}`, ours });
    return;
  }
  out.push({ text: `${pad}${label}${JSON.stringify(v ?? null)}${comma}`, ours });
}

/** The value as JSON.stringify(v, null, 2) prints it, line by line, each marked ours or Qloo's. */
export function jsonLines(value: unknown): JsonLine[] {
  const out: JsonLine[] = [];
  emit(out, value, 0, undefined, false, "");
  return out;
}
