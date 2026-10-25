// Qloo's own data never reaches our pages (Ask, the Ledger and its replays): it is redacted on the server, before
// anything is sent to a browser or stored for replay. Each Qloo value becomes "[redacted <type>]", keeping the shape so
// a reader still sees what Qloo returned and how much. NotOnQ's own data is shown in full.
//
// What counts as Qloo's: entities without NotOnQ's label, tags, map points, Qloo's answer text, and Qloo entity IDs.
// Qloo writes its IDs as upper-case UUIDs; NotOnQ's IDs (MusicBrainz IDs and its own name-based UUIDs) are lower case.
// The drop-in API itself is untouched: a caller gets Qloo's answer for their own key, as from Qloo.

const QLOO_UUID = /\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\b/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REDACTED = {
  string: "[redacted string]",
  uuid: "[redacted uuid]",
  number: "[redacted number]",
  boolean: "[redacted boolean]",
} as const;

/** Every value replaced by its type: the shape stays, the data goes. */
export function redactValue(v: unknown): unknown {
  if (typeof v === "string") return UUID.test(v) ? REDACTED.uuid : REDACTED.string;
  if (typeof v === "number") return REDACTED.number;
  if (typeof v === "boolean") return REDACTED.boolean;
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactValue(x)]));
  return v;
}

/** Qloo entity IDs inside NotOnQ's own data (stand-ins, provenance keys) and tool inputs. */
export function redactQlooIds<T>(v: T): T {
  if (typeof v === "string") return v.replace(QLOO_UUID, REDACTED.uuid) as T;
  if (Array.isArray(v)) return v.map(redactQlooIds) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(QLOO_UUID, REDACTED.uuid), redactQlooIds(x)])) as T;
  return v;
}

type Entity = { name?: unknown; entity_id?: unknown; properties?: { short_description?: unknown; [k: string]: unknown }; [k: string]: unknown };

const label = (e: unknown) => String((e as Entity | null)?.properties?.short_description ?? "");

/** NotOnQ's label, without the Qloo description that follows it on a Qloo record NotOnQ picked (see rest.ts eraAnswer). */
export function ourLabelPart(description: string) {
  const m = /^(Picked by NotOnQ:.*?record(?: \(MusicBrainz: [^)]*\))?\.(?: Ranked by Qloo for this request's taste signal\.)?)( Qloo has \d+ artists for this tag as a taste signal \(signal\.interests\.tags\)\.)?/.exec(description);
  return m ? `${m[1]}${m[2] ?? ""}` : description;
}

/** One entity in a response: NotOnQ's fill in full; a Qloo record NotOnQ picked keeps its name (MusicBrainz's) and
 * NotOnQ's label; anything else is Qloo's and is redacted. */
export function redactEntity(e: unknown): unknown {
  const d = label(e);
  if (d.startsWith("Not in Qloo")) return e;
  if (d.startsWith("Picked by NotOnQ")) {
    const x = redactValue(e) as Entity;
    return { ...x, name: (e as Entity).name, properties: { ...(x.properties ?? {}), short_description: ourLabelPart(d) } };
  }
  return redactValue(e);
}

/** A Qloo-shaped response body: results through redactEntity, Qloo's query echo redacted, NotOnQ's block kept with
 * Qloo IDs removed. */
export function redactBody(json: unknown): unknown {
  if (!json || typeof json !== "object" || Array.isArray(json)) return redactValue(json);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (k === "notonq") out[k] = redactQlooIds(v);
    else if (k === "results")
      out[k] = Array.isArray(v)
        ? v.map(redactEntity)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([rk, rv]) => [rk, Array.isArray(rv) ? rv.map(redactEntity) : redactValue(rv)]))
          : redactValue(v);
    else out[k] = redactValue(v);
  }
  return out;
}
