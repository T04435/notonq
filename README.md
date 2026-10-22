# NotOnQ

When the [Qloo](https://qloo.com) taste API has no data for an artist, NotOnQ returns the same shape from open sources,
with a source on every value. It caches the answer and counts how often each missing artist is asked for, so the gaps
developers actually hit can be ranked for import.

Built for the Qloo Agentic Hackathon 2026. Works with the Qloo API; not affiliated with or endorsed by Qloo.

## Status

Work in progress (artists only). The engine is done: gap detection, open-data adapters and the stand-in proxy.
Coming next: the cache and demand ledger, the drop-in REST API, the playground, the research agent, and `npx notonq mcp`.

## How it fills a gap

1. **Qloo first.** If Qloo knows the artist, its response passes through untouched.
2. **Open data** for facts: MusicBrainz (identity, aliases), Wikidata (IDs, image, genres), Wikipedia (summary).
3. **Stand-ins:** similar artists (Last.fm) that Qloo *does* know become the taste signal, so affinities, heatmaps
   and demographics still come from Qloo, labelled as coming from the stand-ins.
4. **Derived popularity:** fitted from the stand-ins' Qloo popularity against their Last.fm listeners, with the
   sample size and error.
5. Anything else is marked `unavailable`. Nothing is invented.

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
- [Qloo](https://qloo.com) API, with each caller's own key. No Qloo response data is stored in this repo.

## Licence

MIT
