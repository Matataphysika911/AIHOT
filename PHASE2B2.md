# uPrivate Robotics Intelligence Phase 2B.2 — 2026-10-02

The write-risk boundary experiment passed L0/L1/L2/Apply. Operational acceptance is **partial**: the native L2 task executed an additional review and returned `submission_conflict`. Phase 2 remains open, PR #2 remains Draft, and Phase 3 has not started. No AGNES, OpenAI API, GLM API or paid model API was used.

## Observed results

| Gate | Result | Real cloud automation ID | Evidence |
|---|---|---|---|
| L0 | PASS | `6abfb7adeca8819083ffe1a9fe81ad05` | Pure validation returned `valid:true` twice with the same arguments; no writes |
| L1 | PASS | `6abfb8178e2081909938e32aee89f5e9` | Isolated probe +1; exact cloud replay returned `inserted:false` |
| L2 write boundary | PASS | `6abfb8bc606c819094c8fe006d42f56b` | Real unattended cloud insertion +1 at 14:10:23 UTC; all production rows unchanged |
| Apply | PASS | Owner/manual admin endpoint | At 14:23:52 UTC deterministic apply succeeded; exact apply replay returned `inserted:false` |

Actual execution chats: [L0](https://chatgpt.com/c/6181a29e-e788-8333-8dc4-1455b83eb970), [L1](https://chatgpt.com/c/fbc15833-5614-8323-b93c-9877b0a03e31), [L2](https://chatgpt.com/c/3476c88e-a888-8331-8920-dc2f3cc4fa05). All three UI statuses eventually read **Completed · Last run Today**. Completion alone is not a success claim: L2's latest native execution failed with an application conflict.

The three ChatGPT cloud one-shots used the same Reviewer A prompt template, article, frozen policy and input, with only tool and audit identities varied. Each was configured for 2026-10-02 22:15 Asia/Shanghai with Repeat off and Start each run in new chat on. Actual task IDs were pinned in the prompts. The replay instruction was appended while tasks were still scheduled. L2's first write occurred before the configured schedule; a later cloud execution at 14:15:46 UTC reused the returned L2 chat, read/reviewed again and failed. The cause of early execution and same-chat reuse is not attested. Do not infer exact-once scheduling or proven context isolation from these settings. Task/context fields are declared audit claims, not platform-signed identities.

The original second-run error is:

```text
INVALID_ARGUMENT: Error code: INVALID_ARGUMENT; Error: RuntimeException: Error calling MCP tool: [TextContent(type='text', text='{"saved":false,"error":"submission_conflict"}', annotations=None, meta=None)]
```

Worker trace confirms this was an **application-level conflict**, not OpenAI safety rejection. The immutable inbox requires identical full payload and caller for replay; a shared submission ID is insufficient. The complete second attempted payload is unavailable, so the exact differing field is not established. The first persisted payload remains unchanged. At 14:21:26 UTC an explicit interactive ChatGPT replay used the complete original D1 JSON without rereading or rescoring and returned `saved:true, inserted:false`. This proves exact payload replay, separately from the failed native scheduled repeat. No scoring model is invoked by Worker replay/apply; internal ChatGPT orchestration call counts cannot be externally measured. The requirement that the whole native task avoid an additional review is **not passed**.

## Production separation and D1 evidence

Selected one previously `new` real article outside the Phase 2B.1 cohort: `b5e4bf1e-acef-464e-aeac-18f4aea4c7c3`, **Chip Industry Week In Review**, Semiconductor Engineering, T2. Frozen policy: `robotics-plus-mcp.phase2b1.v1`; unchanged V1 weights/thresholds. Immutable input hash: `e7945f0f43d6361ce24d543247f1e3b4a7ff7bed4a782bd242667bfc1addf2c2`.

| D1 data | Before cloud runs | After all submissions/replays, before apply | After apply + replay |
|---|---:|---:|---:|
| Articles | 699 | 699; every field of every row identical | 699; only target processing fields changed |
| Processing runs | 9 | 9; all rows identical | 10 |
| Task receipts | 45 | 45; all rows identical | 47 |
| Reviewer runs | 2 | 2; all rows identical | 3 |
| Review submissions | 0 | 1 | 1, unchanged |
| Isolated probes | 0 | 1 | 1, unchanged |
| Application audit | 0 | 0 | 1 |

Only after admin apply did the selected article change: `processing_status: new→processing`, `prefilter_status: null→PASS`, `score_a: null→73.10`, `intelligence_revision: null→phase2b2-l2-a-20261002`, and `updated_at`. All immutable facts and every field of the other 698 articles remain identical. B score, final score, selection and structure remain null. Production receipts are exactly prefilter and score_a. Repeated apply created no additional receipt, run or application. B original-facts read after apply returned the target article without any A score, reason, dimensions, receipts, runs or context.

Machine-readable evidence: [acceptance JSON](acceptance/phase2b2-2026-10-02.json), with before/after selected article rows, full-table hashes/counts, staging rows, safe Worker trace, task IDs, errors, replay and apply responses. [Execution-chat evidence](acceptance/phase2b2-2026-10-02-chats.json) preserves returned messages and actual chat IDs. Raw credentials, request headers, IP/location/TLS telemetry were excluded.

## Additive implementation

Migration `0012_phase2b2_submissions.sql` adds immutable `review_submissions` with all requested identity, input hash/snapshot, payload, created_at and status fields. Unique ID, reviewer_run_id and `(article_id, reviewer, prompt_version)` enforce one result per frozen review. UPDATE and DELETE triggers reject mutation. Initial `validation_status=pending`, `applied_at=null`, `error=null` never change; application outcomes append to immutable `review_submission_applications`, and `review_submission_status` exposes effective status. Separate immutable `review_submission_probes` follows the Phase 2A isolated INSERT/readback pattern; this is a matched review-shaped control, not a rerun of the old Phase 2A task.

Existing A/B endpoints, read-only tools, legacy tools and exclusive `processing:a` / `processing:b` scopes are preserved. A reads add the original snapshot hash; B projection is unchanged. The A plugin was refreshed through its existing UI; Read2/Write4 and existing Allow all tools were confirmed. No permissions were broadened and no safeguards weakened.

`validate_review_result` is pure schema/frozen-version/arithmetic validation with no database write. `append_review_probe` inserts only the isolated probe. `submit_reviewer_a_result` inserts only the inbox: no articles, processing runs, production receipts or finalize. Its accurate metadata is `readOnlyHint=false, destructiveHint=false, openWorldHint=false, idempotentHint=true`. Description explicitly says **“immutable submission inbox; does not modify article state or finalize a decision”**. Write tools require the existing actual ChatGPT OAuth caller as well as A scope.

`apply_review_submission` is the owner-key-protected `POST /admin/apply-review-submission`, never exposed through MCP. It revalidates schema, immutable article snapshot, hash, frozen prompt, reviewer/caller identity and exact weighted total. Production run, A reviewer audit, prefilter/score A receipts and applied outcome commit atomically using existing guards. Rejection produces an immutable audit outcome; replay reads the existing terminal outcome. It uses no model. This minimum implements A only; a full B migration was not started.

## Version and validation

Worker version: `fe2ff24f-96af-437a-9fd9-f2f4a12a99f8`. Implementation commit: `3f99af61c699f42601b900d597727cbe82f7acb4`.

Intelligence typecheck and 32 tests, ingestion typecheck and 18 tests, root typecheck, web build and 31 web tests passed. Meaningful tests cover side-effect separation, immutability, schema/arithmetic/version/hash rejection, conflicting replay, stale facts, wrong caller, atomic rollback, concurrent apply, BLOCK and B blindness. Official SDK read-only checks before/after apply passed scoped tools/annotations, cross-role denial and B projection; SDK did not score or write review judgments.

[Cloud Ingest CI 37016625922](https://github.com/Matataphysika911/AIHOT/actions/runs/37016625922) **passed** on the implementation commit. [Root Check 37016626530](https://github.com/Matataphysika911/AIHOT/actions/runs/37016626530) **failed** at topic seeding with `UNDEFINED_VALUE` in `packages/backend/src/publication/topics.ts:43`; typecheck/build/web tests passed; backend/smoke skipped. Docker job also failed build/start. Local PostgreSQL was unavailable (`ECONNREFUSED 127.0.0.1:5432`), so local backend/smoke is not verified. These failures are retained, not reported as green CI.

## Conclusion and next acceptance

For this account/tool/context, unattended ChatGPT cloud execution accepted a truthful append-only business review submission with no platform safety error. This disproves a blanket assertion that all Scheduled custom MCP business writes are unsupported. It does not identify the precise cause of the historical `save_prefilter` safety block, guarantee future approval, or prove stable recurring execution. L0/L1/L2/Apply write-boundary gates pass, while operational acceptance remains partial because the native extra execution repeated review and root CI is red.

To switch both reviewers to submit→apply and close Phase 2:

1. Exclude existing reviewer/article/snapshot/prompt submissions from eligible reads **before** judgment; add read-only immutable receipt lookup. Retries must reuse the persisted original payload, not regenerate reasons. Resolve and verify the observed early/duplicate scheduling and actual chat isolation.
2. Add a B inbox tool under `processing:b` with B score/structure; preserve original-facts-only B input. Admin apply B/structure/finalize atomically after valid A application. Enforce snapshot/version/arithmetic/order and distinct actual A/B chats, with external task evidence rather than trusting declared labels.
3. Run real independent A/B recurring acceptance with deduplication, immutable rejected-result auditing, rollback, alerts and 24–48h OAuth refresh. Fix the existing root CI failure and finish backend/smoke before closing Phase 2. No Phase 3 work until then.

If a future L2 attempt receives an actual safety rejection, preserve that error and stop. The minimum no-paid-API fallback is separate explicitly initiated interactive A/B review/submission plus owner admin apply, or read-only candidate JSON with human-approved import. This fallback was not needed or implemented here; do not broaden permissions, disguise a writer, or harvest blocked task output as a bypass.
