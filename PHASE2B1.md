# uPrivate Robotics Intelligence Phase 2B.1

Status: **deployed; interactive independent dual review passed; cloud acceptance pending**.
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

## Cloud tasks awaiting execution

| Reviewer | Actual cloud task ID | One-shot time (China) | Context |
|---|---|---|---|
| A | 6abfa77b9c748190ad639ee9066c5dd9 | Oct 2 21:00 | New chat every run |
| B | 6abfa81650fc8190821fa2202f6edf12 | Oct 2 21:15 | New chat every run |

Both prompts are pinned to the same three new articles listed in the acceptance JSON. The role-specific stable audit context labels are explicitly labels; execution chat URLs must be recorded separately after the platform runs. Initial task creation was protected from writes until the actual task IDs were configured. Repeated runs must return no eligible articles and add no receipts. Complete the one-shot tasks after acceptance without modifying Daily/Weekly budget or other scheduled tasks.

Unattended execution, no-confirmation behavior, independent cloud D1 receipts, platform run contexts, repeat-run idempotence and slot cleanup remain pending. Creation alone is not acceptance. Only after these real execution checks pass can Phase 2 be marked completed.

## Validation

Intelligence Worker: typecheck and 27 tests passed. Ingestion: typecheck and 18 tests passed. Root typecheck, web build and 31 web tests passed. Live official MCP SDK read/scope checks passed; SDK does not perform model scoring. Root database tests/site smoke could not be fully verified because local PostgreSQL is unavailable (ECONNREFUSED 127.0.0.1:5432). No model API, AGNES, GLM or paid provider calls were performed. AGNES is disabled in the deployed Worker.

Machine-readable evidence: [acceptance/phase2b1-2026-10-02.json](acceptance/phase2b1-2026-10-02.json).
