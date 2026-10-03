# uPrivate Robotics Intelligence — Phase 2 optimization

2026-10-03. Functional regression in progress; 24h stability remains pending. PR #2 stays Draft; no merge or Phase 3.

## Architecture and schedules

The chain stays `15min ingestion → immutable facts/R2 → independent Scheduled A/B immutable submissions → Cloudflare deterministic apply`. Reviewer limit stays 5, each task runs every 2 hours in a new chat. Ingestion remains `*/15 * * * *`.

Apply changes from `5,35 */2 * * *` to `*/10 * * * *` (UTC). The old cron has alternating 30/90-minute gaps, so maximum scheduling wait is just under 90 minutes, not two full hours. New maximum is just under 10 minutes, excluding platform delay, execution duration and queue saturation. Faster apply uses no model; it only reduces inbox tail latency. It does not raise AI processing capacity. Existing apply batch cap stays 10.

## Backlog

`GET /health` includes `processing.reviewer_a_pending_count`, `reviewer_b_pending_count`, `oldest_pending_age_minutes`, `pending_apply_count`, `oldest_unapplied_age_minutes`, status and thresholds. Query implementation: `cloudflare/intel-api/src/health.ts`.

A age starts at discovery and excludes submitted articles; B age starts at applied A eligibility and excludes B submissions. Unapplied age starts at submission creation and excludes applied/rejected entries. Overall backlog status takes the greater pending/unapplied age: below 120 min healthy; 120–360 warning; above 360–720 degraded; above 720 critical. Empty queues have age zero. Counts reflect operational eligibility, including backfill under the existing Reviewer rules. Health HTTP 200/ok indicates service readiness; `processing.status` independently indicates backlog health.

## Evidence and frozen versions

Migration `0014_phase2_evidence.sql` only adds `article_evidence`, `mcp_reviewer_runs_v2`, views and triggers; it leaves historical v1 facts/audits/schema untouched. Evidence has one immutable first snapshot per article with source URL, bounded extracted text, method, timestamp, content hash, snapshot hash, status/error, original character count, truncation flag and archive reference. The first successfully persisted concurrent result wins; later reads never refetch or overwrite it.

Canonical HTTPS HTML pages use bounded paragraph extraction from article/main, stripping scripts/navigation/forms. Fetch budget: 8 seconds including up to 3 redirects, 512,000 response bytes; reviewer text capped at 12,000 characters with explicit truncation metadata. Public-fetch Worker restrictions and URL validation prevent private network requests. Raw fetched HTML is archived under the existing R2 bucket `evidence/<article>/<html-sha256>.html`. The ingestion R2 key is retained in the evidence snapshot. arXiv abstracts and summaries ≥1,500 characters avoid another fetch. Fetch/extraction failures freeze original summary as fallback, never blocking ingestion. Batch reads may append evidence, honestly reflected in MCP annotations; the cron also materializes up to 5 pending articles independently of ingestion.

Frozen v2: `robotics-plus-mcp.phase2-optimization.v2`, with `src/prompts/evidence.v2.txt`. V1 analysis/scoring files, weights, taxonomy and final policy are unchanged. A/B use the same immutable evidence hash; the v2 input hash commits to original fact JSON, complete bounded evidence metadata/text and prompt version. The stored fact preimage stays intact for existing database stage guards. V1 in-flight B reviews retain the parent's v1 fact-only hash/version; old exact submissions/applies remain replayable.

Structure adds optional `facts`, `inferences`, `unknowns` arrays to the existing schema. V2 B submissions require all three. No existing field changes. Missing TOPS, power, memory/capacity/bandwidth and ASP must be marked 未披露; common knowledge cannot fill missing numerical specs. B exposes no A scores/reasons/dimensions/run/context/receipt. Identity claims remain un-signed and need actual separate execution evidence.

## Root CI repair

Topic packs can omit tags on entity-based company topics. `seedTopics` now types tags as optional and binds `tags ?? []`, matching the existing database type and existing `related ?? []` pattern. Existing tags remain unchanged; company matching still derives `entity:<entity_id>`. No unrelated refactor. Local PostgreSQL/Docker are unavailable; actual GitHub CI will establish backend/smoke/Docker results.

## Acceptance

See `acceptance/phase2-optimization-2026-10-03.json` for deployment/migration, three fresh article regressions, evidence samples, immutable-fact comparisons, idempotency/blindness, CI and limitations. This document will be finalized with actual observed results.
