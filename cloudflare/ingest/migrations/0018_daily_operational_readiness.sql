-- Operational observations are separate from immutable review evidence.
CREATE TABLE IF NOT EXISTS reviewer_poll_health (
 reviewer TEXT PRIMARY KEY CHECK(reviewer IN ('A','B')),
 candidate_count INTEGER NOT NULL CHECK(candidate_count BETWEEN 0 AND 5),
 returned_count INTEGER NOT NULL CHECK(returned_count BETWEEN 0 AND candidate_count),
 checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_phase3_daily_jobs_state_date ON phase3_daily_jobs(state,date);
