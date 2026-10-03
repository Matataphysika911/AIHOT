-- Preserve every existing immutable row while extending the inbox CHECK to A/B.
-- D1 migrations run transactionally. Deferred FKs resolve to the restored name.
PRAGMA defer_foreign_keys=ON;
DROP VIEW review_submission_status;
CREATE TABLE review_applications_backup AS SELECT * FROM review_submission_applications;
DROP TABLE review_submission_applications;
CREATE TABLE review_submissions_next (
 id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id),
 reviewer TEXT NOT NULL CHECK(reviewer IN ('A','B')), reviewer_run_id TEXT NOT NULL UNIQUE,
 scheduled_task_id TEXT NOT NULL, context_id TEXT NOT NULL, prompt_version TEXT NOT NULL,
 input_snapshot_hash TEXT NOT NULL, input_snapshot TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), payload_hash TEXT NOT NULL,
 caller_client_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 validation_status TEXT NOT NULL DEFAULT 'pending' CHECK(validation_status='pending'),
 applied_at TEXT CHECK(applied_at IS NULL), error TEXT CHECK(error IS NULL),
 UNIQUE(article_id,reviewer,prompt_version,input_snapshot_hash)
);
INSERT INTO review_submissions_next SELECT * FROM review_submissions;
DROP TABLE review_submissions;
ALTER TABLE review_submissions_next RENAME TO review_submissions;
CREATE TRIGGER review_submission_no_update BEFORE UPDATE ON review_submissions BEGIN
 SELECT RAISE(ABORT,'immutable_submission'); END;
CREATE TRIGGER review_submission_no_delete BEFORE DELETE ON review_submissions BEGIN
 SELECT RAISE(ABORT,'immutable_submission'); END;
CREATE TABLE review_submission_applications (
 submission_id TEXT PRIMARY KEY REFERENCES review_submissions(id),
 validation_status TEXT NOT NULL CHECK(validation_status IN ('applied','rejected')),
 applied_at TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((validation_status='applied' AND applied_at IS NOT NULL AND error IS NULL)
 OR (validation_status='rejected' AND applied_at IS NULL AND error IS NOT NULL))
);
CREATE TRIGGER review_application_no_update BEFORE UPDATE ON review_submission_applications BEGIN
 SELECT RAISE(ABORT,'immutable_application'); END;
CREATE TRIGGER review_application_no_delete BEFORE DELETE ON review_submission_applications BEGIN
 SELECT RAISE(ABORT,'immutable_application'); END;
INSERT INTO review_submission_applications SELECT * FROM review_applications_backup;
DROP TABLE review_applications_backup;
CREATE VIEW review_submission_status AS SELECT s.id,s.article_id,s.reviewer,
 coalesce(a.validation_status,s.validation_status) validation_status,a.applied_at,a.error
 FROM review_submissions s LEFT JOIN review_submission_applications a ON a.submission_id=s.id;
-- Receipt snapshots are recorded directly as well as through their immutable parent.
ALTER TABLE mcp_task_receipts ADD COLUMN input_snapshot_hash TEXT;
CREATE TRIGGER mcp_receipt_no_update BEFORE UPDATE ON mcp_task_receipts BEGIN
 SELECT RAISE(ABORT,'immutable_receipt'); END;
CREATE TRIGGER mcp_receipt_no_delete BEFORE DELETE ON mcp_task_receipts BEGIN
 SELECT RAISE(ABORT,'immutable_receipt'); END;
CREATE TRIGGER mcp_reviewer_no_update BEFORE UPDATE ON mcp_reviewer_runs BEGIN
 SELECT RAISE(ABORT,'immutable_reviewer_run'); END;
CREATE TRIGGER mcp_reviewer_no_delete BEFORE DELETE ON mcp_reviewer_runs BEGIN
 SELECT RAISE(ABORT,'immutable_reviewer_run'); END;
