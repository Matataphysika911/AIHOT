CREATE TABLE storage_metrics (
  id TEXT PRIMARY KEY,
  measured_at TEXT NOT NULL,
  provider_json TEXT NOT NULL,
  inventory_bytes INTEGER NOT NULL,
  inventory_objects INTEGER NOT NULL,
  inventory_complete INTEGER NOT NULL,
  status TEXT NOT NULL,
  usage_percent REAL NOT NULL
);
CREATE INDEX storage_metrics_time ON storage_metrics(measured_at DESC);

CREATE TABLE maintenance_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  retention_days INTEGER NOT NULL,
  before_bytes INTEGER,
  before_objects INTEGER,
  after_bytes INTEGER,
  after_objects INTEGER,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  deleted_bytes INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  error TEXT
);
CREATE INDEX maintenance_runs_time ON maintenance_runs(started_at DESC);
CREATE TABLE maintenance_locks (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TEXT NOT NULL);
