-- Additive only: no source facts, review receipts or scoring changes.
CREATE TABLE IF NOT EXISTS phase3_daily_jobs (
 date TEXT PRIMARY KEY,snapshot_sha256 TEXT NOT NULL,snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 original_sha256 TEXT,original_json TEXT CHECK(original_json IS NULL OR json_valid(original_json)),
 copy_sha256 TEXT,copy_json TEXT CHECK(copy_json IS NULL OR json_valid(copy_json)),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','published')),
 lease_token TEXT,lease_until TEXT,last_error TEXT,commit_sha TEXT,deployment_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,published_at TEXT
);
CREATE TABLE IF NOT EXISTS phase3_daily_health (
 id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL,health_json TEXT NOT NULL CHECK(json_valid(health_json)),checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phase3_daily_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT,event TEXT NOT NULL,detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
