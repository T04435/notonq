# Roadmap

NotOnQ is a proof of concept for a Qloo feature: when Qloo has no data, answer in Qloo's shape from open sources,
label it, cite every value, and step aside once Qloo has it. It does this for music artists.

**NotOnQ stays a pure drop-in. No new endpoints, ever, and nothing specific to one app.** Each release widens
coverage for the same Qloo requests a client already sends: when Qloo returns an empty or thin answer, or an error,
for one of the request shapes below, NotOnQ fills it in Qloo's response shape and records the gap in the Ledger.
Any Qloo client gets this by changing only its base URL, and the Ledger of gaps is the value to Qloo.

What every fill keeps from v0.2.0: Qloo's own results first and unchanged; NotOnQ's entities after them, with UUID
entity IDs, a "Not in Qloo" label in `properties.short_description` and a source on every value; stand-ins (similar
entities Qloo knows) wherever a taste answer is needed; an empty answer, never a guess, when there is no data.

Every release ships the usual way: a branch and PR, the local gates (typecheck, lint, tests, build), a Vercel
preview, then a GitHub release with notes. Versions stay `0.x`.

## Shipped

### v0.2.0 (25 Oct 2026): artists

- `GET /search` with `types=urn:entity:artist` (or no type) and `query`
- `GET /entities` with `entity_ids`
- `GET` and `POST /v2/insights` with any `filter.type` and artists in `signal.interests.entities`
- `GET /v2/analysis/compare` with artists in `a.signal.interests.entities` / `b.signal.interests.entities`

### v0.3.0 (26 Oct 2026): artists by era, genre and place

Measured 25 Oct 2026 (`src/data/era-gaps.json`): 22 of 48 decade/genre × place requests came back empty, 1 thin;
`50s` and `rock_70s` return no artists anywhere. Where Qloo answers, the place barely changes the list.

Request shapes covered (no new endpoints):

- `GET /v2/insights` with `filter.type=urn:entity:artist`, `filter.tags=urn:tag:genre:music:<decade or genre>`
  (e.g. `urn:tag:genre:music:60s`), and `signal.location.query` (or `filter.location.query`)
- The same with `filter.tags` alone, or the location alone

When Qloo's answer is empty, thin or an error:

- Measure first: a dated run of decade × genre × place requests against Qloo, recording which come back empty or
  thin (as the artist benchmark on Proof did).
- Fill `results.entities` with artists active in that decade, from that place or popular there, from open data
  (MusicBrainz begin/end dates, area and tags; Wikidata genres and country), ranked by Last.fm listeners. Artists Qloo
  knows are returned as Qloo's own entities; the rest are labelled and cited.
- The Ledger records the gap by request shape (tag, location), not only by artist.

## Next

### v0.4.0: the request shapes real apps send, for artists (built 27 Oct 2026, local)

From Busk Map, GhostQ and Front Room's own Qloo calls (plan: Qloo data through NotOnQ and Qloo's harness, no
fallbacks of their own). Still artists only, still no new endpoints:

- `GET /v2/insights`, era/genre `filter.tags` **with a taste signal** (`signal.interests.entities` or `.tags`): the
  era fill, then Qloo ranks its own artists in it for that signal (`filter.results.entities`, taste only).
- The same with the place as **coordinates**: `signal.location` / `filter.location` as `POINT(lon lat)` (with
  `.radius`) or a small `POLYGON`, placed through OpenStreetMap Nominatim, cached.
- `filter.results.entities` (the harness's `qloo_rank`) with NotOnQ artists in the list: Qloo ranks the ones it knows,
  NotOnQ's follow, unranked.
- `GET /entities` with `external.spotify.ids`: IDs Qloo lacks resolve through MusicBrainz's link to the Spotify page,
  else the name on Spotify's public oEmbed page when it is one confident artist.
- Fills carry Qloo's own music genre tags where Qloo has one by that exact name, and where the artist is from
  (`properties.notonq:home`, MusicBrainz begin area and country).
- Every artist-signalled `filter.type` (demographics, heatmap, audience, tag, place, artist, movie) is tested to reach
  Qloo through stand-ins, never with a NotOnQ ID.

### v0.4.1: a live, shareable Ledger (built 27 Oct 2026, local)

- Live by default over a WebSocket (`upgradeWebSocket` from `@vercel/functions`, a page-internal route; the drop-in API
  is untouched). One shared server-side tail per instance pushes the visits that match each viewer's filters. Pause
  holds the page still and offers "N new since you paused".
- Calls grouped into visits (same app and caller less than 2 minutes apart, or the same `X-NotOnQ-Trace`); "NotOnQ
  helped" first; real counts and pages of 50; a 24 h strip with the artists Qloo lacks that callers ask for most.
- The whole view in the URL (tab, view, app, kind, result, search, page, "as of", live, open visit): a shared link
  opens the same view. Calls where Qloo answered alone keep a one-line summary instead of the body.
- Rows animate in (none with reduced motion). Local development runs under `vc dev`.

### Later, not planned: films and TV by year and place

Out of scope for now: NotOnQ's pitch is artists (decided 26 Oct 2026). Kept for reference:

Request shapes covered (no new endpoints):

- `GET /v2/insights` with `filter.type=urn:entity:movie` or `urn:entity:tv_show`, `filter.release_year.min` /
  `filter.release_year.max`, and `signal.location.query` (or `filter.location.query`)
- `GET /search` with `types=urn:entity:movie` or `urn:entity:tv_show` and `query`
- `GET /entities` for those types

When Qloo's answer is empty, thin or an error:

- Measure Qloo's gaps for these shapes first.
- Check sources before building (licence, rate limits, non-commercial terms): Wikidata (CC0: title, year, country,
  genre, cast) and Wikipedia summaries (CC BY-SA, linked); TMDB or OMDb only if their terms allow this use.
- Fill in Qloo's shape for these types, with UUID IDs, the label and sources, as for artists.

### v0.5.0: one gap engine for every request shape

- One engine for gap detection, candidates, labels, stand-ins, cache and Ledger, keyed by request shape, instead of
  one code path per entity type.
- Docs, OpenAPI and llms.txt list every covered request shape and what NotOnQ does for each.

## Using it from an app

Any Qloo client: change the base URL to `https://notonq.vercel.app/q`, keep sending your own Qloo key as
`X-Api-Key` (never stored). To show up by name in the Ledger, put the app in the URL,
`https://notonq.vercel.app/q/app/<your-app>`, or send `X-NotOnQ-App`. For example, music-care uses
`/q/app/music-care` in production and `/q/app/music-care-dev` in development.

## Open questions

- Which open source answers "popular in this place" for films and TV without a commercial licence.
- Where "thin" starts for each request shape (fewer than N results), set from the measurement runs.
- Whether NotOnQ should ever issue its own API keys (rate limits per app). Today it uses the caller's Qloo key plus
  an app label.
