# Phase 2B — actual ChatGPT Plus / Scheduled / MCP processing

2026-10-02, Asia/Shanghai. **Partial pass. Do not mark Phase 2B fully accepted:**
the real write pipeline, unattended run, idempotency and immutable-field checks
pass; strict A/B reviewer context independence does not pass.

## Actual account execution

Existing personal plugin and Worker were reused:
https://uprivate-intelligence-api.wdhnlx.workers.dev/mcp
Final deployment: `e715fa79-4275-469a-bfc7-27697177daa6`.
Interactive acceptance chat:
https://chatgpt.com/c/6abf2f4b-b270-83ea-a197-f8550f73d789
The visible Plus chat model was GPT-6.1 Sol. Scheduled model identity is not
independently inferred from that label; actual execution used the Plus cloud
Scheduled task and original MCP, with no external model API.

1. Original connection displayed “connection has expired.” Normal Reconnect
   requested `articles:read probes:write processing:write`. After the user
   explicitly confirmed the expanded scope, the existing owner credential
   completed normal OAuth. No credential is included in committed evidence.
2. One real article (`02f5e9d8…`) was read and actually processed by Plus:
   Prefilter PASS, A=66.05, B=63.05, Structure, finalize. D1 confirms five unique
   stage receipts from 04:28:14 to 04:29:23 UTC. Identical full-stage replays
   returned saved=true/inserted=false; no extra receipt was inserted.
3. A genuine cloud one-shot task, **Phase 2B 四篇无人值守验收**, was created:
   `6abf33d42f3881918cfa23a24f427fbb`.
   https://chatgpt.com/scheduled?automationId=6abf33d42f3881918cfa23a24f427fbb&automationSource=cloud
   Saved trigger: 12:35 Asia/Shanghai / 04:35 UTC, Repeat disabled. Native UI
   now shows **Completed** with no next run. Actual task output confirms policy,
   new-article batch and individual article reads, then 20 first writes and
   20 identical replays across four real articles, without human confirmation,
   OAuth interruption, SDK substitution, web search or paid model API.

| Article | A | B | Final display | Selection |
|---|---:|---:|---:|---|
| Interactive tactile sensing | 66.05 | 63.05 | 64 | near-selected |
| FuncBridge | 72.20 | 68.90 | 70 | selected |
| Large Reward Models | 74.95 | 71.55 | 73 | selected |
| RADMCS | 66.45 | 63.25 | 64 | near-selected |
| GlassGuard | 78.00 | 74.70 | 76 | selected |

All five are T1_5. Source-tier selection retains original T1=60, T1_5=65,
T2=76 and A+B>=2*threshold; display score=floor(mean), mean>50 near-selected,
and prior eligibility/unrated semantics. D1 independently confirms all five
completed, five runs and exactly 25 unique receipts. Every six-dimension total
and finalized score/selection was independently recalculated.

Before/after comparison shows only nine allowed processing fields changed:
processing_status, prefilter_status, score_a, score_b, final_score, updated_at,
intelligence_revision, selection_status and structure_json. All ingestion
facts, source references, canonical_url, url_hash, content_hash, raw_r2_key,
backfill/eligibility fields, dates and event_id are unchanged.

## Implemented controls

Both original reads and the isolated probe are preserved. New read
`get_processing_policy` serves byte-identical original
`industry/robotics/prompts/analysis.v1.md` and `industry/robotics/scoring.v1.md`,
plus frozen `robotics-plus-mcp.phase2b.v1` contract, taxonomy and thresholds.

Production tools are exactly `save_prefilter`, `save_score` (A/B),
`save_structure`, `finalize_processing`. Strict schemas, bounded inputs and
fixed parameterized operations expose no arbitrary SQL or source/raw editing.
Production requires separately consented `processing:write`; read/probe scopes
cannot write decisions. Final deployment additionally restricts production
writes to the real ChatGPT OAuth client metadata identity.

