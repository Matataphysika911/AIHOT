-- Phase 2A only: isolated acceptance receipts. No article scoring/state edits.
CREATE TABLE IF NOT EXISTS processing_probes (
  run_id TEXT PRIMARY KEY CHECK(length(run_id) BETWEEN 1 AND 128),
  article_id TEXT NOT NULL REFERENCES articles(id),
  note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 256),
  caller_client_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_processing_probes_article
ON processing_probes(article_id, created_at);
