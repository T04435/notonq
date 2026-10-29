import { DocsCode } from "@/components/code";
import { A, C, DocsSection, EndpointTable, H3, Notice, P, RefTable } from "@/components/docs";

export const metadata = { title: "REST API · NotOnQ" };

const SEARCH = `curl -H "X-Api-Key: $QLOO_API_KEY" -H "X-NotOnQ-App: my-app" \\
  "https://notonq.vercel.app/q/search?types=urn:entity:artist&query=sombr"`;

// What NotOnQ adds is amber in the box: the filled-in artist and the notonq block (0-based line numbers below).
const SEARCH_RES = `{
  // Qloo's own results, if it had any, come first, unchanged
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
const SEARCH_ADDED = [2, ...Array.from({ length: 13 }, (_, i) => i + 3)];

const CHOICE = `// No clear match: Qloo's results first, then every artist the name could be, each a Qloo-shaped entry
"results": [
  { "entity_id": "94E61B56-…", "name": "Victoria Monét", … },   // Qloo's, unchanged
  { "entity_id": "e1e3771f-bb8e-5289-…", "name": "Victoria Queen", "types": ["urn:entity:artist"],
    "properties": { "short_description": "Not in Qloo: a possible match NotOnQ found on lastfm, deezer (4 Last.fm listeners, 2 Deezer fans). …" } }
],
"notonq": { "served_by": "needs_choice", "candidates": [
  { "key": "lf:victoria-queen", "name": "Victoria Queen", "exact": true, "listeners": 4, "fans": 2, "links": [ … ] },
  { "key": "mb:7db5c493-…", "name": "Queen Victoria", "exact": false, "country": "US", "inQloo": null, … }
], "next": "Repeat the request with notonq.candidate=<key>" }`;
const CHOICE_ADDED = [3, 4, 6, 7, 8, 9];

const PICK = `# Use the one you mean: its entity_id works in /entities and as a signal (NotOnQ fills it on first use)
curl -H "X-Api-Key: $QLOO_API_KEY" "https://notonq.vercel.app/q/entities?entity_ids=e1e3771f-bb8e-5289-…"

# or by key
curl -H "X-Api-Key: $QLOO_API_KEY" \\
  "https://notonq.vercel.app/q/search?types=urn:entity:artist&query=victoria%20queen&notonq.candidate=lf:victoria-queen"`;

const INSIGHTS = `# GET: a NotOnQ ID works as a signal anywhere Qloo takes one
curl -H "X-Api-Key: $QLOO_API_KEY" \\
  "https://notonq.vercel.app/q/v2/insights?filter.type=urn:entity:artist&signal.interests.entities=502cf908-…&take=5"

# POST: Qloo's JSON body, with UUID strings or { id, weight } objects
curl -X POST -H "X-Api-Key: $QLOO_API_KEY" -H "Content-Type: application/json" \\
  "https://notonq.vercel.app/q/v2/insights" \\
  -d '{ "filter.type": "urn:entity:place", "filter.location.query": "Melbourne",
        "signal.interests.entities": [{ "id": "502cf908-…", "weight": 1 }] }'`;

