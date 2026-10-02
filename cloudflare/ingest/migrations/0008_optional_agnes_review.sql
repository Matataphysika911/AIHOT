-- Add an optional independent reviewer without changing original facts or receipts.
CREATE TABLE mcp_external_reviews (
 run_id TEXT PRIMARY KEY REFERENCES mcp_processing_runs(run_id),
 article_id TEXT NOT NULL, caller_client_id TEXT NOT NULL, prompt_version TEXT NOT NULL,
 provider TEXT NOT NULL DEFAULT 'AGNES API', model TEXT NOT NULL,
 input_json TEXT NOT NULL CHECK(json_valid(input_json)), input_hash TEXT NOT NULL,
 selected_path TEXT NOT NULL CHECK(selected_path IN ('agnes','plus_fallback')),
 status TEXT NOT NULL CHECK(status IN ('pending','received','succeeded','unavailable','failed','unknown')),
 request_started_at TEXT, finished_at TEXT, response_id TEXT, response_model TEXT,
 output TEXT, validated_output TEXT CHECK(validated_output IS NULL OR json_valid(validated_output)),
 usage_json TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER mcp_optional_review_guard BEFORE INSERT ON mcp_task_receipts
WHEN NEW.stage='score_b' AND NEW.prompt_version='robotics-plus-agnes-mcp.phase2b.v1' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mcp_external_reviews r
 WHERE r.run_id=NEW.run_id AND r.caller_client_id=NEW.caller_client_id
 AND r.prompt_version=NEW.prompt_version AND (
 (r.selected_path='agnes' AND r.status IN ('received','succeeded')
 AND json_extract(r.validated_output,'$.total')=json_extract(NEW.payload,'$.total')
 AND (SELECT count(*) FROM json_each(r.validated_output,'$.dimension_scores') x
 JOIN json_each(NEW.payload,'$.dimension_scores') y ON x.key=y.key AND x.value=y.value)=6
 AND json_extract(r.validated_output,'$.reason')=json_extract(NEW.payload,'$.reason'))
 OR (r.selected_path='plus_fallback' AND r.status IN ('unavailable','failed','unknown'))))
 THEN RAISE(ABORT,'independent_review_or_recorded_fallback_required') END;
END;
DROP VIEW mcp_ai_runs;
CREATE VIEW mcp_ai_runs AS SELECT r.run_id,r.stage,r.payload,r.payload_hash,
 CASE WHEN r.stage='score_b' AND e.selected_path='agnes' THEN e.provider
 WHEN r.stage='score_b' AND e.selected_path='plus_fallback' THEN 'ChatGPT Plus fallback/MCP'
 ELSE replace(p.provider,' (AGNES optional)','') END AS provider,
 r.prompt_version,r.caller_client_id,r.created_at,p.article_id,p.runtime_claim,p.input_snapshot,
 'succeeded' AS status,
 CASE WHEN r.stage='score_b' AND e.selected_path='agnes' THEN 'AGNES API (user-authorized)'
 ELSE 'no_paid_model_api' END AS billing_path,
 CASE WHEN r.stage='score_b' AND e.selected_path='agnes' THEN 'independent_stateless_request'
 WHEN r.stage='score_b' THEN 'not_verified' ELSE NULL END AS independence,
 e.model AS external_model,e.response_model,e.response_id,e.usage_json,
 e.error AS external_error,e.status AS external_status
 FROM mcp_task_receipts r JOIN mcp_processing_runs p USING(run_id)
 LEFT JOIN mcp_external_reviews e ON e.run_id=r.run_id AND r.stage='score_b';
