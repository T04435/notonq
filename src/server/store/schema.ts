// The whole schema, applied idempotently on first use (one small app, no migration tool needed yet).
// What is never stored: Qloo responses outside the per-key cache, caller keys (hash only), end-user identifiers.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS fallback_entities (
  id               text PRIMARY KEY,           -- notonq:mbid:<uuid>, or notonq:name:<key> when MusicBrainz has nothing
  name_key         text NOT NULL UNIQUE,       -- normalised name the artist was asked for
  name             text NOT NULL,
  mbid             text,
  qid              text,
  spotify_id       text,
  gap_kind         text NOT NULL,              -- G1 | G2
  qloo_entity_id   text,                       -- set for G2 (Qloo knows the ID) or once Qloo adds the artist
  entity           jsonb,                      -- Qloo-shaped entity built from our own (open) data only
  provenance       jsonb NOT NULL DEFAULT '{}',
  stand_ins        jsonb NOT NULL DEFAULT '[]',
  popularity       jsonb,
  unavailable      jsonb NOT NULL DEFAULT '[]',
  created_at       timestamptz NOT NULL DEFAULT now(),
  refreshed_at     timestamptz NOT NULL DEFAULT now(),
  resolved_by_qloo_at timestamptz
);
CREATE INDEX IF NOT EXISTS fallback_entities_mbid ON fallback_entities (mbid);
CREATE INDEX IF NOT EXISTS fallback_entities_qloo ON fallback_entities (qloo_entity_id);

CREATE TABLE IF NOT EXISTS requests (
  id           bigserial PRIMARY KEY,
  name_key     text NOT NULL,
  entity_id    text,
  endpoint     text NOT NULL,                  -- playground | /search | /entities | /v2/insights | mcp
  served_by    text NOT NULL,                  -- qloo | fallback | mixed
  gap_kind     text,
  caller_hash  text NOT NULL,
  app_label    text,
  cache_hit    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_name_key ON requests (name_key);

CREATE TABLE IF NOT EXISTS qloo_cache (
  caller_hash  text NOT NULL,
  req_hash     text NOT NULL,
  status       integer NOT NULL,
  body         jsonb,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (caller_hash, req_hash)
);

CREATE OR REPLACE VIEW import_queue AS
SELECT f.id, f.name, f.mbid, f.qid, f.spotify_id, f.gap_kind, f.qloo_entity_id, f.stand_ins,
       count(r.id)                     AS requests,
       count(DISTINCT r.caller_hash)   AS callers,
       count(DISTINCT r.app_label)     AS apps,
       max(r.created_at)               AS last_requested,
       f.created_at                    AS first_seen,
       f.resolved_by_qloo_at
FROM fallback_entities f
LEFT JOIN requests r ON r.name_key = f.name_key AND r.served_by <> 'qloo'
GROUP BY f.id;
`;
