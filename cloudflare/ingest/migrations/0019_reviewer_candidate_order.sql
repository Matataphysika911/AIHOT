CREATE INDEX IF NOT EXISTS idx_reviewer_a_candidates_order
ON articles(discovered_at DESC,id ASC)
WHERE processing_status='new' AND intelligence_revision IS NULL
AND prefilter_status IS NULL AND score_a IS NULL AND score_b IS NULL;
CREATE INDEX IF NOT EXISTS idx_reviewer_b_candidates_order
ON articles(discovered_at DESC,id ASC)
WHERE processing_status='processing' AND prefilter_status IN ('PASS','UNKNOWN')
AND score_a IS NOT NULL AND score_b IS NULL;
