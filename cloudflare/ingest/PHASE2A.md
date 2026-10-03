# Phase 2A — actual Plus / Plugin / MCP acceptance

Date: 2026-10-01, Asia/Shanghai. Scope: validate the connection, not AI processing.

## Deployed interface

Dedicated Worker: `uprivate-intelligence-api`.
MCP URL: https://uprivate-intelligence-api.wdhnlx.workers.dev/mcp
Accepted deployment: `16efc1ae-658e-4585-9cae-a26f015f38f1`, deployed
2026-10-01T15:26:32.890Z. Final same-source redeployment: `26cac28a-7664-4c4e-a10d-e0a9aeb150c8`.
Earlier read-only deployment was accepted before enabling
the write probe. This Worker shares D1 `uprivate-intelligence`, has a dedicated
OAuth KV, and does not consume ingestion/processing queues or call a model API.

Official MCP SDK provides stateless Streamable HTTP. Maintained Cloudflare OAuth
provider supplies OAuth 2.1, PKCE S256, CIMD, dynamic registration and protected
resource metadata. The dedicated single-owner login key is a Worker secret,
independent of ingestion ADMIN_TOKEN; never commit it. Access tokens last one
hour and refresh grants 24 hours. This is an acceptance login, not a general
multi-user identity system. Key rotation alone does not revoke issued grants.

Tools: `get_processing_batch(limit, statuses?)`, `get_article(id)`, and, only
after successful Plus reads, `save_processing_probe(article_id, note, run_id)`.
Read tools use fixed parameterized SELECTs on articles joined to sources.
Batch defaults to five new articles; maximum 20. Summary 2000 characters,
JSON data 120000 bytes, MCP request 8192 bytes. Strict schemas reject unknown
arguments and SQL-shaped ids. The read endpoint does not claim work.

The probe requires separately consented `probes:write`, uses INSERT OR IGNORE
only on `processing_probes`, checks an existing article and rejects conflicting
run IDs. Same inputs are idempotent. Migration `0006_phase2a_probes.sql` adds
only this test table/index. Production article fields are never updated.

Native limits are 60 requests/minute per IP plus per authenticated owner,
approximate and local to Cloudflare locations. A real burst observed HTTP 429
on request 62. Unauthenticated/invalid token MCP returned 401, hostile Origin
403, oversized body 413. The read-only OAuth grant was denied probe writes.

Discovery: `/health`, `/metadata`, `/plugin.json`, `/manifest.json`, `/mcp.json`,
`/.well-known/oauth-protected-resource/mcp` (plus root alias), and
`/.well-known/oauth-authorization-server`. Discovery exposes no article data.
Portable metadata does not imply public plugin approval or installation.

## Actual account evidence

The browser visibly showed Derek Wang, Plus. Personal **Create MCP App** was
available, the connection used OAuth, and the development plugin was installed:
https://chatgpt.com/plugins/plugin_asdk_app_6abe77e5dfa88191bfee276a2deed423

Acceptance chat: https://chatgpt.com/c/6abe7a3f-eb84-83ea-aeef-38df754b25ae

1. **Interactive read passed.** ChatGPT Work actually called batch with limit 3,
   statuses `["new"]`, then article using the first real id. The returned Unitree
   SDK2 records matched independent official-SDK acceptance. First id:
   `0dbb5c75-4b81-43b8-8602-e48f593aed26`, title `v1.0.0-Go2非融合运控版本`,
   source `Unitree SDK2 Releases`, canonical URL
   https://github.com/unitreerobotics/unitree_sdk2/releases/tag/1.0.0.
   These are first-import backfill records (`is_backfill=1`, `publish_eligible=0`),
   not newly published news or completed analysis.
2. **Interactive write passed after the read gate.** Refresh tools exposed the
   third tool. Read-only credentials triggered OAuth step-up; consent explicitly
   included `articles:read probes:write`. ChatGPT then saved run id
   `phase2a-plus-interactive-20261001` at `2026-10-01T15:33:03.980Z`, caller
   `https://chatgpt.com/oauth/client.json`. A direct D1 SELECT independently
   confirmed the row. Compared before/after: processing status new, prefilter,
   both scores, final score and event id null, updated_at unchanged.
3. **Scheduled unattended read/write passed.** Only after the successful
   write, a real Plus one-shot Scheduled Task was created for
   `2026-10-01T15:40:27Z` (23:40:27 Beijing), referencing this plugin and the three
   calls in order. Run id `phase2a-plus-scheduled-20261001`. The task completed with all three calls and no human approval during the run.
   D1 independently confirms its receipt at `2026-10-01T15:43:09.556Z`; article
   fields remain unchanged. Trigger-to-write delay was about 2 minutes 43 seconds.
   The one-shot task is Completed with no next run. This is one successful run,
   not evidence of durable unattended processing beyond OAuth grant expiry.

## Verification and boundaries

`npm ci --ignore-scripts`, typecheck and all 9 intel-api tests passed; latest
ingest typecheck and all 18 existing tests also passed. Live official-SDK read
acceptance is separate from the actual Plus client evidence. Test files are in
`acceptance/phase2a-*.json`; no token, owner key or cookie is included.

Production already had migration 0005 and 81 ai_runs / 80 task_receipts from
another task before this verification. PR #2 advanced concurrently from
60b0885 to 2a7ca6d, which already contains that Phase 2 skeleton. Those changes
and records are preserved, not claimed as Phase 2A work. This task added no
processing pipeline, paid model integration, scoring or Phase 2B feature.
PR #2 remains Draft and unmerged. Existing root topic-seed/Docker CI failures
are described in the prior PR record; they are outside this API change.

## Official references checked

- [Plugin quickstart](https://developers.openai.com/plugins/quickstart)
- [Authenticated MCP / OAuth](https://developers.openai.com/plugins/build/auth)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Portable plugin manifests](https://developers.openai.com/plugins/build/plugins)
- [ChatGPT automations](https://learn.chatgpt.com/docs/automations)
- [Cloudflare OAuth provider](https://github.com/cloudflare/workers-oauth-provider)

No entitlement blocker was observed for interactive read or probe write on this
specific Plus account. This observation is not a guarantee for every account,
future entitlement or long-running unattended processing. Scheduled support
must be judged from the actual task run, not inferred from documentation.
