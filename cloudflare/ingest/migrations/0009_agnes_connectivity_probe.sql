-- Standalone provider connectivity receipts share the same hard paid-call cap.
CREATE TABLE mcp_provider_probes (
 probe_id TEXT PRIMARY KEY, model TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','succeeded','failed','unknown')),
 request_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finished_at TEXT, response_id TEXT,response_model TEXT,http_status INTEGER,
 output TEXT,usage_json TEXT,error TEXT
);
