CREATE TABLE scheduler_runs (
  id TEXT PRIMARY KEY,
  cron TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  error TEXT
);
CREATE INDEX scheduler_runs_time ON scheduler_runs(started_at DESC);
