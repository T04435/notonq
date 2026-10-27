import Link from "next/link";
import { Code } from "@/components/code";
import { SimpleTable } from "@/components/simple-table";

export const metadata = { title: "REST API · NotOnQ" };

const SEARCH = `curl -H "X-Api-Key: $QLOO_API_KEY" \\
  "https://<notonq-host>/q/search?types=urn:entity:artist&query=sombr"`;

const SEARCH_RES = `{
  "results": [{ "entity_id": "502cf908-…", "name": "sombr", "types": ["urn:entity:artist"], … }],
  "notonq": {
    "served_by": "fallback",
    "gap": { "kind": "G1", "qloo_status": 200 },
    "cache": { "hit": false, "first_seen": "2026-10-23T06:51:45Z" },
    "demand": { "requests": 1, "callers": 1, "apps": 1 },
    "proxy": { "replaced": [], "stand_ins": [{ "entity_id": "EB24591A-…", "name": "The Neighbourhood", "weight": 0.89, "source": "lastfm" }] },
    "provenance": { "name": [{ "source": "musicbrainz", "record": "https://musicbrainz.org/artist/…", "licence": "CC0-1.0", "method": "copied" }] },
    "popularity": { "value": 0.982, "n": 4, "rmse": 0.029 },
    "unavailable": [],
    "confidence": "high",
    "research": { "status": "none" },
    "attribution": ["…"]
  }
}`;

const CHOICE = `# No clear match: Qloo's results first, then every artist the name could be, each a Qloo-shaped entry
"results": [
  { "entity_id": "94E61B56-…", "name": "Victoria Monét", … },                       # Qloo's, unchanged
  { "entity_id": "e1e3771f-bb8e-5289-…", "name": "Victoria Queen", "types": ["urn:entity:artist"],
    "properties": { "short_description": "Not in Qloo: a possible match NotOnQ found on lastfm, deezer (4 Last.fm listeners, 2 Deezer fans). …" } }
],
"notonq": { "served_by": "needs_choice", "candidates": [
  { "key": "lf:victoria-queen", "name": "Victoria Queen", "exact": true, "listeners": 4, "fans": 2, "deezerId": 12775769, "links": [ … ] },
  { "key": "mb:7db5c493-…", "name": "Queen Victoria", "exact": false, "country": "US", "inQloo": null, … }
], "next": "Repeat the request with notonq.candidate=<key>" }

# Then use the one you mean: its entity_id works in /entities and as a signal (NotOnQ fills it on first use)
curl -H "X-Api-Key: $QLOO_API_KEY" "https://<notonq-host>/q/entities?entity_ids=e1e3771f-bb8e-5289-…"
# or by key
curl -H "X-Api-Key: $QLOO_API_KEY" \\
  "https://<notonq-host>/q/search?types=urn:entity:artist&query=victoria%20queen&notonq.candidate=lf:victoria-queen"`;

const INSIGHTS = `# GET: a NotOnQ ID works as a signal anywhere Qloo takes one
curl -H "X-Api-Key: $QLOO_API_KEY" \\
  "https://<notonq-host>/q/v2/insights?filter.type=urn:entity:artist&signal.interests.entities=502cf908-…&take=5"

# POST: Qloo's JSON body, with UUID strings or { id, weight } objects
curl -X POST -H "X-Api-Key: $QLOO_API_KEY" -H "Content-Type: application/json" \\
  "https://<notonq-host>/q/v2/insights" \\
  -d '{ "filter.type": "urn:entity:place", "filter.location.query": "Melbourne",
        "signal.interests.entities": [{ "id": "502cf908-…", "weight": 1 }] }'`;

