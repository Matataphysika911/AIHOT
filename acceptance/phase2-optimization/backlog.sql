WITH a_pending AS (
 SELECT a.discovered_at pending_at FROM articles a JOIN mcp_article_facts f ON f.id=a.id
 WHERE a.processing_status='new' AND a.intelligence_revision IS NULL AND a.prefilter_status IS NULL AND a.score_a IS NULL AND a.score_b IS NULL
 AND NOT EXISTS(SELECT 1 FROM review_submissions s WHERE s.article_id=a.id AND s.reviewer='A' AND s.input_snapshot=f.snapshot)
), b_pending AS (
 SELECT v.applied_at pending_at FROM articles a JOIN review_submissions s ON s.article_id=a.id AND s.reviewer='A'
 JOIN review_submission_applications v ON v.submission_id=s.id AND v.validation_status='applied'
 JOIN mcp_processing_runs p ON p.run_id=s.reviewer_run_id JOIN mcp_article_facts f ON f.id=a.id
 WHERE p.status='processing' AND p.input_snapshot=f.snapshot AND a.processing_status='processing'
 AND a.prefilter_status IN ('PASS','UNKNOWN') AND a.score_a IS NOT NULL AND a.score_b IS NULL
 AND NOT EXISTS(SELECT 1 FROM review_submissions b WHERE b.article_id=a.id AND b.reviewer='B' AND b.prompt_version=s.prompt_version AND b.input_snapshot=f.snapshot)
), unapplied AS (
 SELECT s.created_at pending_at FROM review_submissions s LEFT JOIN review_submission_applications v ON v.submission_id=s.id WHERE v.submission_id IS NULL
), pending AS (SELECT pending_at FROM a_pending UNION ALL SELECT pending_at FROM b_pending)
SELECT (SELECT count(*) FROM a_pending) reviewer_a_pending_count,
 (SELECT count(*) FROM b_pending) reviewer_b_pending_count,
 max(0,coalesce((julianday('now')-julianday((SELECT min(pending_at) FROM pending)))*1440,0)) oldest_pending_age_minutes,
 (SELECT count(*) FROM unapplied) pending_apply_count,
 max(0,coalesce((julianday('now')-julianday((SELECT min(pending_at) FROM unapplied)))*1440,0)) oldest_unapplied_age_minutes;
