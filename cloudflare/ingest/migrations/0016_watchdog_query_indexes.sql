-- Additive indexes applied to production during the 2026-10-19 read-cost audit.
CREATE INDEX IF NOT EXISTS idx_review_submissions_reviewer_created ON review_submissions(reviewer, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phase3_daily_events_created ON phase3_daily_events(created_at);