export default function RestReference() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Base URL and headers</h2>
        <p className="text-sm text-muted-foreground">
          <code>https://&lt;notonq-host&gt;/q</code> (or <code>/q/app/&lt;your-app&gt;</code> to name your app without a header) plus the same path and
          parameters you would send to <code>https://hackathon.api.qloo.com</code>. The machine-readable spec is at{" "}
          <Link href="/openapi.json" className="underline">
            /openapi.json
          </Link>
          .
        </p>
        <SimpleTable
          head={["Header", "Required", "Use"]}
          mono={[0]}
          rows={[
            ["X-Api-Key", "yes", "Your Qloo key. Forwarded to Qloo per request, never stored."],
            ["X-NotOnQ-App", "no", "A label for your app (up to 64 characters), shown in the Ledger and on Proof. Same as /q/app/<label>."],
            ["X-NotOnQ-Trace", "no", "An ID for one user action in your app (up to 120 characters). Calls with the same trace are one visit in the Ledger; without it, your calls less than 2 minutes apart are. Never sent to Qloo."],
            ["X-Lastfm-Key", "no", "Your own Last.fm key. Without it NotOnQ uses its own for the hackathon demo."],
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Endpoints</h2>
        <SimpleTable
          head={["Qloo endpoint", "What NotOnQ does"]}
          mono={[0]}
          rows={[
            ["GET /search (types=urn:entity:artist, or no types)", "Qloo first, unchanged. When Qloo has no artist (untyped: nothing at all) with that exact name, NotOnQ adds the filled artist, or every artist the name could be, after Qloo's results."],
            ["GET /entities?entity_ids=…", "Qloo's IDs from Qloo; NotOnQ's (fills, and candidates it offered, filled on first use) from NotOnQ, in one results list."],
            ["GET /v2/insights", "Any filter.type. NotOnQ IDs, and Qloo IDs Qloo rejects as a signal, become their stand-ins; Qloo answers. No stand-ins: an empty answer."],
            ["POST /v2/insights", "The same, with a JSON body; { id, weight } objects stay weighted (scaled by each stand-in's match)."],
            ["GET /v2/analysis/compare", "NotOnQ artists in either group become their stand-ins."],
            ["GET /v2/insights · artists by music tag and place", "filter.tags=urn:tag:genre:music:60s (any decade or genre) with signal.location.query: when Qloo returns fewer than 5 artists, NotOnQ adds artists from that era, genre and country after Qloo's (Qloo-known ones first, as Qloo entities)."],
            ["Everything else", "Passes through unchanged (cached per key): /, /v2/tags, /v2/audiences, /v2/trending, other entity types."],
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">GET /search</h2>
        <Code code={SEARCH} language="bash" title="Request" />
        <Code code={SEARCH_RES} language="json" title="Response for an artist Qloo doesn't know" />
        <Code code={CHOICE} language="bash" title="When the name is ambiguous" />
        <SimpleTable
          head={["Parameter", "Use"]}
          mono={[0]}
          rows={[
            ["notonq.candidate=<key>", "Fill from this candidate (keys come from notonq.candidates). Sending the candidate's entity_id to /entities does the same."],
            ["notonq.choose=1", "Always list the candidates, even when a fill is cached or one match is confident."],
          ]}
        />
        <p className="text-sm text-muted-foreground">notonq.* parameters are never sent to Qloo.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">GET and POST /v2/insights</h2>
        <Code code={INSIGHTS} language="bash" title="Stand-ins answer for artists Qloo can't use" />
        <p className="text-sm text-muted-foreground">
          The response is Qloo&apos;s, plus <code>notonq.proxy</code> listing what was replaced and by which stand-ins.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">The notonq block</h2>
        <SimpleTable
          head={["Field", "Meaning"]}
          mono={[0]}
          rows={[
            ["served_by", "qloo · fallback · mixed (Qloo answered for stand-ins) · needs_choice"],
            ["gap", "kind G1 or G2, with Qloo's status and message"],
            ["cache", "hit, and when the fill was first made"],
            ["demand", "requests, distinct callers and apps for this artist"],
            ["proxy", "replaced IDs and the stand_ins used (entity_id, name, weight, source)"],
            ["provenance", "per field: source, record, licence, method, retrievedAt, note"],
            ["popularity", "the derived estimate: value, n stand-ins, rmse"],
            ["unavailable", "fields with no provable source; '(source error: …)' when a source failed"],
            ["confidence", "high (MusicBrainz record) or low (Last.fm or Deezer only)"],
            ["candidates / next", "for needs_choice: the options and how to pick one"],
            ["research", "pending · done · failed · skipped · none"],
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Status codes</h2>
        <SimpleTable
          head={["Code", "When"]}
          mono={[0]}
          rows={[
            ["200", "Qloo answered, or NotOnQ filled the gap, or returned candidates"],
            ["400", "Bad request body; or Qloo's own 400, passed through"],
            ["401", "No X-Api-Key"],
            ["404", "Qloo's 404 when nothing could be filled"],
            ["429", "Your daily Qloo budget through NotOnQ is used up (resets 00:00 UTC), or Qloo's own rate limit"],
            ["502", "Qloo did not answer"],
          ]}
        />
      </section>
    </div>
  );
}
