# NotOnQ

When the [Qloo](https://qloo.com) taste API has no data for an artist, NotOnQ returns the same shape from open sources,
with a source on every value. It caches the answer and counts how often each missing artist is asked for, so the gaps
developers actually hit can be ranked for import.

Built for the Qloo Agentic Hackathon 2026. Works with the Qloo API; not affiliated with or endorsed by Qloo.

> **Scope: artists only.** For the hackathon, NotOnQ fills gaps for music artists (`urn:entity:artist`), where the gap
> is measured. Every other entity type, and every request Qloo can answer, passes straight through to Qloo unchanged.

## What it proves

From one measured run ([`/proof`](src/app/proof/page.tsx), `scripts/proof.mts`):

- **63%** of artists with a release in the last 14 days are unknown to Qloo or unusable as a taste signal, compared with **4%** of chart artists.
- NotOnQ builds a **sourced entity for 100%** of those gaps, and finds **stand-ins Qloo can answer for in 80%**.
- Using stand-ins alone recovers **37%** of Qloo's own top-20 "fans also like" for artists Qloo does know (29% of the top 10).

## Two ways in

1. **Ask** (`/`): a question run through Qloo's own MCP harness, straight to Qloo first; NotOnQ then checks that answer, asks Qloo again if it falls short, and only then adds open data. It ends with a table of every artist: where it came from, kept or removed and why, and what NotOnQ added, with sources.
2. **Drop-in REST and MCP** (`/q/*`): the same paths and parameters as the Qloo API, with your own `X-Api-Key`.
   Qloo's results come first, unchanged; NotOnQ's artists are added after them in exactly Qloo's shape, with UUID IDs
   and a "Not in Qloo" label in `short_description`. For MCP, run the official Qloo harness unchanged:
   `QLOO_BASE_URL=https://<host>/q/app/my-app QLOO_TRUSTED_BASE_URL=https://<host>/q/app/my-app qloo mcp`.

Docs live at `/docs` (REST and MCP reference), `/openapi.json`, and for agents `/llms.txt` and `/llms-full.txt`.

## Inside Qloo

NotOnQ is a proof of concept for a feature Qloo could build in. It shows the behaviour, not the data pipeline: the open
sources here stand in for whatever Qloo would use. Built into Qloo, the same flow would run on Qloo's own licensed
sources and taste graph: fill the gap, label it, answer taste questions through similar artists, and step aside once
the artist is in the catalogue. The Ledger shows which missing artists people actually ask for. Artists first, for this
hackathon; the same pattern fits other entity types.

## No raw Qloo responses on our pages

The drop-in API returns Qloo's answer to its caller unchanged. NotOnQ's own pages (Ask, the Ledger, replays) show results
derived from Qloo, such as artist names, but never Qloo's raw API responses: those are redacted on the server by type
(`[redacted string]`, `[redacted uuid]`…) before anything reaches a browser or is stored. NotOnQ's own data is shown in full.

## How it fills a gap

1. **Qloo first.** If Qloo knows the artist, its response passes through untouched.
2. **Who could it be?** MusicBrainz, Last.fm and Deezer matches are merged. Only one confident exact MusicBrainz match
   continues by itself; otherwise every candidate is listed and you choose one by its ID.
3. **Open data** for facts: MusicBrainz, Wikidata, Wikipedia, Last.fm, Deezer.
4. **Stand-ins:** similar artists Qloo *does* know become the taste signal, so affinities, heatmaps and demographics
   still come from Qloo, labelled as coming from the stand-ins.
5. **Research (tier 3):** for what's still missing, a web research agent returns claims with a URL and an exact quote.
   Plain code re-fetches every page and keeps only quotes it finds there.
6. **Cache, demand and replay:** every answer is cached, and every request is recorded in the Ledger (`/ledger`), replayable step by step; its Artists tab is a ranked list of what
   Qloo is missing. It holds IDs and demand only, never copied data.

Anything else is marked `unavailable`. Nothing is invented.

## Run it locally

Requirements: Node 22+, pnpm 11.

```bash
pnpm install
cp .env.example .env.local   # then add your own keys
pnpm dev                     # http://localhost:3400
```

Quality gates (run before every push):

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Data sources and credits

- [MusicBrainz](https://musicbrainz.org) core data, CC0
- [Wikidata](https://www.wikidata.org), CC0
- [Wikipedia](https://en.wikipedia.org) summaries, CC BY-SA 4.0 (linked on every use)
- [Wikimedia Commons](https://commons.wikimedia.org) images, per-file licences (linked)
- [Last.fm](https://www.last.fm) API, powered by AudioScrobbler, used with each caller's own key
- [Deezer](https://developers.deezer.com) API (non-commercial use)
- [OpenStreetMap](https://www.openstreetmap.org/copyright) via Nominatim: the place at a point, © OpenStreetMap contributors, ODbL
- [Spotify](https://developer.spotify.com/documentation/embeds) public oEmbed: an artist's name for a Spotify ID (nothing else from Spotify is used)
- [ListenBrainz](https://listenbrainz.org) fresh releases (the proof sample)
- Researched facts: the page cited per value, with the quote checked on that page
- [Qloo](https://qloo.com) API, with each caller's own key. No Qloo response data is stored in this repo.

## Licence

MIT
