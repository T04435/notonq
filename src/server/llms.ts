// llms.txt (llmstxt.org: an index for agents) and llms-full.txt (the whole reference in one markdown file, as Next.js
// publishes it). {origin} is replaced with the host serving them. Keep in step with the /docs pages and openapi.ts.

export const LLMS_TXT = `# NotOnQ

> A drop-in layer in front of the Qloo taste API (hackathon host). Qloo answers first with the caller's own key; when
> Qloo has no data for a music artist, NotOnQ returns the same shape built from open sources, with a source on every
> value, and uses similar artists Qloo does know ("stand-ins") so taste answers still come from Qloo. Artists only.
> Works with the Qloo API; not affiliated with or endorsed by Qloo.

Use it three ways: point the official Qloo MCP server at it (two environment variables), call the REST API under
\`/q\` with the same paths as Qloo, or run \`npx notonq mcp\`. Anything NotOnQ adds is prefixed \`notonq:\`; Qloo's own
values are never changed.

## Docs

- [Full reference for agents]({origin}/llms-full.txt): everything below in one markdown file
- [Overview and quickstart]({origin}/docs): the three ways in, gap kinds, the 1:1 shape, provenance, limits
- [REST API]({origin}/docs/rest): endpoints, headers, notonq.* parameters, the notonq block, status codes
- [MCP]({origin}/docs/mcp): install, statuses, the 13 tools and what NotOnQ changes in each
- [OpenAPI 3.1]({origin}/openapi.json): machine-readable REST description

## Optional

- [Ledger]({origin}/ledger): artists developers asked for that Qloo had no data for, ranked by distinct callers
- [Proof]({origin}/proof): live numbers from every lookup, and a dated benchmark run
- [Playground]({origin}/): look up an artist and see Qloo's answer beside NotOnQ's
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
| G1 unknown | /search has no artist with the exact name | Fills a Qloo-shaped artist from open data, or returns candidates when the name is ambiguous |
| G2 not in the taste graph | /v2/insights answers 400 for the artist as a signal | Swaps it for stand-ins: similar artists Qloo knows |
| none | Qloo answers | Passes Qloo's response through unchanged |

## Quickstart

Official Qloo MCP server (no new install). Both variables are required; the harness only sends your key to a base URL
you have marked as trusted:

\`\`\`bash
QLOO_API_KEY=<your Qloo key> QLOO_BASE_URL={origin}/q QLOO_TRUSTED_BASE_URL={origin}/q qloo mcp
\`\`\`

REST (same paths and parameters as https://hackathon.api.qloo.com):

\`\`\`bash
curl -H "X-Api-Key: $QLOO_API_KEY" -H "X-NotOnQ-App: my-app" \\
  "{origin}/q/search?types=urn:entity:artist&query=sombr"
\`\`\`

MCP client config:

\`\`\`json
{ "mcpServers": { "notonq": { "command": "npx", "args": ["-y", "notonq", "mcp"],
  "env": { "QLOO_API_KEY": "<your Qloo key>", "NOTONQ_URL": "{origin}", "NOTONQ_APP": "my-app" } } } }
\`\`\`

## REST API

Headers: \`X-Api-Key\` (required, your Qloo key, never stored), \`X-NotOnQ-App\` (optional app label, up to 64
characters), \`X-Lastfm-Key\` (optional, your own Last.fm key).

| Endpoint | What NotOnQ does |
|---|---|
| GET /q/search (types=urn:entity:artist) | Qloo first. On a miss: fills the artist (served_by fallback), returns candidates (needs_choice), or Qloo's own entity when the chosen candidate is one Qloo knows |
| GET /q/entities?entity_ids=… | notonq: IDs come from NotOnQ; Qloo UUIDs from Qloo |
| GET /q/v2/insights | Any filter.type. notonq: IDs, and Qloo IDs Qloo rejects as a signal, in signal.interests.entities become stand-ins |
| POST /q/v2/insights | Same, JSON body. signal.interests.entities may be UUID strings or {"id", "weight"} objects; weighted stand-ins keep weights scaled by their match |
| anything else | Passes through unchanged, cached per key |

Parameters NotOnQ reads (never sent to Qloo):
- \`notonq.candidate=<key>\`: fill from this candidate (keys come from notonq.candidates)
- \`notonq.choose=1\`: always list the candidates

Ambiguous names: the response is Qloo's own results plus \`notonq.served_by: "needs_choice"\` and \`notonq.candidates\`
(key, name, exact, listeners, fans, country, links, inQloo). Ask the person or choose from context, then repeat the
request with \`notonq.candidate=<key>\`. A candidate flagged inQloo returns Qloo's own entity (a typo, e.g. "eminim" →
Eminem).

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

A filled artist has exactly Qloo's keys and types. NotOnQ's own values and keys are prefixed \`notonq:\`:
- entity_id: \`notonq:mbid:<uuid>\` (MusicBrainz), \`notonq:dz:<id>\` (Deezer), \`notonq:lf:<slug>\` (Last.fm)
- tags[].tag_id: \`notonq:urn:tag:genre:<genre>\` (type \`urn:tag:genre\`)
- properties.external["notonq:deezer"]: { id, fans }

Send a notonq: entity ID back as a signal anywhere Qloo takes one; NotOnQ swaps in its stand-ins.

### Status codes

200 Qloo answered, NotOnQ filled, or candidates returned · 400 bad body or Qloo's 400 · 401 no X-Api-Key · 404
nothing found · 429 the caller's daily Qloo budget through NotOnQ is used up (default 1500 real calls, cache hits
free, resets 00:00 UTC) or Qloo's own limit · 502 Qloo did not answer.

## MCP (npx notonq mcp)

Runs the official @qloo/qloo-harness unchanged behind a loopback proxy. Same tools, names and result envelope.
Environment: QLOO_API_KEY (required), NOTONQ_URL, NOTONQ_APP, LASTFM_API_KEY (optional). Node 22.19+.

Statuses NotOnQ adds:
- partial: some of the result is NotOnQ's (a filled artist or Qloo's answer for stand-ins); a warning names the stand-ins
- needs_input: the artist name is ambiguous; notonq_candidates lists options; call notonq_fill with one key

| Tool | With NotOnQ |
|---|---|
| qloo_describe | An artist Qloo lacks comes back filled (partial), or needs_input with candidates |
| qloo_recommend | Signals Qloo can't use become stand-ins (partial); exact names Qloo knows are passed as Qloo IDs |
| qloo_rank | Signals swapped; the options being ranked are left alone |
| qloo_compare_audiences | group_a and group_b swapped like signals |
| qloo_where_popular | Heatmap of the stand-ins, labelled partial |
| qloo_audience_demographics | Age and gender skew of the stand-ins, labelled partial |
| qloo_entity_tags | Tags of the stand-ins, labelled partial |
| qloo_trends | Passes through (Qloo has had no trend data since about May 2026) |
| qloo_capabilities, qloo_find_tags | Unchanged |
| notonq_candidates {name} | Every artist a name could be (MusicBrainz, Last.fm, Deezer), flagged when Qloo knows one |
| notonq_fill {name, candidate} | Fill from one candidate: a Qloo-shaped entity with a notonq: ID, usable as a signal |
| notonq_provenance {id} | Source, record, licence and method for every value, plus stand-ins |

## Sources and licences

MusicBrainz core (CC0), Wikidata (CC0), Wikipedia summaries (CC BY-SA 4.0, linked), Wikimedia Commons images (per-file
licence, linked), Last.fm (powered by AudioScrobbler), Deezer (non-commercial use), Qloo (each caller's own key; no
Qloo response data is stored publicly).

## Caching, demand, research

- Fallbacks are shared (open data): filled artists refresh weekly; misses and fills with a failed source retry after a day.
- Qloo responses are cached per caller key only.
- Every gap request counts towards the Ledger ({origin}/ledger) against a salted hash of the key and the app label.
- Research (when the host has AI Gateway access): runs once per artist in the background after a fill with fields
  missing; the answer never waits for it; the next request gets the result.

## Limits

Artists only. No /v2/trending fallback yet. /v2/analysis/compare over REST passes through (through MCP the groups are
swapped).
`;

export const withOrigin = (text: string, origin: string) => text.replaceAll("{origin}", origin.replace(/\/+$/, ""));
