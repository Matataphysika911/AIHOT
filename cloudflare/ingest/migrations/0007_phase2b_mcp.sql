-- Isolated MCP production processing. Existing API-provider queues remain untouched.
CREATE VIEW mcp_article_facts AS SELECT a.id, json_object(
 'id',a.id,'source_id',a.source_id,'canonical_url',a.canonical_url,'url_hash',a.url_hash,
 'external_id',a.external_id,'title',a.title,'summary',a.summary,'author',a.author,
 'published_at',a.published_at,'discovered_at',a.discovered_at,'raw_r2_key',a.raw_r2_key,
 'is_backfill',a.is_backfill,'publish_eligible',a.publish_eligible,'content_hash',a.content_hash,
 'created_at',a.created_at,'event_id',a.event_id,'tier',s.tier,'first_party',s.first_party
) AS snapshot FROM articles a JOIN sources s ON s.id=a.source_id;
CREATE TABLE mcp_processing_runs (
 run_id TEXT PRIMARY KEY, article_id TEXT NOT NULL UNIQUE REFERENCES articles(id),
 caller_client_id TEXT NOT NULL, provider TEXT NOT NULL, runtime_claim TEXT NOT NULL,
 prompt_version TEXT NOT NULL, input_snapshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','completed')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT
);
CREATE TABLE mcp_task_receipts (
 run_id TEXT NOT NULL REFERENCES mcp_processing_runs(run_id),
 stage TEXT NOT NULL CHECK(stage IN ('prefilter','score_a','score_b','structure','finalize')),
 payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL,
 provider TEXT NOT NULL, prompt_version TEXT NOT NULL, caller_client_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(run_id,stage)
);
CREATE VIEW mcp_ai_runs AS SELECT r.*, p.article_id, p.runtime_claim, p.input_snapshot,
 'succeeded' AS status, 'no_paid_model_api' AS billing_path
 FROM mcp_task_receipts r JOIN mcp_processing_runs p USING(run_id);
CREATE TRIGGER mcp_claim BEFORE INSERT ON mcp_processing_runs BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM articles a JOIN mcp_article_facts f ON f.id=a.id
 WHERE a.id=NEW.article_id AND a.processing_status='new' AND a.intelligence_revision IS NULL
 AND a.prefilter_status IS NULL AND a.score_a IS NULL AND a.score_b IS NULL
 AND a.final_score IS NULL AND a.structure_json IS NULL AND f.snapshot=NEW.input_snapshot)
 THEN RAISE(ABORT,'article_not_new_or_snapshot_changed') END;
END;
CREATE TRIGGER mcp_claim_article AFTER INSERT ON mcp_processing_runs BEGIN
 UPDATE articles SET processing_status='processing',intelligence_revision=NEW.run_id,
 updated_at=CURRENT_TIMESTAMP WHERE id=NEW.article_id;
END;
CREATE TRIGGER mcp_receipt_guard BEFORE INSERT ON mcp_task_receipts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mcp_processing_runs p JOIN articles a ON a.id=p.article_id
 JOIN mcp_article_facts f ON f.id=a.id WHERE p.run_id=NEW.run_id AND p.status='processing'
 AND a.processing_status='processing' AND a.intelligence_revision=p.run_id
 AND p.caller_client_id=NEW.caller_client_id AND p.prompt_version=NEW.prompt_version
 AND p.provider=NEW.provider AND p.input_snapshot=f.snapshot)
 THEN RAISE(ABORT,'state_run_or_snapshot_conflict') END;
 SELECT CASE WHEN NEW.stage!='prefilter' AND NOT EXISTS(SELECT 1 FROM mcp_task_receipts
 WHERE run_id=NEW.run_id AND stage='prefilter') THEN RAISE(ABORT,'prefilter_required') END;
 SELECT CASE WHEN NEW.stage IN ('score_a','score_b','structure') AND EXISTS(SELECT 1 FROM mcp_task_receipts
 WHERE run_id=NEW.run_id AND stage='prefilter' AND json_extract(payload,'$.status')='BLOCK')
 THEN RAISE(ABORT,'prefilter_blocked') END;
 SELECT CASE WHEN NEW.stage='score_b' AND NOT EXISTS(SELECT 1 FROM mcp_task_receipts
 WHERE run_id=NEW.run_id AND stage='score_a') THEN RAISE(ABORT,'score_a_required') END;
 SELECT CASE WHEN NEW.stage='structure' AND (SELECT count(*) FROM mcp_task_receipts
 WHERE run_id=NEW.run_id AND stage IN ('score_a','score_b'))!=2 THEN RAISE(ABORT,'dual_scores_required') END;
 SELECT CASE WHEN NEW.stage='finalize' AND NOT EXISTS(SELECT 1 FROM mcp_task_receipts
 WHERE run_id=NEW.run_id AND stage='prefilter' AND json_extract(payload,'$.status')='BLOCK')
 AND (SELECT count(*) FROM mcp_task_receipts WHERE run_id=NEW.run_id
 AND stage IN ('score_a','score_b','structure'))!=3 THEN RAISE(ABORT,'stages_incomplete') END;
END;
CREATE TRIGGER mcp_stage_article AFTER INSERT ON mcp_task_receipts BEGIN
 UPDATE articles SET
 prefilter_status=CASE WHEN NEW.stage='prefilter' THEN json_extract(NEW.payload,'$.status') ELSE prefilter_status END,
 score_a=CASE WHEN NEW.stage='score_a' THEN json_extract(NEW.payload,'$.total') ELSE score_a END,
 score_b=CASE WHEN NEW.stage='score_b' THEN json_extract(NEW.payload,'$.total') ELSE score_b END,
 structure_json=CASE WHEN NEW.stage='structure' THEN NEW.payload ELSE structure_json END,
 updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT article_id FROM mcp_processing_runs WHERE run_id=NEW.run_id);
END;
CREATE TRIGGER mcp_finalize_article AFTER INSERT ON mcp_task_receipts WHEN NEW.stage='finalize' BEGIN
 UPDATE articles SET processing_status='completed',
 final_score=CASE WHEN prefilter_status='BLOCK' THEN NULL ELSE CAST((score_a+score_b)/2 AS INTEGER) END,
 selection_status=CASE WHEN prefilter_status='BLOCK' THEN 'blocked' WHEN publish_eligible!=1 THEN 'ineligible'
 WHEN (SELECT tier FROM sources WHERE id=source_id) NOT IN ('T1','T1_5','T2') THEN 'unrated'
 WHEN score_a+score_b >= 2*(CASE (SELECT tier FROM sources WHERE id=source_id) WHEN 'T1' THEN 60 WHEN 'T1_5' THEN 65 ELSE 76 END)
 THEN 'selected' WHEN (score_a+score_b)/2>50 THEN 'near-selected' ELSE 'not-selected' END
 WHERE id=(SELECT article_id FROM mcp_processing_runs WHERE run_id=NEW.run_id);
 UPDATE mcp_processing_runs SET status='completed',finished_at=CURRENT_TIMESTAMP WHERE run_id=NEW.run_id;
END;
