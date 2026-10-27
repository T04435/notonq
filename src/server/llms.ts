// llms.txt (llmstxt.org: an index for agents) and llms-full.txt (the whole reference in one markdown file, as Next.js
// publishes it). {origin} is replaced with the host serving them. Keep in step with the /docs pages and openapi.ts.

export const LLMS_TXT = `# NotOnQ

> A drop-in layer in front of the Qloo taste API (hackathon host). Qloo answers first with the caller's own key; when
> Qloo has no data for a music artist, NotOnQ returns the same shape built from open sources, with a source on every
> value, and uses similar artists Qloo does know ("stand-ins") so taste answers still come from Qloo. Artists only.
> Works with the Qloo API; not affiliated with or endorsed by Qloo.

Use it two ways: point the official Qloo MCP server at it (its base URL, nothing else changes), or call the REST API
under \`/q\` with the same paths as Qloo. Qloo's results always come first, unchanged; NotOnQ's artists are added after
them, labelled "Not in Qloo" in properties.short_description.

NotOnQ shows the behaviour, not the data pipeline: its open sources stand in for whatever Qloo would use. Built into
Qloo, the same flow would run on Qloo's own licensed sources and taste graph.

## Docs

- [Full reference for agents]({origin}/llms-full.txt): everything below in one markdown file
- [Overview and quickstart]({origin}/docs): the three ways in, gap kinds, the 1:1 shape, provenance, limits
- [REST API]({origin}/docs/rest): endpoints, headers, notonq.* parameters, the notonq block, status codes
- [MCP]({origin}/docs/mcp): the official Qloo harness pointed at NotOnQ, and what changes in each of its tools
- [OpenAPI 3.1]({origin}/openapi.json): machine-readable REST description

## Optional

- [Ledger]({origin}/ledger): every request made through NotOnQ (Ask questions and API/MCP calls), each replayable step by step; an Artists tab counts who answered each artist
- [Proof]({origin}/proof): live numbers from every lookup, and a dated benchmark run
- [Ask]({origin}/): one question; Qloo answers first through its own harness, then NotOnQ checks that answer and adds only what it lacks (every step shown)
`;

