// The OpenAPI 3.1 description of NotOnQ's drop-in REST API. It documents what NotOnQ adds; the Qloo parameters
// themselves are Qloo's (https://docs.qloo.com), passed through unchanged.
const key = { type: "apiKey", in: "header", name: "X-Api-Key", description: "Your own Qloo API key, forwarded per request and never stored." } as const;

const notonqBlock = {
  type: "object",
  description: "Added beside Qloo's response when NotOnQ took part. Qloo's own fields are never changed.",
  properties: {
    served_by: { type: "string", enum: ["qloo", "fallback", "mixed", "needs_choice"] },
    gap: { type: "object", properties: { kind: { type: "string", enum: ["G1", "G2", "G4"], description: "G1: new to Qloo. G2: not yet a taste signal. G4: a short era list (artists by a music genre tag and place)." }, qloo_status: { type: "integer" }, qloo_message: { type: "string" } } },
    cache: { type: "object", properties: { hit: { type: "boolean" }, first_seen: { type: "string", format: "date-time" } } },
    demand: { type: "object", properties: { requests: { type: "integer" }, callers: { type: "integer" }, apps: { type: "integer" } } },
    proxy: {
      type: "object",
      properties: {
        replaced: { type: "array", items: { type: "string" } },
        stand_ins: {
          type: "array",
          items: { type: "object", properties: { entity_id: { type: "string" }, name: { type: "string" }, weight: { type: "number" }, source: { type: "string" } } },
        },
      },
    },
    provenance: {
      type: "object",
      description: "Field path → its sources.",
      additionalProperties: {
        type: "array",
        items: {
          type: "object",
          properties: {
            source: { type: "string" },
            record: { type: "string", format: "uri" },
            licence: { type: "string" },
            method: { type: "string", enum: ["copied", "derived", "qloo_proxy", "researched"] },
            retrievedAt: { type: "string", format: "date-time" },
            note: { type: "string" },
          },
        },
      },
    },
    popularity: { type: "object", properties: { value: { type: "number" }, n: { type: "integer" }, rmse: { type: "number" } } },
    unavailable: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "low"] },
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string", description: "Send back as notonq.candidate" },
          name: { type: "string" },
          exact: { type: "boolean" },
          inQloo: { type: "object", properties: { entityId: { type: "string" }, name: { type: "string" } } },
        },
      },
    },
    research: { type: "object", properties: { status: { type: "string", enum: ["pending", "done", "failed", "skipped", "none"] } } },
  },
} as const;

const qlooResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { type: "object", description: "Qloo's response, unchanged, plus `notonq` when NotOnQ took part.", properties: { notonq: notonqBlock } } } },
});

