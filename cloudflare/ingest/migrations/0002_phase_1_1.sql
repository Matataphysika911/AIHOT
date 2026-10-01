ALTER TABLE sources ADD COLUMN health TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE sources ADD COLUMN initialized_at TEXT;

ALTER TABLE articles ADD COLUMN content_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_source_content_hash
ON articles(source_id, content_hash)
WHERE content_hash IS NOT NULL;

ALTER TABLE collection_runs ADD COLUMN duplicate_items INTEGER NOT NULL DEFAULT 0;
ALTER TABLE collection_runs ADD COLUMN backfill_items INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sources_health
ON sources(enabled, health, consecutive_failures);
