-- Derived work queue; immutable submissions/applications remain the authority.
-- Install triggers before the one-time indexed history reconciliation so live
-- inserts cannot fall between seeding and ongoing queue maintenance.
CREATE TABLE IF NOT EXISTS review_pending_applications (
 submission_id TEXT PRIMARY KEY REFERENCES review_submissions(id),
 reviewer TEXT NOT NULL CHECK(reviewer IN ('A','B')),
 created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_review_pending_order
 ON review_pending_applications(reviewer,created_at,submission_id);
CREATE INDEX IF NOT EXISTS idx_review_pending_created
 ON review_pending_applications(created_at);
CREATE TABLE IF NOT EXISTS review_application_latest (
 reviewer TEXT PRIMARY KEY CHECK(reviewer IN ('A','B')),
 applied_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE TRIGGER IF NOT EXISTS review_pending_enqueue AFTER INSERT ON review_submissions
 WHEN NOT EXISTS(SELECT 1 FROM review_submission_applications WHERE submission_id=NEW.id)
 BEGIN
 INSERT OR IGNORE INTO review_pending_applications(submission_id,reviewer,created_at)
 VALUES(NEW.id,NEW.reviewer,NEW.created_at);
 END;
CREATE TRIGGER IF NOT EXISTS review_pending_dequeue AFTER INSERT ON review_submission_applications
 BEGIN
 DELETE FROM review_pending_applications WHERE submission_id=NEW.submission_id;
 INSERT INTO review_application_latest(reviewer,applied_at)
 SELECT reviewer,NEW.applied_at FROM review_submissions
 WHERE id=NEW.submission_id AND NEW.validation_status='applied'
 ON CONFLICT(reviewer) DO UPDATE SET applied_at=max(review_application_latest.applied_at,excluded.applied_at);
 END;
-- Once per migration, not per cron. Existing application PK handles each lookup.
INSERT OR IGNORE INTO review_pending_applications(submission_id,reviewer,created_at)
 SELECT s.id,s.reviewer,s.created_at FROM review_submissions s
 WHERE NOT EXISTS(SELECT 1 FROM review_submission_applications v WHERE v.submission_id=s.id);
INSERT INTO review_application_latest(reviewer,applied_at)
 SELECT s.reviewer,max(v.applied_at) FROM review_submissions s
 JOIN review_submission_applications v ON v.submission_id=s.id
 WHERE v.validation_status='applied' GROUP BY s.reviewer
 ON CONFLICT(reviewer) DO UPDATE SET applied_at=max(review_application_latest.applied_at,excluded.applied_at);
