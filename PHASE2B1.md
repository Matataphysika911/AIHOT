# uPrivate Robotics Intelligence Phase 2B.1

Status: **deployed; interactive independent dual review passed; cloud writes blocked by ChatGPT platform safety checks**.
Phase 2 is not completed. Phase 3 has not started. Draft PR #2 is not merged.

## Deployed changes

The ingestion Worker and existing Phase 2B production tools are preserved. New role endpoints use exclusive `processing:a` and `processing:b` grants. A can prefilter and score A. B can score B, structure and request finalize. Role tokens cannot use the legacy route or the opposite role. Concurrent single-role OAuth grants prevent a B login from revoking A's connection.

Both read tools return an explicit allowlist of original article facts and source tier. B's queue uses the existence of an A receipt internally, but returns no scores, reasons, dimensions, prefilter judgment, receipts, runs, tasks, conversations or other reviewer output. Frozen version is `robotics-plus-mcp.phase2b1.v1` with unchanged V1 weights, taxonomy and thresholds. All write acknowledgments exclude the internal processing run and every score/final decision.

Migration 0011 adds reviewer audit identities and guards to existing idempotent task receipts. B must declare a distinct run, task and context. These are declared identities, not platform attestation; actual separate ChatGPT chat/task records are required as external evidence. Worker/database retain deterministic weighted-total validation, final averaging, thresholds, eligibility and selection. BLOCK is closed deterministically without giving A finalize permission.

## Interactive evidence (2026-10-02)

Same article: `119b15ae-bdb8-41fc-8650-a60944eb958b`, *Managing Context and Communication in Distributed Agentic UAV Swarms*.

- A: https://chatgpt.com/c/6abfa2e6-68b8-83ea-842c-f711ca5c8554
- B: https://chatgpt.com/c/6abfa5fe-1658-83e9-9dea-37796a93ebfa

A saved PASS and score 77 in its own context. The independently created B chat received only original facts/frozen policy and saved score 70.55, structure and finalize. Worker produced final 73 with T1_5 threshold 65 and selected/completed. D1 contains exactly five receipts, with separate A/B run and context IDs and actual ChatGPT caller client. Every successful call replay returned inserted:false. All 699 original ingestion fact snapshots and every immutable field were unchanged.

The initial interactive A prompt incorrectly requested an integer total. Worker rejected 77 for weighted 77.45; A then adjusted a dimension and saved exact 77. The instruction was corrected to two decimal places for B and both cloud tasks. No persisted receipt was overwritten. This does not constitute blind scoring for the orchestrator; the separate B model received none of A's outputs.

## Cloud execution evidence and blocker

| Reviewer | Actual cloud task ID | One-shot time (China) | Context |
|---|---|---|---|
| A retry | 6abfac714ddc819093cbf5cc4e420f1c | Oct 2 21:15; completed with failure | New chat every run |
| B | 6abfa81650fc8190821fa2202f6edf12 | Configured Oct 2 21:30; platform shows Completed / no update | New chat every run |

The initial A one-shot (`6abfa77b9c748190ad639ee9066c5dd9`) auto-ran at 21:00 and completed with failure: original facts read succeeded but platform security blocked save_prefilter. D1 independently confirmed zero cloud writes. Its actual run chat is https://chatgpt.com/c/86927253-e6c4-832e-a3fa-6044a30b681d. The completed task cannot be edited; its evidence is preserved. The user explicitly approved persistent A/B plugin permission. Both dedicated plugins now use the platform’s Allow all tools setting, with server OAuth scopes still exclusively processing:a / processing:b. The separate A retry also automatically ran in a new execution chat https://chatgpt.com/c/dcf991ff-b5c0-8331-87a3-71e29f0ad247. All three reads succeeded, but save_prefilter was again blocked by OpenAI safety checks even with Allow all tools already applied. D1 independently confirmed zero cloud receipts and all three articles remained new. B subsequently showed Completed / Last run Today / No update from this run. Its execution chat and tool trace could not be retrieved; D1 has no B receipts. This is not evidence of successful B scoring. No alternate writer, broader scope or API was used to bypass the rejection.

Both saved prompts were pinned to the same three new articles listed in the acceptance JSON. The role-specific stable audit context labels are explicitly labels; actual A execution chat URLs are recorded separately; B has no retrievable execution chat. Initial task creation was protected from writes until the actual task IDs were configured. Repeated runs must return no eligible articles and add no receipts. All one-shot tasks auto-completed; Daily/Weekly budget and other scheduled tasks were not modified.

Cloud unattended write acceptance failed. The platform error was "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending." No more specific reason was provided. The user has already authorized persistent permissions; repeated user confirmation cannot establish that the platform will execute writes. Independent cloud D1 receipts and cloud repeat-run idempotence are not achieved. Phase 2 remains incomplete. Both A one-shot tasks automatically completed and no longer consume active slots; B also shows Completed with no update. All three one-shot tests are absent from active scheduled tasks; only the pre-existing monitor remains. Existing Daily/Weekly tasks were not modified. All 699 pre-existing fact snapshots still compare equal after both A cloud attempts.

## Validation

Intelligence Worker: typecheck and 27 tests passed. Ingestion: typecheck and 18 tests passed. Root typecheck, web build and 31 web tests passed. Live official MCP SDK read/scope checks passed; SDK does not perform model scoring. Root database tests/site smoke could not be fully verified because local PostgreSQL is unavailable (ECONNREFUSED 127.0.0.1:5432). No model API, AGNES, GLM or paid provider calls were performed. AGNES is disabled in the deployed Worker.

Machine-readable evidence: [acceptance/phase2b1-2026-10-02.json](acceptance/phase2b1-2026-10-02.json).

Cloud Ingest CI passed on `f8544dd003a010a467172bc4fc776c93d929b8c3` (runs 37009995946 / 37009988835). Root Check typecheck/build/web tests passed, then check/docker failed at the existing `UNDEFINED_VALUE` in `packages/backend/src/publication/topics.ts:43` before backend/smoke checks (run 37009995967; actual log verified).

Latest deployment `e1e2b2d4-bb3a-4228-a444-1586b261e698` corrects the frozen A instruction to state that BLOCK closes automatically in the database; no permissions, tools or scoring behavior changed. Typecheck and all 27 intelligence tests passed again.

Final cloud snapshot: zero cloud receipts, all three cohort articles still new with null judgments, and all 699 original facts unchanged. Latest intelligence CI passed on `1258675f90e1c7b8d266a3f31bd680a1f6317e33`. B platform completion proves slot cleanup only; its execution and dual-review result remain unverified.
