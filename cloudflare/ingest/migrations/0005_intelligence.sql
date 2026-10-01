-- Additive Phase 2. Mock jobs never write production article decisions.
ALTER TABLE articles ADD COLUMN intelligence_revision TEXT;
ALTER TABLE articles ADD COLUMN selection_status TEXT;
ALTER TABLE articles ADD COLUMN structure_json TEXT;
CREATE TABLE processing_tasks (
 id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id),
 mode TEXT NOT NULL CHECK(mode IN ('live','mock')), revision TEXT NOT NULL,
 input_hash TEXT NOT NULL, input_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','running','retry','unknown','failed','completed')),
 stage TEXT NOT NULL DEFAULT 'prefilter', attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until TEXT, next_attempt_at TEXT, error TEXT, result_json TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(article_id,mode,revision,input_hash)
);
CREATE INDEX processing_due ON processing_tasks(status,next_attempt_at);
CREATE TABLE task_receipts (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES processing_tasks(id),
 stage TEXT NOT NULL CHECK(stage IN ('prefilter','score_a','score_b','structure')),
 provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
 input_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','received','succeeded','retry','unknown','failed')),
 output TEXT, validated_output TEXT, error TEXT, latency_ms INTEGER,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(task_id,stage)
);
CREATE TABLE ai_runs (
 id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES task_receipts(id),
 mode TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
 input_hash TEXT NOT NULL, status TEXT NOT NULL, output TEXT, error TEXT,
 latency_ms INTEGER, usage_json TEXT, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finished_at TEXT
);
CREATE INDEX ai_runs_budget ON ai_runs(mode,started_at);
CREATE TABLE intelligence_budget_slots (
 slot TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
