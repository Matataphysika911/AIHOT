# Phase 2 — Intelligence Layer

Phase 2 skeleton is deployed; real-model acceptance is **pending provider configuration**. Mock scores are fixtures and never populate production article decisions. Phase 1 ingestion remains active. PR #2 must remain Draft.

## Pipeline and compatibility

Separate `uprivate-processing-jobs` Queue / DLQ. Quarter-hour Cron first dispatches source ingestion, then independently recovers processing tasks and schedules at most ten new publish-eligible articles. D1 is the durable outbox: if Queue publication fails, a later Cron republishes the pending task. Manual processing can include historical articles; backfill/ineligible articles never become selected.

Tasks: `pending → running → completed`, with `retry`, `failed`, and `unknown` branches. Ten-minute compare-and-set leases prevent concurrent duplicate consumption. Stage order is prefilter → score A → score B → structure. BLOCK stops before scoring; PASS and UNKNOWN continue. Tiers without configured thresholds skip scoring and remain unrated.

Each scoring call has only the original article snapshot, the same rubric, and a separate receipt identity. Neither receives the other's response. Weighted totals are computed by code using robotics/scoring.v1.md: impact 25%, robotics 20%, SoC 20%, commercial 15%, novelty 10%, credibility 10%. Selection uses the exact sum against twice the source threshold: T1 60, T1_5 65, T2 76. Displayed final score floors the mean. Unselected eligible articles with mean >50 are near-selected. Existing thresholds are retained, not claimed calibrated for robotics.

Structure stores category, tags, companies, a fact frame with evidence, robotics relevance, SoC relevance, commercial signal, what happened, why it matters, and follow-up signals. Categories/tags use the canonical industry vocabulary. Model output must pass schema validation. Source-supported facts and analytical implications are explicitly separated in the prompt; undisclosed parameters must remain 未披露. Inputs consist of the Phase 1 title, summary, URL, publication date and source facts; no unlicensed fulltext fetch is added. Sparse summaries limit real-model accuracy and should favor UNKNOWN.

## Provider, prompts and audit

`IntelligenceProvider` has `name`, `model`, and `invoke`; the initial live adapter uses HTTPS OpenAI-compatible `/chat/completions`. GLM may use the same adapter if the chosen endpoint supports the request format. There is no usable GLM/API credential in this deployment, and no provider-specific API quota has been verified. ChatGPT subscription is not used as an API credential.

Prompt version `robotics-intelligence.v1` plus the full revision SHA bind each task to prompt content, taxonomy, thresholds, provider, model and base URL. Committed snapshots of analysis.v1.md, scoring.v1.md, taxonomy.ts and selection.ts are checked against the canonical files in tests. Update snapshots and bump the readable version when evolving prompts. Configuration drift pauses existing tasks; enqueue a new revision rather than reuse an old provider receipt.

Task identity is article ID + mode + revision + input hash. `task_receipts` uniquely stores each stage; `ai_runs` stores each provider attempt, raw output, status, error, usage and latency before the final business update. Successful receipts and received responses are reused after interruption. Mock mode is isolated and never writes article processing/selection fields.

A 429 is retryable. Transport interruptions, timeout/408, 5xx and interrupted pending calls become unknown, since they may have been billed. They are not automatically resent. Schema failures retain the raw response and require manual retry. Paid calls reserve atomic budget slots before invocation: default 20/hour and 100/rolling 24h, counting attempts. Exhausted budgets defer for one hour without consuming the failure attempt limit. This is a request-count circuit breaker, not a currency/token-price estimate. Logical idempotency cannot guarantee exactly-once provider billing when a response is lost; explicit unknown-outcome retry acknowledges this possibility. A provider may ignore the supplied Idempotency-Key header.

## Configuration needed to enable live processing

Set these in the existing Worker:

