PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rss','json_list','web_list','external')),
  config_json TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'T2',
  first_party INTEGER NOT NULL DEFAULT 0,
  owner_entity_id TEXT,
  participation_mode TEXT NOT NULL DEFAULT 'editorial',
  interval_minutes INTEGER NOT NULL DEFAULT 120,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_fetch_at TEXT,
  last_fetch_at TEXT,
  last_success_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sources_due
ON sources(enabled, next_fetch_at);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  canonical_url TEXT NOT NULL,
  url_hash TEXT NOT NULL UNIQUE,
  external_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  author TEXT,
  published_at TEXT,
  discovered_at TEXT NOT NULL,
  raw_r2_key TEXT,
  is_backfill INTEGER NOT NULL DEFAULT 0,
  publish_eligible INTEGER NOT NULL DEFAULT 1,
  processing_status TEXT NOT NULL DEFAULT 'new',
  prefilter_status TEXT,
  score_a REAL,
  score_b REAL,
  final_score REAL,
  event_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_articles_published_at
ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source
ON articles(source_id, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_processing
ON articles(processing_status, discovered_at);
CREATE INDEX IF NOT EXISTS idx_articles_event
ON articles(event_id);

CREATE TABLE IF NOT EXISTS collection_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  fetched_items INTEGER NOT NULL DEFAULT 0,
  inserted_items INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_collection_runs_source
ON collection_runs(source_id, started_at DESC);
