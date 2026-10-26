// The whole schema, applied idempotently on first use (one small app, no migration tool needed yet). Statements are
// separated by ";\n" because the Neon HTTP driver runs one at a time.
// What is never stored: Qloo responses outside the per-key cache, caller keys (hash only), end-user identifiers.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS fallback_entities (
  id               text PRIMARY KEY,           -- UUID: the MBID, or a name-based UUID of the candidate key (see idForKey)
  name_key         text NOT NULL,              -- normalised name it was asked for (one name can be several artists)
  name             text NOT NULL,
  mbid             text,
  qid              text,
  spotify_id       text,
  gap_kind         text NOT NULL,              -- G1 | G2
  qloo_entity_id   text,                       -- set for G2 (Qloo knows the ID) or once Qloo adds the artist
  entity           jsonb,                      -- Qloo-shaped entity built from our own (open) data only; null = nothing found
  provenance       jsonb NOT NULL DEFAULT '{}',
  stand_ins        jsonb NOT NULL DEFAULT '[]',
  popularity       jsonb,
  unavailable      jsonb NOT NULL DEFAULT '[]',
  created_at       timestamptz NOT NULL DEFAULT now(),
  refreshed_at     timestamptz NOT NULL DEFAULT now(),
  resolved_by_qloo_at timestamptz
);
ALTER TABLE fallback_entities DROP CONSTRAINT IF EXISTS fallback_entities_name_key_key;
ALTER TABLE fallback_entities ADD COLUMN IF NOT EXISTS candidate_key text;
ALTER TABLE fallback_entities ADD COLUMN IF NOT EXISTS confidence text;
ALTER TABLE fallback_entities ADD COLUMN IF NOT EXISTS research_status text;   -- null | pending | done | failed | skipped
ALTER TABLE fallback_entities ADD COLUMN IF NOT EXISTS research_at timestamptz;
ALTER TABLE fallback_entities ADD COLUMN IF NOT EXISTS chosen boolean NOT NULL DEFAULT false;   -- picked from candidates: never the default for its name

-- Candidates offered in a search, so an ID sent back (to /entities or as a signal) can be filled.
CREATE TABLE IF NOT EXISTS candidate_refs (
  id          text PRIMARY KEY,
  key         text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fallback_entities_name_key ON fallback_entities (name_key, refreshed_at DESC);
CREATE INDEX IF NOT EXISTS fallback_entities_mbid ON fallback_entities (mbid);
CREATE INDEX IF NOT EXISTS fallback_entities_qloo ON fallback_entities (qloo_entity_id);
CREATE INDEX IF NOT EXISTS fallback_entities_spotify ON fallback_entities (spotify_id);

-- Every request, recorded for the Ledger's replay: an Ask run's streamed steps (with timing) or one API/MCP request
-- and its response. Replaying shows these recorded steps again; nothing is re-run. Caller keys are hashed, never stored.
CREATE TABLE IF NOT EXISTS runs (
  id           text PRIMARY KEY,
  kind         text NOT NULL,                  -- ask | api
  title        text NOT NULL,                  -- the question, or "GET /q/v2/insights?..."
  summary      text,
  served_by    text,                           -- qloo | fallback | mixed | needs_choice (api), or the final source (ask)
  app_label    text,
  caller_hash  text NOT NULL,
  events       jsonb NOT NULL,
  ms           integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_created ON runs (created_at DESC);

-- Fills for a whole request shape (v0.3.0: artists by era, genre and place), shared like other open-data fills
CREATE TABLE IF NOT EXISTS shape_fills (
  key           text PRIMARY KEY,
  body          jsonb NOT NULL,
  refreshed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requests (
  id           bigserial PRIMARY KEY,
  name_key     text NOT NULL,
  entity_id    text,
  endpoint     text NOT NULL,                  -- playground | /search | /entities | /v2/insights | mcp
  served_by    text NOT NULL,                  -- qloo | fallback | mixed | needs_choice
  gap_kind     text,
  caller_hash  text NOT NULL,
  app_label    text,
  cache_hit    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS query text;
CREATE INDEX IF NOT EXISTS requests_name_key ON requests (name_key);

CREATE TABLE IF NOT EXISTS research_claims (
  id           bigserial PRIMARY KEY,
  entity_id    text NOT NULL,
  field        text NOT NULL,
  value        text NOT NULL,
  source_url   text NOT NULL,
  quote        text NOT NULL,
  verified     boolean NOT NULL,
  confidence   text,
  reason       text,                           -- why a claim was rejected
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS research_claims_entity ON research_claims (entity_id);

CREATE TABLE IF NOT EXISTS qloo_usage (
  caller_hash  text NOT NULL,
  day          date NOT NULL,
  calls        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (caller_hash, day)
);

CREATE TABLE IF NOT EXISTS qloo_cache (
  caller_hash  text NOT NULL,
  req_hash     text NOT NULL,
  status       integer NOT NULL,
  body         jsonb,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (caller_hash, req_hash)
);

DROP VIEW IF EXISTS import_queue;
CREATE VIEW import_queue AS
SELECT r.name_key,
       max(r.query)                                                               AS query,
       count(*)                                                                   AS requests,
       count(DISTINCT r.caller_hash)                                              AS callers,
       count(DISTINCT r.app_label)                                                AS apps,
       max(r.created_at)                                                          AS last_requested,
       min(r.created_at)                                                          AS first_seen,
       (array_agg(r.gap_kind ORDER BY r.created_at DESC))[1]                      AS gap_kind,
       (array_agg(r.entity_id ORDER BY r.created_at DESC) FILTER (WHERE r.entity_id IS NOT NULL))[1] AS entity_id,
       bool_or(r.served_by = 'needs_choice')                                      AS asked_to_choose
FROM requests r
WHERE r.served_by <> 'qloo'
GROUP BY r.name_key
`;
