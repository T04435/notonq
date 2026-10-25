# Roadmap

NotOnQ is a proof of concept for a Qloo feature: when Qloo has no data, answer in Qloo's shape from open sources,
label it, cite every value, and step aside once Qloo has it. v0.2.0 does this for music artists. The next releases
widen it to what a real consumer app needs, starting with music-care (era-matched music for dementia care), which
uses NotOnQ as its data API with a direct-Qloo fallback whenever NotOnQ errors.

Every release ships the usual way: a branch and PR, the local gates (typecheck, lint, tests, build), a Vercel
preview, then a GitHub release with notes. Versions stay `0.x`.

## Shipped

- **v0.2.0** (25 Oct 2026): artists. Works through Qloo's own MCP server by changing one base URL. Candidates for
  ambiguous names, stand-ins for taste answers, the Ledger, Proof, docs, the Schema brand.

## Next

### v0.3.0: era and location for music (what music-care asks first)

music-care asks Qloo for music by decade and place, for example `filter.tags=urn:tag:genre:music:60s` with
`signal.location.query`.

- Measure first: run a set of decade × genre × place queries against Qloo and record which come back empty or thin,
  as the artist benchmark did (Proof).
- On an empty answer, fill the same `/v2/insights` shape from open data: artists active in that decade, from that
  place or popular there (MusicBrainz begin/end dates, area and tags; Wikidata genres and country), ranked by Last.fm
  listeners. Each result labelled "Not in Qloo" and cited.
- Where NotOnQ's artists are themselves in Qloo, return Qloo's entities (stand-ins, as today).
- Ledger and Proof count these lookups by type.

### v0.4.0: films and TV by year and location

music-care asks for films and TV shows with `filter.release_year` and location.

- Measure Qloo's gaps for `urn:entity:movie` and `urn:entity:tv_show` by year and place.
- Sources to check before building (licence, rate limits, non-commercial terms): Wikidata (CC0: title, year,
  country, genre, cast), Wikipedia summaries (CC BY-SA, linked), and TMDB or OMDb only if their terms allow this use.
- Fill `/search`, `/entities` and `/v2/insights` for these types in Qloo's shape, with UUID IDs and the label,
  exactly as for artists.

### v0.5.0: one gap engine for every type

- Share the artist machinery (gap detection, candidates, labels, stand-ins, cache, Ledger) across types instead of
  one path per type.
- Docs, OpenAPI and llms.txt list every supported type and what NotOnQ does for each.

## Consumers

| App | Uses | Ledger label |
|---|---|---|
| music-care (production) | `https://notonq.vercel.app/q/app/music-care` | `music-care` |
| music-care (development) | `https://notonq.vercel.app/q/app/music-care-dev` | `music-care-dev` |

Each app sends its own Qloo key as `X-Api-Key`; NotOnQ never stores it.

## Open questions

- Which open source answers "popular in this place" for films and TV without a commercial licence.
- Whether NotOnQ should issue its own API keys (rate limits per app) or keep using the caller's Qloo key plus an app
  label, as now.
