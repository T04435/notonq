// Qloo's artist entity as /search and /entities return it live (keys and types only, recorded 15–23 Oct 2026; no
// response data). NotOnQ's fallback entity must fit it 1:1: same keys, same types, and anything that isn't Qloo's
// (an ID we mint, a key Qloo doesn't have) starts with "notonq:".
import { z } from "zod";

const NS = "notonq:";
const ID = z.string().refine((s) => /^[0-9A-F-]{36}$/i.test(s) || s.startsWith(NS), "a Qloo UUID or a notonq: ID");
const extId = z.strictObject({ id: z.string() });

/** Namespaces Qloo puts under properties.external for artists (research/01 §11, live samples). */
const External = z
  .object({
    facebook: extId,
    instagram: extId,
    lastfm: z.strictObject({ id: z.string(), listeners: z.number(), scrobbles: z.number().optional() }),
    musicbrainz: extId,
    spotify: extId,
    twitter: extId,
    wikidata: extId,
  })
  .partial()
  .catchall(z.unknown());

const Tag = z.strictObject({ name: z.string(), tag_id: ID.or(z.string().startsWith("urn:tag:")), type: z.string().startsWith("urn:tag:"), value: z.string() });

export const QlooArtist = z.strictObject({
  name: z.string(),
  entity_id: ID,
  types: z.tuple([z.literal("urn:entity:artist")]),
  properties: z
    .object({
      akas: z.array(z.strictObject({ value: z.string(), languages: z.array(z.string()) })),
      external: External,
      image: z.strictObject({ url: z.string().url() }).optional(),
      short_description: z.string().optional(),
      duration: z.object({}).optional(),
    })
    .catchall(z.unknown()),
  popularity: z.number().min(0).max(1).optional(),
  disambiguation: z.string().optional(),
  tags: z.array(Tag),
});

/** Keys that aren't Qloo's must be ours: "notonq:<name>". */
export function foreignKeys(entity: { properties: { external: Record<string, unknown> } & Record<string, unknown> }): string[] {
  const qlooExternal = new Set(["facebook", "instagram", "lastfm", "musicbrainz", "spotify", "twitter", "wikidata"]);
  const qlooProps = new Set(["akas", "external", "image", "short_description", "duration"]);
  return [
    ...Object.keys(entity.properties.external).filter((k) => !qlooExternal.has(k) && !k.startsWith(NS)),
    ...Object.keys(entity.properties).filter((k) => !qlooProps.has(k) && !k.startsWith(NS)),
  ];
}