Additive migration 0007 supplies equivalent audit tables/views:
`mcp_processing_runs`, `mcp_task_receipts`, `mcp_ai_runs`. Exclusive new-state
claim, run/article/client/version binding, exact factual snapshot checks and
stage order are enforced by transactional SQL triggers. Each stage receipt and
article update commit atomically. Identical replays do not insert new records;
conflicting content/owners, changed facts and incomplete stages fail closed.
BLOCK can finalize directly. Interrupted work resumes with the same run/client;
no arbitrary reset/takeover tool is exposed. Existing API-provider audit is
preserved. Native task replay was not triggered again; the **complete five-stage
sequence** was replayed per article inside each actual run.

New Scheduled runs record provider `ChatGPT Plus Scheduled/MCP`; runtime labels
are explicitly declared claims and need native Scheduled/D1 evidence. The
interactive run and first two Scheduled claims occurred before the final label
rollout, retaining immutable `ChatGPT Plus/MCP` with Scheduled runtime_claim.
Those records are mapped to this actual completed task, never rewritten as if
a different deployment created them. Neither provider is an API provider.

## Validation and limits

Intel API typecheck + 14 tests, ingest typecheck + 18 tests, root typecheck,
web build and 31 web tests pass. Tests use real SQLite migrations/triggers and
cover complete flow, concurrent idempotency, competing runs, wrong client/run,
missing stages, changed facts, weighted totals, BLOCK, eligibility and all tiers.
Prompt-copy checks pass. Official-SDK live read/discovery, read-scope production
write rejection, probe-scope rejection, 401/403/413 and arbitrary-SQL rejection
pass; SDK checks are separate from real Plus processing.

Live ingest health independently shows providerConfigured=false,
liveEnabled=false, with exactly 81 pre-existing successful **mock** ai_runs.
No OpenAI/GLM key was configured and no paid model API was called by this task.
Backend PostgreSQL tests/app smoke were not run because no local PostgreSQL,
Docker or running app was available. Cloud Ingest CI passed on code commit `3592d58`, runs
36965933509 and 36965929482, including intel-api and ingest jobs. Root Check
run 36965933553 still fails both check/Docker at the previously documented
`UNDEFINED_VALUE`, `packages/backend/src/publication/topics.ts:43`; downstream
backend/smoke checks are skipped. The error was verified in both actual logs.

**Strict double-review independence is not passed.** Both real interactive and
Scheduled outputs disclose that A/B were evaluated in the same conversation.
Distinct score slots and separately reasoned scores do not prove isolation from
prior scores. The limitation is retained in score reasons and acceptance JSON.
A full pass requires separate reviewer contexts using only the original article
and rubric, demonstrated in actual unattended Plus execution. No paid-model
fallback was used to conceal this limitation.

OAuth access TTL remains one hour and refresh-grant TTL 24 hours. Reconnection
resolved the observed expired-connection prompt; its exact cause was not proven.
This successful run does not prove durable unattended renewal beyond 24 hours.
Also preserve a timing discrepancy: the first Scheduled D1 receipt is 04:34:06
UTC, 54 seconds before the saved 04:35 trigger. Exact scheduling precision was
not accepted; no clock/skew cause is guessed.

Machine-readable result: `acceptance/phase2b-2026-10-02.json`, with supporting
D1 snapshots, runtime output/config, SDK and live-health evidence.
No Event Grouping/Hotness/Daily/Weekly was started. PR #2 stays Draft/unmerged.
Official Scheduled guidance consulted: https://learn.chatgpt.com/docs/automations

## Optional AGNES follow-up (2026-10-02)

The user subsequently authorized optional AGNES API as independent score B with
Plus score A and a Plus fallback. This does not alter the original no-API cohort.
See [PHASE2B-AGNES.md](./PHASE2B-AGNES.md) and
[phase2b-optional-agnes-2026-10-02.json](./acceptance/phase2b-optional-agnes-2026-10-02.json).
Connectivity for AGNES 2.5 passed, but actual frozen-rubric scoring currently
returns HTTP 429, including after its prior Retry-After elapsed. Independent
A/B acceptance and new unattended AGNES validation remain incomplete.