- Worker secret **INTELLIGENCE_API_KEY** — valid provider API key with available API quota.
- Vars **INTELLIGENCE_BASE_URL** — HTTPS API root ending in `/v1` (adapter appends `/chat/completions`).
- Var **INTELLIGENCE_MODEL** — valid model ID for that provider.
- Optional **INTELLIGENCE_PROVIDER** — audit label; defaults to `openai-compatible`.
- Set **MODEL_CALLS_ENABLED=true** only after the key, endpoint and model are configured.
- Adjust **INTELLIGENCE_HOURLY_CALL_LIMIT / INTELLIGENCE_DAILY_CALL_LIMIT** to the intended request budget.

Do not commit the key. `wrangler secret put INTELLIGENCE_API_KEY` accepts it interactively. Save non-secret vars in wrangler.jsonc and deploy. The current committed/deployed configuration has `MODEL_CALLS_ENABLED=false` and no provider key. Automatic live processing is disabled; authenticated live enqueue returns 503.

## Protected controls

All `/admin/processing/*` routes require the existing `Authorization: Bearer <ADMIN_TOKEN>`.

| Route | Method | Body / query |
|---|---|---|
| `/admin/processing/enqueue` | POST | `{"articleIds":["existing-id"],"mode":"live"}` or `"mock"`; 1–20 IDs |
| `/admin/processing/retry` | POST | `{"taskId":"id"}`; unknown tasks additionally require `"acknowledgeUnknownCost":true` |
| `/admin/processing/task` | GET | `?id=<task-id>`; task and all stage receipts |
| `/admin/processing/metrics` | GET | provider readiness, per-mode statuses, run counts and average latency |
| `/health` | GET | existing ingestion/storage health plus aggregate intelligence health |

Automatic dispatch retries pending/retry/stale-running tasks. A fourth transient provider failure becomes failed; fix the issue then use the protected retry route. Retry retains successful earlier stages. Unknown and permanent failures are acknowledged by the Queue and remain visible in D1. Queue delivery errors still use the processing DLQ. Routine budget waits can outlive Queue delivery retries; D1 Cron recovery remains authoritative.

## Deployment and acceptance

See `acceptance/phase2-2026-10-01.json` for timestamped deployed evidence. Migration 0005 and both Queues are provisioned on the existing account. Source Queue, R2, D1, storage policy, and all three existing Cron schedules remain registered.

Local typecheck and 18 targeted tests pass (9 intelligence, 9 storage). Live provider HTTP behavior is tested with a stub transport: independent A/B requests, 429 recovery, budget exhaustion, raw-response reuse and unknown-outcome safety. These tests do not consume external API quota.

Production dry-run uses ten real Phase 1 snapshots: 4 T1, 3 T1_5, 3 T2. Mock decisions are fixtures, not real AI judgments. Duplicate messages and a controlled structure-stage reset test deployed recovery. Real-model quality, actual provider latency/usage/quota, provider failure recovery, and protected endpoint authentication with the real ADMIN_TOKEN remain pending. Production unauthenticated protection is verified; authorized control behavior is covered locally. Acceptance was seeded using the existing Cloudflare account authorization via the official D1/Queues APIs, without reading/replacing ADMIN_TOKEN.

Root PostgreSQL/web/Docker tests are not part of this isolated Worker validation. Phase 1 deployment docs record a pre-existing root seed/Docker CI failure. Current CI outcomes are recorded after publication. No event grouping, hotness, daily/weekly reports or publication layer was added.

Final deployment version: `3320a135-defd-44e8-b3d8-78477c4d3817`. Final sample baseline has 10 completed tasks / 40 stage receipts / 40 mock attempts; sending the ten messages again leaves all counts unchanged. Controlled structure-stage reset adds exactly one attempt (41 total), retaining both score receipts. All ten production article decisions remain unchanged; `/health` is successful, live provider is disabled, and unauthenticated admin metrics returns 401. An earlier prompt revision has ten additional completed mock tasks preserved for audit; aggregate health therefore shows 20 mock tasks and 81 attempts. This history is not additional real-model acceptance.
