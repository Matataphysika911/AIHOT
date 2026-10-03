-- Optional standalone scoring diagnostics never create production stage receipts.
ALTER TABLE mcp_provider_probes ADD COLUMN stage TEXT NOT NULL DEFAULT 'prefilter'
 CHECK(stage IN ('prefilter','score_b'));
ALTER TABLE mcp_provider_probes ADD COLUMN article_id TEXT;
ALTER TABLE mcp_provider_probes ADD COLUMN input_json TEXT;
ALTER TABLE mcp_provider_probes ADD COLUMN validated_output TEXT;