export const LLMS_FULL = `# NotOnQ: full reference

> When the Qloo API has no data for a music artist, NotOnQ returns the same shape from open sources, with a source on
> every value. Artists only, for the Qloo Agentic Hackathon 2026. Base: {origin}

## Scope

NotOnQ fills gaps for \`urn:entity:artist\` only. Requests for any other entity type, and any request Qloo can answer,
pass straight through to Qloo unchanged.

## When NotOnQ steps in

| Gap | How Qloo shows it | What NotOnQ does |
|---|---|---|
| G1 unknown | /search has no artist with the exact name | Adds a Qloo-shaped artist from open data after Qloo's results, or every artist the name could be when it is ambiguous |
| G2 not in the taste graph | /v2/insights answers 400 for the artist as a signal | Swaps it for stand-ins: similar artists Qloo knows |
| G4 thin era/genre/place answer | /v2/insights for artists by a music genre tag (and place) returns fewer than 5 artists | Adds artists from that era, genre and country after Qloo's |
| none | Qloo answers | Passes Qloo's response through unchanged |

## Quickstart

Official Qloo MCP server (@qloo/qloo-harness, unchanged). Both variables are required; the harness only sends your key
to a base URL you have marked as trusted. \`/app/my-app\` names your app in the Ledger (optional):

\`\`\`bash
QLOO_API_KEY=<your Qloo key> QLOO_BASE_URL={origin}/q/app/my-app QLOO_TRUSTED_BASE_URL={origin}/q/app/my-app qloo mcp
\`\`\`

REST (same paths and parameters as https://hackathon.api.qloo.com):

\`\`\`bash
curl -H "X-Api-Key: $QLOO_API_KEY" -H "X-NotOnQ-App: my-app" \\
  "{origin}/q/search?types=urn:entity:artist&query=sombr"
\`\`\`

MCP client config:

\`\`\`json
{ "mcpServers": { "qloo": { "command": "qloo", "args": ["mcp"],
  "env": { "QLOO_API_KEY": "<your Qloo key>", "QLOO_BASE_URL": "{origin}/q/app/my-app", "QLOO_TRUSTED_BASE_URL": "{origin}/q/app/my-app" } } } }
\`\`\`

## REST API

Headers: \`X-Api-Key\` (required, your Qloo key, never stored), \`X-NotOnQ-App\` (optional app label, up to 64
characters; or use the base URL {origin}/q/app/<label>), \`X-NotOnQ-Trace\` (optional: one ID per user action, so its calls are
one visit in the Ledger; otherwise calls less than 2 minutes apart are; never sent to Qloo), \`X-Lastfm-Key\` (optional; without
it NotOnQ uses its own).

| Endpoint | What NotOnQ does |
|---|---|
| GET /q/search (types=urn:entity:artist, or no types) | Qloo's results first, unchanged. When Qloo has no artist (untyped: nothing) with that exact name, NotOnQ adds the filled artist (served_by fallback/mixed), or every candidate as a Qloo-shaped entry (needs_choice) |
| GET /q/entities?entity_ids=… | Qloo's IDs from Qloo; NotOnQ's (fills, and offered candidates, filled on first use) from NotOnQ |
| GET /q/entities?external.spotify.ids=… | Qloo's matches first. A Spotify ID Qloo lacks: the artist MusicBrainz links to that Spotify page (Qloo's record, labelled "Matched by NotOnQ", if Qloo has its MusicBrainz ID; else NotOnQ's fill), else the name on Spotify's public page when it is one confident artist. Up to 5 per request; notonq.spotify says how each matched |
| GET /q/v2/insights | Any filter.type. NotOnQ IDs, and Qloo IDs Qloo rejects as a signal, in signal.interests.entities become stand-ins. No stand-ins: empty answer |
| GET /q/v2/insights, filter.type=urn:entity:artist with filter.tags=urn:tag:genre:music:<decade or genre> (and a place: signal.location.query / filter.location.query, or signal.location / filter.location as POINT or a small POLYGON) | When Qloo returns fewer than 5 artists or errs: artists active in that decade, in that genre, from that country (MusicBrainz; a point is placed through OpenStreetMap), after Qloo's own. Ones Qloo knows are Qloo's entities, first, by Qloo popularity; the rest labelled Not in Qloo. With a taste signal (signal.interests.entities or .tags) Qloo ranks its own artists in the fill for that signal (notonq.ranking). notonq.gap.kind G4 |
| GET /q/v2/insights with filter.results.entities (ranking a list) | NotOnQ artists in the list are kept out of Qloo's call and follow Qloo's ranking, unranked (notonq.unranked) |
| POST /q/v2/insights | Same, JSON body. signal.interests.entities may be UUID strings or {"id", "weight"} objects; weighted stand-ins keep weights scaled by their match |
| GET /q/v2/analysis/compare | NotOnQ artists in a.* or b.* signals become their stand-ins |
| anything else | Passes through unchanged, cached per key |

Parameters NotOnQ reads (never sent to Qloo):
- \`notonq.candidate=<key>\`: fill from this candidate (keys come from notonq.candidates)
- \`notonq.choose=1\`: always list the candidates

Ambiguous names: \`results\` holds Qloo's results, then one Qloo-shaped entry per candidate (UUID entity_id,
short_description "Not in Qloo: a possible match … (country, listeners, fans)"); \`notonq.served_by\` is "needs_choice"
and \`notonq.candidates\` has the details (key, name, exact, listeners, fans, country, links, inQloo). Ask the person or
choose from context, then send that entity_id to /entities or as a signal (NotOnQ fills it), or repeat the search with
\`notonq.candidate=<key>\`. A candidate flagged inQloo returns Qloo's own entity (a typo, e.g. "eminim" → Eminem).

### The notonq block

Added beside Qloo's response when NotOnQ took part:
- served_by: qloo | fallback | mixed (Qloo answered for stand-ins) | needs_choice
- gap: { kind: G1|G2, qloo_status, qloo_message }
- cache: { hit, first_seen }
- demand: { requests, callers, apps }
- proxy: { replaced: [ids], stand_ins: [{ entity_id, name, weight, source }] }
- provenance: { "<field path>": [{ source, record, licence, method, retrievedAt, note }] }
  - method: copied (from the cited record) | derived (computed, formula in note) | qloo_proxy (Qloo's answer for the
    stand-ins) | researched (found by the research agent; the exact quote was re-checked on the page by plain code)
- popularity: { value, n, rmse } (derived from the stand-ins' Qloo popularity against Last.fm listeners)
- unavailable: fields with no provable source; "(source error: …)" when a source failed
- confidence: high (MusicBrainz record) | low (Last.fm or Deezer only)
- candidates, next: for needs_choice
- research: { status: pending | done | failed | skipped | none }

### Shape

A filled artist has exactly Qloo's keys and types.
- entity_id: a UUID like Qloo's: the MusicBrainz ID, or a stable name-based UUID of the candidate (Deezer or Last.fm only)
- properties.short_description: starts "Not in Qloo: filled by NotOnQ from open sources." and names the stand-ins, then
  "From <place> (MusicBrainz)." when known, then the Wikipedia summary when there is one
- tags[]: Qloo's own music genre tag (\`urn:tag:genre:music:<genre>\`) where Qloo has one by that exact name, else
  \`notonq:urn:tag:genre:<genre>\` (type \`urn:tag:genre\`)
- properties["notonq:home"]: { name, country, country_code, source: "musicbrainz" } (where the artist is from; Qloo's
  artist records have no such field)
- properties.external["notonq:deezer"]: { id, fans }

Send a NotOnQ entity ID back as a signal anywhere Qloo takes one; NotOnQ swaps in its stand-ins.

### Status codes

200 Qloo answered, NotOnQ filled, candidates returned, or an empty taste answer (no stand-ins) · 400 bad body or Qloo's 400 · 401 no X-Api-Key · 404
nothing found · 429 the caller's daily Qloo budget through NotOnQ is used up (default 1500 real calls, cache hits
free, resets 00:00 UTC) or Qloo's own limit · 502 Qloo did not answer.

## MCP (the official Qloo harness)

NotOnQ has no MCP server of its own: run \`qloo mcp\` (@qloo/qloo-harness, unchanged) with QLOO_BASE_URL and
QLOO_TRUSTED_BASE_URL set to {origin}/q (optionally /q/app/<label>). The harness resolves names through /search (exact
name wins; several exact names → status needs_input with the candidates), looks UUIDs up through /entities, and shows
each entity's short_description, which is where NotOnQ's "Not in Qloo" label lives.

| Tool | With NotOnQ (checked live 23 Oct 2026 unless noted) |
|---|---|
| qloo_describe | An artist Qloo lacks resolves to NotOnQ's entity, labelled |
| qloo_where_popular | Heatmap of the stand-ins; status empty when there are none |
| qloo_recommend | NotOnQ artists as signals become their stand-ins |
| qloo_rank | Signals swapped; the options being ranked are left alone |
| qloo_compare_audiences | A NotOnQ artist in either group becomes its stand-ins |
| qloo_audience_demographics | Age and gender skew of the stand-ins |
| qloo_entity_tags | Tags of the stand-ins |
| qloo_trends | Passes through (Qloo has had no trend data since about May 2026); not run |
| qloo_capabilities, qloo_find_tags | Unchanged |

## Sources and licences

MusicBrainz core (CC0), Wikidata (CC0), Wikipedia summaries (CC BY-SA 4.0, linked), Wikimedia Commons images (per-file
licence, linked), Last.fm (powered by AudioScrobbler), Deezer (non-commercial use), OpenStreetMap via Nominatim (ODbL,
the place at a point), Spotify's public oEmbed (an artist's name for a Spotify ID only), Qloo (each caller's own key; no
Qloo response data is stored publicly).

## Caching, demand, research

- Fallbacks are shared (open data): filled artists refresh weekly; misses and fills with a failed source retry after a day.
- Qloo responses are cached per caller key only.
- Every request is recorded in the Ledger ({origin}/ledger) against a salted hash of the key and the app label, and can
  be replayed step by step there (recorded results, nothing re-run).

## No raw Qloo responses on NotOnQ's pages

The drop-in API returns Qloo's answer to its caller unchanged. NotOnQ's own pages (Ask, the Ledger, replays) show results
derived from Qloo (artist names, links, the agent's answer, the final table) but never raw Qloo API responses: those are
redacted on the server by type ("[redacted string]", "[redacted uuid]", "[redacted number]", "[redacted boolean]"),
keeping the shape. Qloo entity IDs (upper-case UUIDs) are removed everywhere; NotOnQ's own data is shown in full.
- Research (when the host has AI Gateway access): runs once per artist in the background after a fill with fields
  missing; the answer never waits for it; the next request gets the result.

## Inside Qloo

NotOnQ is a proof of concept for a Qloo feature. The open sources it uses (MusicBrainz, Wikidata, Wikipedia, Last.fm,
Deezer) stand in for whatever Qloo would use. Built into Qloo, the same flow would run on Qloo's own licensed sources
and taste graph: fill the gap, label it, answer taste questions through similar artists, step aside once the artist is
in the catalogue. The Ledger shows which missing artists people ask for. Artists first; the same pattern fits other
entity types.

## Limits

Artists only. No /v2/trending fallback yet. An artist with no similar artist Qloo knows has no taste answers.
`;

export const withOrigin = (text: string, origin: string) => text.replaceAll("{origin}", origin.replace(/\/+$/, ""));
