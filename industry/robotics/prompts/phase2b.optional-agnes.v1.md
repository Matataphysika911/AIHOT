# Phase 2B optional AGNES reviewer v1

Version: `robotics-plus-agnes-mcp.phase2b.v1`

The user authorized the existing local AGNES API credential for optional independent
dual scoring on 2026-10-02. This changes the earlier pure Plus no-paid-API constraint
only for this optional path; preserve the original acceptance evidence unchanged.

Read `get_independent_review_policy` and `get_article` via the existing MCP.
Use a new `processing_status=new` article and an owned run with prefix
`phase2b-hybrid-interactive-` or `phase2b-hybrid-scheduled-`.

1. Plus applies the frozen analysis/scoring files; writes Prefilter.
2. Plus scores A from source facts; writes the six dimensions and weighted total.
3. Call `run_independent_score_b(article_id,run_id,prompt_version,model?)`.
   Allowed models are `agnes-2.5-flash` and `agnes-3.0-flash`; omit model to use the
   cloud default, currently `agnes-2.5-flash`. A reserved run cannot change model.
   The server constructs a fresh AGNES request using only bounded source evidence
   from the immutable run snapshot and the frozen scoring rubric. It never supplies
   score A, its reasoning, receipts, structure, or ChatGPT conversational history.
   It validates, audits and writes B itself. No caller-selected API, SQL or prompts.
4. When `fallback_allowed=true`, Plus scores B from original evidence and writes
   `save_score(slot=B)`; audit records the unavailable/failed/unknown API attempt,
   the Plus fallback and `independence=not_verified`. Never claim strict independence
   for two reviews in one ChatGPT conversation. Pending interrupted requests require
   investigation; never automatically repeat a possibly billed request.
5. Plus writes Structure and finalizes. The original tier thresholds remain
   T1=60, T1_5=65, T2=76. Do not change facts or start grouping/hotness/reports.
6. Replay identical stage operations under the same run. AGNES B replay must consume
   no additional API call and append no additional stage receipt.

AGNES is optional, default disabled, with a hard lifetime call cap for acceptance
testing. API authorization/model failure or budget exhaustion records fallback.
Synthetic connectivity probes consume the same permanent budget as article B
requests. The live authorized cumulative limit is 11 on 2026-10-02, while local
defaults remain disabled with limit 5. Do not retry a failed run or reset audit.
This verifies isolation of reviewer inputs and runtime contexts, not the absence
of correlated model training or infrastructure. Provider/model/usage/request IDs
and actual ChatGPT execution evidence must substantiate any acceptance claim.
