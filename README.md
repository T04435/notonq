# NotOnQ

When the [Qloo](https://qloo.com) taste API has no data for an artist, NotOnQ returns the same shape from open sources,
with a source on every value. It caches the answer and counts how often each missing artist is asked for, so the gaps
developers actually hit can be ranked for import.

Built for the Qloo Agentic Hackathon 2026. Works with the Qloo API; not affiliated with or endorsed by Qloo.

## What it proves

From one measured run ([`/proof`](src/app/proof/page.tsx), `scripts/proof.mts`):

- **63%** of artists with a release in the last 14 days are unknown to Qloo or unusable as a taste signal, compared with **4%** of chart artists.
- NotOnQ builds a **sourced entity for 100%** of those gaps, and finds **stand-ins Qloo can answer for in 80%**.
- Using stand-ins alone recovers **37%** of Qloo's own top-20 "fans also like" for artists Qloo does know (29% of the top 10).

## Three ways in

1. **Playground** (`/`): look up any artist and see what Qloo returned and what NotOnQ filled, with a citation on every value.
2. **Drop-in REST** (`/q/*`): the same paths and parameters as the Qloo API, with your own `X-Api-Key`. Responses have
   exactly Qloo's shape, and anything NotOnQ adds is prefixed `notonq:`. The official harness works too:
   `QLOO_BASE_URL=https://<host>/q QLOO_TRUSTED_BASE_URL=https://<host>/q qloo mcp`.
3. **MCP** (`npx notonq mcp`, [packages/mcp](packages/mcp)): the official Qloo harness, with gaps filled and labelled.

## How it fills a gap

1. **Qloo first.** If Qloo knows the artist, its response passes through untouched.
2. **Who could it be?** MusicBrainz, Last.fm and Deezer matches are merged. Only one confident exact MusicBrainz match
   continues by itself; otherwise you choose (`notonq.candidate=<key>`).
3. **Open data** for facts: MusicBrainz, Wikidata, Wikipedia, Last.fm, Deezer.
4. **Stand-ins:** similar artists Qloo *does* know become the taste signal, so affinities, heatmaps and demographics
   still come from Qloo, labelled as coming from the stand-ins.
5. **Research (tier 3):** for what's still missing, a web research agent returns claims with a URL and an exact quote.
   Plain code re-fetches every page and keeps only quotes it finds there.
6. **Cache and demand:** every answer is cached, and every request counts towards the Ledger (`/ledger`), a ranked list of what
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
- [ListenBrainz](https://listenbrainz.org) fresh releases (the proof sample)
- Researched facts: the page cited per value, with the quote checked on that page
- [Qloo](https://qloo.com) API, with each caller's own key. No Qloo response data is stored in this repo.

## Licence

MIT
