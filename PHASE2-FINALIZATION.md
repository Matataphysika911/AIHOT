# uPrivate Robotics Intelligence — Phase 2 Finalization

2026-10-03 · **functional complete / pending 24h stability acceptance**

Repo: `Matataphysika911/AIHOT`; branch: `feat/cloudflare-ingestion-v1`;
[PR #2](https://github.com/Matataphysika911/AIHOT/pull/2) remains Draft. No merge, Phase 3, or paid model API call.

## Production chain

`15min ingestion → immutable facts → Scheduled A append-only inbox → Worker apply A → independent Scheduled B blind inbox → Worker apply B/finalize`

- A's `processing:a` endpoint exposes batch/own receipt/validate/probe/submit. B's `processing:b` endpoint exposes batch/own receipt/submit. Neither endpoint exposes legacy direct production writers. Opposite-role and generic legacy endpoints reject these scopes with HTTP 403.
- Batch dedup runs before LIMIT, keyed by role, frozen prompt version and exact immutable snapshot preimage/hash. Already submitted articles are excluded before model scoring. Own-role receipt lookup returns the persisted full submission for exact retry, never another reviewer's output. Concurrent same-key conflicts remain guarded rather than overwriting.
- A appends prefilter and score A. B appends `score_b` and frozen-taxonomy `structure`. Both submit methods validate schema, arithmetic, identity and current immutable facts and leave production articles untouched.
- B reads only the original fact allowlist, source tier, snapshot hash and frozen rubric/taxonomy. Its input and own receipt exclude A scores, reasons, dimensions, receipt, run/context and production fields. B eligibility requires an applied A submission and score; A output is used only by the Worker as an eligibility predicate and is never projected into B's response.
- Worker apply validates role/version/snapshot/payload hash, caller/run/task/context ownership and stage order. B additionally requires distinct A/B task, context and reviewer-run claims. A writes only prefilter/score A; B atomically appends its audit and score B/structure/finalize receipts. D1 triggers under the Worker transaction compute final score and selection. Replay is idempotent.
- Frozen policy remains `robotics-plus-mcp.phase2b1.v1`. BLOCK omits score and A apply completes it as blocked; B is never scheduled. UNKNOWN retains scoring under the frozen rule and proceeds to B only with valid applied A score. No speculative policy change was introduced.
- Migration `0013_phase2_finalization.sql` preserves old rows and extends append-only submissions to A/B; applications, task receipts and reviewer identity audits retain update/delete guards. The new snapshot hash is included in task receipts. Old immutable receipts retain their original values, including null hash where historically absent.

## Real cloud acceptance

Three articles were `processing_status=new`, had no old processing run, and do not overlap the prior cohort. Native **Run now** initiated the first unattended execution of each recurring cloud task. The model performed actual MCP reads and appends without interactive confirmation; Cloudflare admin apply committed each stage. This verifies unattended functional execution, not timer recurrence or 24h OAuth stability.

| Article | A | B | Worker final | T2 threshold | Selection |
|---|---:|---:|---:|---:|---|
| Omron LD mobile robots · `41bdac0f-0c56-4bcf-952d-f470ec3652b2` | 65.25 | 62.75 | 64 | 76 | near-selected |
| Eli Lilly / Purdue HRI · `70b5dfb3-ba39-4398-a3d8-5219bcaa0e03` | 48.25 | 47 | 47 | 76 | not-selected |
| Runway Praxis-1 · `ac7f4aae-f0ca-4b32-b89e-91383c2b091f` | 80.15 | 78.15 | 79 | 76 | selected |

The frozen final calculation truncates `(score_a + score_b)/2` to integer. Selection compares the unrounded mean to the tier threshold (T1 60, T1_5 65, T2 76), with near-selected when mean >50. All three are completed; factual fields and all 711 immutable factual snapshots are unchanged. Only the three target articles' processing fields and `updated_at` changed.

Actual task and execution evidence:

| Role | Scheduled task ID | Actual independent execution chat |
|---|---|---|
| A | `6ac07c07cb5c8190b8238e9d95c8b10c` | [A execution](https://chatgpt.com/c/6ac07c72-0a78-83e9-bc37-86ce8e11f832) |
| B | `6ac07cb2412c81908345a3e2b801d90f` | [B execution](https://chatgpt.com/c/6ac07dac-5950-83ea-b560-015c02eea2ef) |
| A repeat | same A task | [Independent dedup execution](https://chatgpt.com/c/6ac081fb-5a9c-83e9-94ac-44d7e2e67e73) |

D1 records distinct A/B context and reviewer-run claims; observed actual chats independently substantiate context separation. Claims are not platform-signed identity. B was never given the A execution transcript or A scores through its prompt.

| D1 checkpoint | Articles | Runs | Receipts | Reviewer runs | Submissions | Applications |
|---|---:|---:|---:|---:|---:|---:|
| Before | 711 | 10 | 47 | 3 | 1 | 1 |
| After A submit | 711 | 10 | 47 | 3 | 4 | 1 |
| After A apply | 711 | 13 | 53 | 6 | 4 | 4 |
| After B submit | 711 | 13 | 53 | 6 | 7 | 4 |
| After B apply | 711 | 13 | 62 | 9 | 7 | 7 |

Full-table comparisons show A/B submit changed no production article, run, receipt or application. Existing audits remain byte-for-byte represented in final snapshots. Exact submit replays returned `inserted:false` in actual execution messages; each role/article has one immutable submission. All six admin applies replayed with `inserted:false`. An independent A cloud rerun returned `count=0` for all three and called no scoring/submit tool, producing no submission conflict.

B initially supplied weighted total 62.25 for the Omron dimensions; the validator returned `weighted_total_mismatch`, `expected_total:62.75` before insertion. Correcting only arithmetic succeeded. This was schema validation, not platform safety rejection. No platform safety block occurred and no permissions were widened.

B-blindness is substantiated by the allowlisted response implementation, isolation tests, actual B execution summaries and a full live official-MCP-SDK B response for a separate existing applied-A article. ChatGPT's retrieved chat messages expose summaries, not the full underlying raw MCP tool trace; the SDK response must not be presented as that missing cloud trace. Acceptance JSON identifies this limitation and keeps the external chat evidence.

## Production schedule: 2 hours

Both actual cloud recurring tasks are active, each run in a new chat; their acceptance-only article restrictions were replaced by durable role-specific production prompts with `limit=5`, own immutable receipt reuse and safety-stop instructions.

- A: Custom hourly **interval 2**, minute 0; observed next run 2026-10-03 14:00 Asia/Shanghai.
- B: Custom hourly **interval 2**, minute 25; observed next run 2026-10-03 12:25 Asia/Shanghai, then 14:25 under the 2h cadence.
- Worker deterministic apply: `5,35 */2 * * *` UTC, after the normal A and B windows. Pending submissions remain durable if a run completes after that window and are picked up by the next apply tick. Admin apply remains available for deliberate recovery.
- Ingestion remains `*/15 * * * *`; access-token TTL and refresh-grant TTL remain unchanged.

两小时替代未来每小时评审：降低重复评审与触发噪声、配合采集节奏、节省 Scheduled Task 预算，同时对机器人新闻时效足够。No hourly reviewer task was created. The B detail header intermittently displayed a stale Daily label; the actual editable controls and saved task table showed Custom/interval 2/minute 25. Long-term timer behavior remains a separate acceptance gate.

## Deployment and validation

- Acceptance Worker: `63533940-c187-4be2-bfc7-78c4e77f8af5` (cron temporarily disabled for controlled before/after snapshots).
- Final production Worker: `c5376714-6769-48d0-b13b-1f8add74e65d`; Wrangler confirms `5,35 */2 * * *` triggers deployed. AGNES is disabled. Deployment had one transient network failure; retry succeeded.
- D1 migration 0013 applied. Historical 0012 existed in D1 but lacked a migration-ledger entry; its schema was checked against committed SQL, ledger reconciled, then 0013 applied. No old business/audit rows were replaced semantically.
- Local root typecheck, web build and 31 web tests passed; ingestion typecheck and 18 tests passed; intel-api typecheck and 36 tests passed. Relevant tests cover dual apply/replay, blindness, dedup-before-LIMIT, rollback, distinct identity, BLOCK/UNKNOWN and historical migration preservation.
- Cloud Ingest CI on `cd5b6dafb19d574b4b8137a674170654a7c9a75d`: [passed](https://github.com/Matataphysika911/AIHOT/actions/runs/37095089680).
- Root Check on that commit: [failed](https://github.com/Matataphysika911/AIHOT/actions/runs/37095089681) at the existing topic seed `UNDEFINED_VALUE` issue (topics lacking tags); Docker setup failed at the same seed error; smoke was skipped. Backend/smoke are not claimed passed. Local PostgreSQL was unavailable. PR remains Draft with these limitations visible.

Final code/config commit `ada0cf3fb7cfdbee912f51f0d231d4f7c1276c91`: [Cloud Ingest CI passed](https://github.com/Matataphysika911/AIHOT/actions/runs/37096531742); [Root Check failed](https://github.com/Matataphysika911/AIHOT/actions/runs/37096531732) at the same existing seed defect.

Machine-readable evidence: [acceptance/phase2-finalization-2026-10-03.json](acceptance/phase2-finalization-2026-10-03.json), including cohort before/after rows, immutable A/B payloads, hashes, identities, new task receipts/application audit, apply responses, SDK B response, schedule prompts/config and CI. Separate execution-message snapshots preserve actual A/B/repeat chat evidence without credentials.

## Separate remaining gate

**24h OAuth / timer-triggered recurring stability acceptance is pending**, as requested. A later independent run must observe the real 2h cadence, refresh behavior, inbox/apply backlog and continued dedup for at least 24 hours. This phase does not certify 24h stability, introduce Phase 3 or merge PR #2.
