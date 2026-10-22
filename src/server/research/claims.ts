// What the research agent may claim, and nothing else. Every claim is a value plus the page it came from and the
// exact words on that page; the verifier (plain code) decides whether it is kept. Taste numbers are not claimable.
import { z } from "zod";

/** Fields the agent may fill. Qloo fields keep Qloo's names; findings Qloo has no field for are notonq:-prefixed. */
export const CLAIM_FIELDS = [
  "properties.short_description",
  "properties.akas",
  "tags",
  "disambiguation",
  "properties.external.instagram",
  "properties.external.facebook",
  "properties.external.twitter",
  "properties.external.spotify",
  "notonq:similar",
] as const;
export type ClaimField = (typeof CLAIM_FIELDS)[number];

export const Claim = z.object({
  field: z.enum(CLAIM_FIELDS),
  value: z.string().min(1).max(400),
  source_url: z.string().url(),
  quote: z.string().min(1).max(400),
  source_date: z.string().optional(),
});
export type Claim = z.infer<typeof Claim>;

export const ClaimSet = z.object({ claims: z.array(Claim).max(30) });

export const FIELD_HELP: Record<ClaimField, string> = {
  "properties.short_description": "One or two neutral sentences saying who the artist is (genre, where from, active since). Paraphrase only what the quote says.",
  "properties.akas": "One alternative name or spelling per claim, exactly as written on the page.",
  tags: "One music genre per claim, as the page names it.",
  disambiguation: "Where the artist is from: city and/or country, as written on the page.",
  "properties.external.instagram": "The artist's own Instagram handle (no @), only from the artist's official site or a profile page that links it.",
  "properties.external.facebook": "The artist's own Facebook page name or ID.",
  "properties.external.twitter": "The artist's own X/Twitter handle (no @).",
  "properties.external.spotify": "The artist's Spotify artist ID (the 22-character code in open.spotify.com/artist/<id>).",
  "notonq:similar": "One artist name per claim that a review, label or press page compares them to (\"for fans of\", \"sounds like\", \"in the vein of\").",
};