const common = {
  "401": { description: "No X-Api-Key." },
  "429": { description: "Your daily Qloo budget through NotOnQ is used up (resets 00:00 UTC), or Qloo's own rate limit." },
  "502": { description: "Qloo did not answer." },
};

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "NotOnQ",
    version: "0.4.0",
    description:
      "A drop-in layer in front of the Qloo API (hackathon host). Qloo answers first with your own key; an artist new to Qloo is filled in by NotOnQ from open sources, in Qloo's shape, after Qloo's results, with a source on every value. NotOnQ entity IDs are UUIDs; their properties.short_description starts \"Not in Qloo: filled by NotOnQ from open sources.\" (or \"Not in Qloo: a possible match\" for a candidate). Artists only. Works with the Qloo API; not affiliated with or endorsed by Qloo.",
    license: { name: "MIT" },
  },
  servers: [
    { url: "/q", description: "Same paths as https://hackathon.api.qloo.com" },
    { url: "/q/app/{app}", description: "The same, with your app's Ledger label in the URL (for clients that can't add headers, like the Qloo harness)", variables: { app: { default: "my-app" } } },
  ],
  security: [{ qlooKey: [] }],
  components: {
    securitySchemes: { qlooKey: key },
    parameters: {
      app: { name: "X-NotOnQ-App", in: "header", required: false, schema: { type: "string", maxLength: 64 }, description: "Your app's label in the Ledger." },
      trace: { name: "X-NotOnQ-Trace", in: "header", required: false, schema: { type: "string", maxLength: 120 }, description: "Groups your calls for one user action into one visit in the Ledger. Never sent to Qloo." },
      lastfm: { name: "X-Lastfm-Key", in: "header", required: false, schema: { type: "string" }, description: "Your own Last.fm key (optional; NotOnQ uses its own otherwise)." },
    },
    schemas: { NotOnQ: notonqBlock },
  },
  paths: {
    "/search": {
      get: {
        summary: "Search; Qloo's results first, then artists Qloo doesn't know, filled or offered as candidates",
        parameters: [
          { $ref: "#/components/parameters/app" },
          { $ref: "#/components/parameters/lastfm" },
          { name: "query", in: "query", required: true, schema: { type: "string" } },
          { name: "types", in: "query", schema: { type: "string" }, description: "NotOnQ steps in for urn:entity:artist, and for untyped searches where Qloo has nothing with that exact name; anything else passes through." },
          { name: "notonq.candidate", in: "query", schema: { type: "string" }, description: "Fill from this candidate key." },
          { name: "notonq.choose", in: "query", schema: { type: "string", enum: ["1"] }, description: "Always list the candidates." },
        ],
        responses: { "200": qlooResponse("Qloo's results, then a NotOnQ entity (served_by fallback/mixed) or one entry per candidate (needs_choice)."), "404": { description: "Nothing found by Qloo or NotOnQ." }, ...common },
      },
    },
    "/entities": {
      get: {
        summary: "Look up entities; NotOnQ's IDs (fills and offered candidates) are resolved by NotOnQ",
        parameters: [{ name: "entity_ids", in: "query", schema: { type: "string" }, description: "Comma-separated; Qloo's and NotOnQ's IDs can be mixed. A candidate's ID is filled on first use." },
          { name: "external.spotify.ids", in: "query", schema: { type: "string" }, description: "Comma-separated Spotify artist IDs. Qloo's matches first; up to 5 that Qloo lacks are looked up per request: each is matched through MusicBrainz, else by the name on Spotify's public page when it is one confident artist (notonq.spotify says how)." },
        ],
        responses: { "200": qlooResponse("Entities, with notonq blocks keyed by NotOnQ ID."), "404": { description: "None found." }, ...common },
      },
    },
    "/v2/insights": {
      get: {
        summary: "Insights; NotOnQ IDs and unusable Qloo IDs in signal.interests.entities become stand-ins; thin artist answers for a music genre tag (decade or genre) and place are filled from open data",
        parameters: [{ name: "signal.interests.entities", in: "query", schema: { type: "string" } }, { name: "filter.type", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": qlooResponse("Qloo's answer; served_by mixed when stand-ins were used; empty results when a NotOnQ artist has none."), ...common },
      },
      post: {
        summary: "The same, with Qloo's JSON body",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  "filter.type": { type: "string" },
                  "signal.interests.entities": {
                    type: "array",
                    items: { oneOf: [{ type: "string" }, { type: "object", properties: { id: { type: "string" }, weight: { type: "number" } }, required: ["id"] }] },
                  },
                },
                additionalProperties: true,
              },
            },
          },
        },
        responses: { "200": qlooResponse("Qloo's answer; weighted stand-ins keep weights scaled by their match."), "400": { description: "Body is not a JSON object, or Qloo's own 400." }, ...common },
      },
    },
    "/v2/analysis/compare": {
      get: {
        summary: "Compare two audiences; NotOnQ artists in either group become their stand-ins",
        parameters: [
          { name: "a.signal.interests.entities", in: "query", schema: { type: "string" } },
          { name: "b.signal.interests.entities", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": qlooResponse("Qloo's comparison; served_by mixed when stand-ins were used."), ...common },
      },
    },
  },
} as const;
