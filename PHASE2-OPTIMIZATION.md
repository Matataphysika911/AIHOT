# uPrivate Robotics Intelligence — Phase 2 optimization

2026-10-03. Architecture-internal optimization deployed and functional regression passed; 24h stability remains pending. PR #2 stays Draft; no merge or Phase 3.

## Architecture and schedules

The chain stays `15min ingestion → immutable facts/R2 → independent Scheduled A/B immutable submissions → Cloudflare deterministic apply`. Reviewer limit stays 5, each task retains its 2-hour schedule and independent A/B execution context. Ingestion remains `*/15 * * * *`.

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

Topic packs can omit tags on entity-based company topics. `seedTopics` now types tags as optional and binds `tags ?? []`, matching the existing database type and existing `related ?? []` pattern. Existing tags remain unchanged; company matching still derives `entity:<entity_id>`. No unrelated refactor. Local PostgreSQL/Docker are unavailable. On implementation commit `c22f655e47620c9ec596969789089d43fa7baef1`, GitHub topic seeding, site smoke, typechecks/web build/31 web tests and Docker build/start/seed/smoke passed. Cloudflare Ingest CI also passed. Root Check as a whole is **not green**: backend tests produced existing prompt/analysis assertions and repeated 120-second timeouts, then the 25-minute job timeout cancelled it. No unrelated backend or industry-prompt refactor was attempted. Real log excerpt is preserved in `acceptance/phase2-optimization/root-check-excerpt.log`.

## Acceptance

See `acceptance/phase2-optimization-2026-10-03.json` for deployment/migration, three fresh article regressions, evidence samples, immutable-fact comparisons, idempotency/blindness, CI and limitations. Detailed observed results follow.


## Deployed and observed results

D1 migration `0014_phase2_evidence.sql` succeeded through the normal migration runner (11 commands, 3.79 ms). Initial remote migration attempts rolled back on SQL parser errors; trigger guards were rewritten with equivalent `SELECT RAISE ... WHERE` syntax. No manual migration-ledger write or old-table rebuild was used. Worker final version is `27123e31-7ce3-4c62-8115-85e31e006f4c`; initial evidence/scoring rollout was `4253c312-3e0a-4879-a86f-7f09cf691c43`. The final adjustment only makes A batch `read_only=false` metadata honest about evidence materialization; B remains read-only.

| Fresh article / source | Evidence | Summary → evidence chars | A | B | Final | Tier threshold | Selection |
|---|---|---:|---:|---:|---:|---:|---|
| PReFlow / arXiv | arxiv_abstract fallback, no fetch error | 1,421 → 1,421 | 63.55 | 64.35 | 63 | 65 | near-selected |
| Boston Dynamics humanoid hand / Robot Report | canonical fetch 403; immutable summary fallback | 370 → 370 | 46.50 | 57.25 | 51 | 76 | near-selected |
| Ambarella AI Infrastructure Summit / company page | extracted HTML paragraphs, raw HTML in R2 | 674 → 6,598 | 90.55 | 92.90 | 91 | 60 | selected |

The existing deterministic policy truncates the mean to an integer for `final_score`, while selection compares the unrounded sum against twice the tier threshold; mean >50 otherwise becomes near-selected. It is unchanged. All three finished `completed`. All totals were recomputed from dimensions and all structures contain facts/inferences/unknowns. Ambarella explicitly labels N1-655/X7 TOPS, power, memory and ASP as 未披露, while retaining disclosed product/demo facts.

Actual A conversation: https://chatgpt.com/c/6ac09107-4008-83e9-9847-3414fd339aec . Actual B conversation: https://chatgpt.com/c/7b29e64d-584c-832c-9ef7-6950568cc1aa . Existing Scheduled task IDs remain unchanged. These were manual `Run now` functional checks; B attached to its existing B-only conversation, separate from A. Identity claims are not signed platform attestation. This does not establish fresh-chat-per-recurring-run behavior or 24-hour stability.

Both roles reported first insert=true, exact identical replay insert=false, and post-submit article batch count=0. Durable D1 holds exactly one immutable v2 submission per role/article. A's automatic apply occurred around 05:31 UTC (~8m13s after submission); B's around 06:20 UTC (~2m49s–3m09s after submission). Platform execution delay explains that actual applies need not occur at exactly minute 0. A D1 checkpoint after all B submissions and before B apply showed no score_b, structure or final_score. Cron alone then applied/finalized. Six admin apply replays returned inserted=false; production rows remained identical. No root agent or SDK generated production judgments.

All 711 original fact snapshots and ingestion fact fields remained identical. Historical 65 stage receipts, 10 reviewer audit rows, 8 submissions and 8 application records remained identical. The additive schema also passes legacy exact-replay tests. A/B submission input hashes match per article and independently verify against original facts + the same stored evidence hash + v2 version. Full B SDK projection exposes no A output and rejects cross-role/generic endpoints with 403. Post-final SDK reads confirm all six cohort batches are empty. The Ambarella R2 HTML object was downloaded read-only and its SHA-256 verified against its key.

Final `/health` observation: A pending **696**, B pending **0**, pending apply **0**, oldest pending **2,424.10 min (~40.4h)**, oldest unapplied **0**, processing status **critical**. This is operational backlog, not a claim that service readiness is failing. With two-hour, limit=5 A runs, theoretical maximum A throughput is 60/day before BLOCK/failed-run effects. Faster apply does not drain Reviewer backlog faster. No batch expansion or hourly task was created. Standalone D1 query: `acceptance/phase2-optimization/backlog.sql`.

Local validation passed: root typecheck, web build/31 tests, ingestion typecheck/18 tests, intel API typecheck/40 tests. Root Check run [37099331372](https://github.com/Matataphysika911/AIHOT/actions/runs/37099331372) retains the backend blocker; its Docker job passed. Cloudflare run [37099331384](https://github.com/Matataphysika911/AIHOT/actions/runs/37099331384) passed. Final documentation commit may start a new run; these results are explicitly tied to the implementation SHA above.

## Known limits and follow-up boundary

HTML extraction is bounded paragraph extraction, not browser rendering: it skips JavaScript, PDFs, paywalls and may miss tables or leave boilerplate. Fetch failures freeze summary fallback for v2; later evidence improvements require a new snapshot/version design instead of overwriting it. First persisted concurrent snapshot wins; unused losing raw HTML objects can remain in R2. All live samples were non-truncated; over-limit truncation, safety/failure fallback and concurrency/immutability are covered by regression tests.

The first A run encountered ChatGPT's cached v1 schema and safely stopped before review submission. Refreshing existing A/B plugin tools, without changing permissions/scopes/accounts, resolved it. B's first invalid taxonomy tag was rejected without insertion; only the tag was corrected, with unchanged score. Internal ChatGPT tool traces were not available for export; saved run reports are cross-checked with live SDK projections, database submissions/receipts and real cron applications.

A/B durable production prompts were restored to limit=5, two-hour schedules and v2 evidence input (row-version handling for legacy in-flight reviews). No AGNES/OpenAI/GLM/paid model API was called. **24h recurring/OAuth stability stays pending**, to be accepted separately; PR #2 stays Draft, without merge or Phase 3.
