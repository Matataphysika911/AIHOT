-- Additive immutable evidence. Ingestion facts and scoring/finalization triggers unchanged.
CREATE TABLE article_evidence (
 article_id TEXT PRIMARY KEY REFERENCES articles(id), source_url TEXT NOT NULL,
 extracted_text TEXT NOT NULL CHECK(length(extracted_text)<=12000), extraction_method TEXT NOT NULL,
 fetched_at TEXT NOT NULL, content_hash TEXT NOT NULL, evidence_snapshot_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('extracted','fallback')), error TEXT,
 original_chars INTEGER NOT NULL, truncated INTEGER NOT NULL CHECK(truncated IN (0,1)),
 raw_r2_key TEXT, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json))
);
CREATE TRIGGER evidence_no_update BEFORE UPDATE ON article_evidence BEGIN
 SELECT RAISE(ABORT,'immutable_evidence');
END;
CREATE TRIGGER evidence_no_delete BEFORE DELETE ON article_evidence BEGIN
 SELECT RAISE(ABORT,'immutable_evidence');
END;
-- Separate immutable v2 audit. Historical v1 tables, rows, guards and views remain intact.
CREATE TABLE mcp_reviewer_runs_v2 (
 reviewer_run_id TEXT PRIMARY KEY,
 processing_run_id TEXT NOT NULL REFERENCES mcp_processing_runs(run_id),
 article_id TEXT NOT NULL REFERENCES articles(id), reviewer TEXT NOT NULL CHECK(reviewer IN ('A','B')),
 scheduled_task_id TEXT NOT NULL, context_id TEXT NOT NULL, caller_client_id TEXT NOT NULL,
 prompt_version TEXT NOT NULL CHECK(prompt_version='robotics-plus-mcp.phase2-optimization.v2'),
 input_snapshot TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(processing_run_id,reviewer)
);
CREATE TRIGGER mcp_reviewer_v2_run_guard BEFORE INSERT ON mcp_reviewer_runs_v2 BEGIN
 SELECT RAISE(ABORT,'reviewer_run_conflict') WHERE NOT EXISTS(SELECT 1 FROM mcp_processing_runs p WHERE p.run_id=NEW.processing_run_id
 AND p.article_id=NEW.article_id AND p.prompt_version=NEW.prompt_version
 AND p.input_snapshot=NEW.input_snapshot AND p.caller_client_id=NEW.caller_client_id);
 SELECT RAISE(ABORT,'independent_context_required') WHERE NEW.reviewer='B' AND NOT EXISTS(SELECT 1 FROM mcp_reviewer_runs_v2 a
 WHERE a.processing_run_id=NEW.processing_run_id AND a.reviewer='A'
 AND a.context_id!=NEW.context_id AND a.scheduled_task_id!=NEW.scheduled_task_id
 AND a.reviewer_run_id!=NEW.reviewer_run_id);
END;
CREATE TRIGGER mcp_reviewer_v2_receipt_guard BEFORE INSERT ON mcp_task_receipts
 WHEN NEW.prompt_version='robotics-plus-mcp.phase2-optimization.v2' BEGIN
 SELECT RAISE(ABORT,'reviewer_receipt_conflict') WHERE NOT EXISTS(SELECT 1 FROM mcp_reviewer_runs_v2 r
 WHERE r.processing_run_id=NEW.run_id AND r.reviewer_run_id=NEW.reviewer_run_id
 AND r.reviewer=NEW.reviewer AND r.context_id=NEW.context_id AND r.scheduled_task_id=NEW.scheduled_task_id
 AND r.caller_client_id=NEW.caller_client_id AND r.prompt_version=NEW.prompt_version
 AND ((r.reviewer='A' AND NEW.stage IN ('prefilter','score_a'))
 OR (r.reviewer='B' AND NEW.stage IN ('score_b','structure','finalize'))));
END;
CREATE VIEW mcp_reviewer_v2_audit AS SELECT r.*,t.stage,t.payload_hash,t.created_at AS receipt_created_at
 FROM mcp_reviewer_runs_v2 r JOIN mcp_task_receipts t ON t.reviewer_run_id=r.reviewer_run_id;

-- A can only prefilter/score. The database deterministically closes BLOCK without a B judgment.
CREATE TRIGGER mcp_reviewer_v2_blocked AFTER INSERT ON mcp_task_receipts
 WHEN NEW.prompt_version='robotics-plus-mcp.phase2-optimization.v2' AND NEW.stage='prefilter'
 AND json_extract(NEW.payload,'$.status')='BLOCK' BEGIN
 UPDATE articles SET processing_status='completed',final_score=NULL,selection_status='blocked'
 WHERE id=(SELECT article_id FROM mcp_processing_runs WHERE run_id=NEW.run_id);
 UPDATE mcp_processing_runs SET status='completed',finished_at=CURRENT_TIMESTAMP WHERE run_id=NEW.run_id;
END;

CREATE TRIGGER mcp_reviewer_v2_no_update BEFORE UPDATE ON mcp_reviewer_runs_v2 BEGIN
 SELECT RAISE(ABORT,'immutable_reviewer_run');
END;
CREATE TRIGGER mcp_reviewer_v2_no_delete BEFORE DELETE ON mcp_reviewer_runs_v2 BEGIN
 SELECT RAISE(ABORT,'immutable_reviewer_run');
END;
