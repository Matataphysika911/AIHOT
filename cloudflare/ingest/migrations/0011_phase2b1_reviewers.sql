-- Additive audit fields; existing production receipts and triggers remain intact.
ALTER TABLE mcp_task_receipts ADD COLUMN reviewer TEXT CHECK(reviewer IN ('A','B'));
ALTER TABLE mcp_task_receipts ADD COLUMN reviewer_run_id TEXT;
ALTER TABLE mcp_task_receipts ADD COLUMN scheduled_task_id TEXT;
ALTER TABLE mcp_task_receipts ADD COLUMN context_id TEXT;
CREATE TABLE mcp_reviewer_runs (
 reviewer_run_id TEXT PRIMARY KEY,
 processing_run_id TEXT NOT NULL REFERENCES mcp_processing_runs(run_id),
 article_id TEXT NOT NULL REFERENCES articles(id), reviewer TEXT NOT NULL CHECK(reviewer IN ('A','B')),
 scheduled_task_id TEXT NOT NULL, context_id TEXT NOT NULL, caller_client_id TEXT NOT NULL,
 prompt_version TEXT NOT NULL CHECK(prompt_version='robotics-plus-mcp.phase2b1.v1'),
 input_snapshot TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(processing_run_id,reviewer)
);
CREATE TRIGGER mcp_reviewer_run_guard BEFORE INSERT ON mcp_reviewer_runs BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mcp_processing_runs p WHERE p.run_id=NEW.processing_run_id
 AND p.article_id=NEW.article_id AND p.prompt_version=NEW.prompt_version
 AND p.input_snapshot=NEW.input_snapshot AND p.caller_client_id=NEW.caller_client_id)
 THEN RAISE(ABORT,'reviewer_run_conflict') END;
 SELECT CASE WHEN NEW.reviewer='B' AND NOT EXISTS(SELECT 1 FROM mcp_reviewer_runs a
 WHERE a.processing_run_id=NEW.processing_run_id AND a.reviewer='A'
 AND a.context_id!=NEW.context_id AND a.scheduled_task_id!=NEW.scheduled_task_id
 AND a.reviewer_run_id!=NEW.reviewer_run_id)
 THEN RAISE(ABORT,'independent_context_required') END;
END;
CREATE TRIGGER mcp_reviewer_receipt_guard BEFORE INSERT ON mcp_task_receipts
 WHEN NEW.prompt_version='robotics-plus-mcp.phase2b1.v1' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mcp_reviewer_runs r
 WHERE r.processing_run_id=NEW.run_id AND r.reviewer_run_id=NEW.reviewer_run_id
 AND r.reviewer=NEW.reviewer AND r.context_id=NEW.context_id AND r.scheduled_task_id=NEW.scheduled_task_id
 AND r.caller_client_id=NEW.caller_client_id AND r.prompt_version=NEW.prompt_version
 AND ((r.reviewer='A' AND NEW.stage IN ('prefilter','score_a'))
 OR (r.reviewer='B' AND NEW.stage IN ('score_b','structure','finalize'))))
 THEN RAISE(ABORT,'reviewer_receipt_conflict') END;
END;
CREATE VIEW mcp_reviewer_audit AS SELECT r.*,t.stage,t.payload_hash,t.created_at AS receipt_created_at
 FROM mcp_reviewer_runs r JOIN mcp_task_receipts t ON t.reviewer_run_id=r.reviewer_run_id;

-- A can only prefilter/score. The database deterministically closes BLOCK without a B judgment.
CREATE TRIGGER mcp_reviewer_blocked AFTER INSERT ON mcp_task_receipts
 WHEN NEW.prompt_version='robotics-plus-mcp.phase2b1.v1' AND NEW.stage='prefilter'
 AND json_extract(NEW.payload,'$.status')='BLOCK' BEGIN
 UPDATE articles SET processing_status='completed',final_score=NULL,selection_status='blocked'
 WHERE id=(SELECT article_id FROM mcp_processing_runs WHERE run_id=NEW.run_id);
 UPDATE mcp_processing_runs SET status='completed',finished_at=CURRENT_TIMESTAMP WHERE run_id=NEW.run_id;
END;