export default function RestReference() {
  return (
    <>
      <h1 className="sr-only">NotOnQ docs: REST API</h1>
      <Notice lead="Artists only.">
        NotOnQ steps in for music artists; every other entity type, and every request Qloo answers, passes through to Qloo unchanged.
      </Notice>

      <DocsSection id="base" title="Base URL and headers">
        <P>
          Send the same path and parameters you would send to <C>https://hackathon.api.qloo.com</C>, to <C>https://notonq.vercel.app/q</C>, or to{" "}
          <C>/q/app/&lt;your-app&gt;</C> to name your app without a header. The machine-readable spec is at <A href="/openapi.json">/openapi.json</A>.
        </P>
        <RefTable
          head={["header", "required", "use"]}
          rows={[
            ["X-Api-Key", "yes", "Your Qloo key. Forwarded to Qloo per request, never stored."],
            ["X-NotOnQ-App", "no", "Your app's label (up to 64 characters), shown in the Ledger and on Proof. Same as /q/app/<label>."],
            [
              "X-NotOnQ-Trace",
              "no",
              "An ID for one user action in your app (up to 120 characters). Calls with the same trace are one visit in the Ledger; without it, your calls less than 2 minutes apart are. Never sent to Qloo.",
            ],
            ["X-Lastfm-Key", "no", "Your own Last.fm key. Without it NotOnQ uses its own for the hackathon demo."],
          ]}
        />
      </DocsSection>

      <DocsSection id="endpoints" title="Endpoints">
        <EndpointTable
          rows={[
            [
              "GET",
              "/search",
              "With types=urn:entity:artist, or no types. Qloo first, unchanged. When Qloo has no artist (untyped: nothing at all) with that exact name (a leading \"The\" is optional), NotOnQ adds the filled-in artist, or every artist the name could be, after Qloo's results. take caps Qloo's results and NotOnQ's separately. When Qloo's exact match has a thin record, NotOnQ adds the fields it lacks (G5: notonq:home, notonq:languages, MusicBrainz and Wikidata IDs, genres), cited in notonq.facts.",
            ],
            ["GET", "/entities", "entity_ids=…: Qloo's IDs from Qloo; NotOnQ's (fills, and candidates it offered, filled on first use) from NotOnQ, in one results list. notonq.served_by covers the answer; notonq[\"<entity_id>\"] is each NotOnQ entity's own block. Thin Qloo records (up to 3) get the same G5 fields as /search."],
            [
              "GET",
              "/entities",
              "external.spotify.ids=…: Qloo's matches first. A Spotify ID Qloo lacks is matched through MusicBrainz, else by the name on Spotify's public page (Qloo's record with that exact name, labelled, or NotOnQ's fill when it is one confident artist). Up to 5 such lookups per request.",
            ],
            ["GET", "/v2/insights", "Any filter.type. NotOnQ IDs, and Qloo IDs Qloo rejects as a signal, become their stand-ins; Qloo answers. No stand-ins: an empty answer. filter.type=urn:demographics for an artist Qloo has but has no audience for: Qloo's demographics for the artist's own genres, labelled (G5)."],
            [
              "GET",
              "/v2/insights",
              "filter.type=urn:entity:artist with filter.tags=urn:tag:genre:music:<decade or genre> and a place: when Qloo returns fewer than 5 artists, NotOnQ adds artists from that era, genre and country after Qloo's (the ones Qloo knows first, as Qloo entities).",
            ],
            ["POST", "/v2/insights", "The same, with a JSON body; { id, weight } objects stay weighted (scaled by each stand-in's match)."],
            ["GET", "/v2/analysis/compare", "NotOnQ artists in either group become their stand-ins."],
            [null, "everything else", "Passes through unchanged (cached per key): /, /v2/tags, /v2/audiences, /v2/trending, other entity types."],
          ]}
        />
      </DocsSection>

      <DocsSection id="search" title="GET /search">
        <DocsCode code={SEARCH} language="bash" title="Request" />
        <DocsCode code={SEARCH_RES} language="json" title="Response for an artist new to Qloo" added={SEARCH_ADDED} />
        <H3>When the name could be several artists</H3>
        <DocsCode code={CHOICE} language="json" title="Response with candidates" added={CHOICE_ADDED} />
        <DocsCode code={PICK} language="bash" title="Then pick one" />
        <RefTable
          head={["parameter", "use"]}
          rows={[
            ["notonq.candidate=<key>", "Fill in from this candidate (keys come from notonq.candidates). Sending the candidate's entity_id to /entities does the same."],
            ["notonq.choose=1", "Always list the candidates, even when a fill is cached or one match is confident."],
            ["notonq.not_qloo=1", "Qloo's artist by this name is a different one: look in NotOnQ's sources anyway. Automatic when Qloo's name matches only without punctuation (\"Anorak\" for \"ANORAK!\") and MusicBrainz has the exact name under another record."],
          ]}
        />
        <P>
          <C>notonq.*</C> parameters are never sent to Qloo.
        </P>
      </DocsSection>

      <DocsSection id="insights" title="GET and POST /v2/insights">
        <DocsCode code={INSIGHTS} language="bash" title="Stand-ins answer for artists not yet a taste signal" />
        <P>
          The response is Qloo&apos;s, plus <C>notonq.proxy</C> listing what was replaced and by which stand-ins.
        </P>
      </DocsSection>

      <DocsSection id="notonq-block" title="The notonq block">
        <P>Added beside Qloo&apos;s response when NotOnQ took part. Qloo&apos;s own fields are never changed.</P>
        <RefTable
          head={["field", "meaning"]}
          rows={[
            ["served_by", "qloo · fallback (filled in by NotOnQ) · mixed (Qloo answered for stand-ins) · needs_choice"],
            ["gap", "kind G1 (new to Qloo), G2 (not yet a taste signal) or G4 (a short era list), with Qloo's status and message"],
            ["cache", "hit, and when the fill was first made"],
            ["demand", "requests, distinct callers and apps for this artist"],
            ["proxy", "replaced IDs and the stand_ins used (entity_id, name, weight, source)"],
            ["provenance", "per field: source, record, licence, method, retrievedAt, note"],
            ["popularity", "the derived estimate: value, n stand-ins, rmse"],
            ["unavailable", "fields with no provable source; '(source error: …)' when a source failed"],
            ["confidence", "high (MusicBrainz record) or low (Last.fm or Deezer only)"],
            ["candidates, next", "for needs_choice: the options and how to pick one"],
            ["research", "pending · done · failed · skipped · none"],
          ]}
        />
      </DocsSection>

      <DocsSection id="status" title="Status codes">
        <RefTable
          head={["code", "when"]}
          rows={[
            ["200", "Qloo answered, NotOnQ filled in the artist or returned candidates, or an empty taste answer (no stand-ins)"],
            ["400", "Bad request body; or Qloo's own 400, passed through"],
            ["401", "No X-Api-Key"],
            ["404", "Qloo's 404 when nothing could be filled in"],
            ["429", "Your daily Qloo budget through NotOnQ is used up (resets 00:00 UTC), or Qloo's own rate limit"],
            ["502", "Qloo did not answer"],
          ]}
        />
      </DocsSection>
    </>
  );
}
