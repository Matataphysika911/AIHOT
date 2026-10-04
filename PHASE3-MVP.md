# uPrivate Robotics Intelligence — Phase 3 MVP

2026-10-04 · static shadow export · independent Phase 3 Draft PR, stacked on Phase 2; PR #2 remains Draft; no merge/deployment.

## What is implemented

`cloudflare/phase3` provides a read-only, dependency-free content pipeline separate from Phase 2 scoring, schemas and submit→Cloudflare apply. `scripts/phase3/build.mjs` exports versioned static JSON/Markdown into `content/generated`. Astro can consume the manifest and those files without querying D1. This iteration does not connect the exporter to a recurring worker or the blog production build.

Input is `phase3-input.v1`: completed selected/near-selected article rows, original immutable evidence, structured B facts/inferences/unknowns, A/B submission IDs, input hashes and acceptance provenance. Validation rejects incomplete rows, corrupted evidence snapshots and unbound provenance. `src/d1.mjs` supplies an internal, read-only bounded D1 adapter joining applied A/B receipts with matching prompt/input hashes; it has not been deployed or run against remote D1. Overflow fails explicitly rather than silently truncating a corpus.

The checked-in input is the real three-article Phase 2 acceptance cohort: Ambarella summit, PReFlow, Boston Dynamics humanoid hand. Snapshot: 2026-10-03T06:48:56.842567Z. These are historical completed results, not invented examples and not a claim of complete live news coverage. See `content/generated/source-map.json` for original article/evidence/receipt IDs and acceptance paths.

## Grouping and audit model

Articles carry canonical URL, content/evidence hashes, publisher, timestamp, company/product/topic/title features and Phase 2 fact frame. Pair retrieval uses a 14-day window. Tracking parameters are removed while meaningful URL parameters remain. Exact canonical URL/content identifies duplicates; occurrences are bounded to 48 hours. Broad shared topics or company names alone do not merge articles. Roundups cannot bridge independent events.

Cached semantic decisions are optional input through `--semantic`: occurrence, same_story, roundup, unrelated. They must bind both input hashes, cite existing evidence fact IDs and reach confidence ≥0.8. They can be prepared in the existing ChatGPT/Codex session without a paid API. No live semantic caller is wired. Current real samples remain three independent events; semantic paths are exercised by tests. Complete-linkage occurrence clustering prevents a chain of weak matches merging unrelated endpoints. Same-story relationships link distinct events rather than destroying occurrence identity. Uncertain pairs retain `needs_semantic_review`.

Event IDs are deterministic hashes of sorted article IDs. Facts retain article IDs, source URLs, evidence hashes and input hashes. Grouping does not edit original article/evidence objects.

## Trends and candidates

Hotness uses a 48-hour window and 24-hour exponential half-life, with one maximum contribution per independent publisher hostname. Duplicate URLs and articles from one publisher do not multiply source confidence. Future-dated evidence contributes nothing.

Daily boundaries use Asia/Shanghai. Daily and Weekly exclude backfill/ineligible rows and respect completion as-of time. Weekly compares a seven-day period with its prior period and emits key shifts, topic counts, company watch and commercial signals with event/article citations. Missing prior coverage is `insufficient-baseline`; a three-item cohort cannot establish an industry-wide trend. Weekly is marked partial and verified-cohort-only.

Candidates prioritize robotics/embodied AI/edge AI SoC. High score (≥75), independent sources (≥2), related-event continuity and user focus are explicit gates. All three current candidates are **watchlist**: independent source/continuity evidence is insufficient. The Ambarella draft is an exploratory example, not an automatically accepted editorial candidate. No candidate publishes directly.

## Writer skill and Insight draft

Authoritative skill: `industry/robotics/skills/uprivate-writer-v1.1/SKILL.md`, version **1.1-recovered.20261001**. Recovered from historically confirmed conversation rules; not claimed byte-identical to the original. Library mirror: `/uPrivate/skills/uprivate-writer-v1.1/SKILL.md`. Independent Library readback and cloud CI are tracked in the cloud acceptance record.

SHA-256: `98ec657ae89ab91070cc6f0f94e4b1f598eb9ce77f53a5f96e09cb2786fd0815`.

The skill was read and applied in this Codex session to the Ambarella evidence and candidate packet. Chinese-first, natural technical English, event→constraint→mechanism→silicon→reality/commercialization→personal judgment; optional headings are used selectively. Daily/Weekly have `writer_skill:null` and do not apply it.

Draft: **SmolVLA 跑在一颗 SoC 上，离真实交付还有多远**. Includes title/deck/summary/slug/sections, facts vs inferences vs proposed personal judgment, citation mapping and explicit unknowns. Proposed judgments have `user_approved:false`. Missing TOPS/Memory/Bandwidth/Latency/Power/BOM figures remain 未披露. Vendor demos are not treated as production deployment; Ambarella's broad >50M processor statement is not robotic-chip shipment evidence. The writer validator checks structure/hash/provenance, not semantic entailment; the draft was separately reviewed against actual bounded evidence.

## AI SoC and blog contract

Vendor→family→chip→news/benchmark/review/application. Seeded vendors: NVIDIA Jetson/Thor, Qualcomm RB/Snapdragon, Ambarella CV/N1/X, Horizon, D-Robotics, Rockchip RK AI, MediaTek Genio, Apple M, Others. Only N1-655/CV25/X7 have evidence-backed chip records in this cohort. Other families are user-requested seed taxonomy, not verified chip specifications. Benchmark/review/application lists are reserved independent content types. Numerical specs remain null/未披露.

Manifest contract preserves Daily / Weekly / Insights / AI SoC / Others, zh-CN/en locales and dark/light themes. English translation and the actual frontend integration remain pending; Chinese text is never mislabeled as translated English. Every export is shadow/draft with publish=false. Consumers should read only files listed in the current manifest, not glob old exports. There is no public API or production blog endpoint in this iteration.

## Reproduce and validate

```sh
npm run phase3:build
npm run phase3:test
node scripts/phase3/build.mjs --input cloudflare/phase3/samples/completed.json --out content/generated --date 2026-10-02 --week-start 2026-09-28 --draft cloudflare/phase3/samples/insight-draft.json
```

Defaults generate one Daily (2026-10-02), one partial Weekly (2026-W40), three Insight Candidates, one skill-based Insight draft, SoC index, events, source map and manifest. A different corpus needs a newly composed hash-bound draft; never reuse the sample draft with different evidence. No model API is called by the builder. Sample historical evidence is not refreshed through browsing.

Validation: 28 Phase 3 unit/integration tests (including the real migrated SQLite query); root typecheck; web production build; 31 web tests. PostgreSQL-backed root suite and full running-site smoke remain unrun because this workspace has no PostgreSQL/docker runtime; no backend/publication layer changed. D1 adapter passes mock contract and migrated SQLite query tests; remote query and scheduled export remain unverified.

## Phase 2 read-only sanity (2026-10-04)

This iteration only inspected the existing Scheduled UI and recent execution summaries.
A showed Scheduled / Running now; the table listed next A at 16:00 and B at
16:25 Asia/Shanghai. Both latest completed execution summaries report five
successful immutable submissions, without production article writes. B detail
still has a Daily header while the table says Custom; this known UI mismatch
is recorded, without changing schedules. Earlier B non-interactive authorization
failures/auto-pause are visible in history; latest successful runs supersede them
for this bounded sanity observation. No fresh disabled/safety/conflict blocker
was observed; refresh/grant survival remains unverified. No Run now, reconnect,
apply, scoring, schema, prompt or schedule operation was performed this turn.
This does not reopen or certify 24h stability.

## Static acceptance and CI

`node scripts/phase3/verify.mjs` checks every manifest digest and compares the real
sample's scores, selection, structure, A/B receipt IDs, completion timestamps,
immutable evidence and original facts against the committed Phase 2 acceptance
and SDK evidence. Unit/integration tests cover the real three-article chain,
complete linkage and all four relations, insufficient/ready candidate gates,
changed-evidence translation rejection, cross-period metadata and deterministic
rebuilds. `.github/workflows/phase3-ci.yml` runs tests, build, provenance verification
and generated-content drift checks, using Node 24 with no dependencies/models.
Root typecheck, production web build and 31 web tests passed locally. Local web
tests required the normal sandbox exception for temporary localhost listeners.
PostgreSQL-backed root suite/site smoke are not rerun: no PostgreSQL/Docker runtime.
Root CI's inherited backend failures remain visible and are not Phase 3 acceptance.

Daily/Weekly now contain executive summary, required content sections and watch
questions. These Chinese translations are manually evidence-reviewed and hash-bound
in the core; other inputs get an explicit untranslated fallback rather than invented
summaries. Full facts/unknowns and IDs remain in the Evidence appendix. Daily groups
by Shanghai publication date and looks back from completed snapshot time: it is a
retrospective daily, not a falsely contemporaneous report. Weekly is partial W40;
no complete prior corpus exists, so counts are not asserted as industry growth.

Candidates include why-now/as-of, angle, risk/unknowns and full source/evidence/event
mapping. Ready requires score >=75, >=2 publisher hosts, >=2 related-topic events across distinct Shanghai publication days (or an evidence-supported same-story link),
and focus relevance; topical continuity is a heuristic, not causal proof. All three
real samples stay watchlist. One exploratory Ambarella draft was reviewed using the
read recovered skill in this session; proposed judgment remains unapproved.

SoC Markdown accompanies JSON. Application entries are source-described demos/uses,
not production qualification. Benchmark/review arrays stay empty. Nine vendor seed
categories are present; only three Ambarella chips have evidence-backed records.
The manifest contains zh-CN metadata and English title/summary placeholders (`summary:
null`, pending status), plus light/dark theme contract. There is no D1 query in the
frontend. Astro may import the manifest and load only listed JSON/Markdown files at
build time; reject `publish:false` for public deployment. This contract does not wire
or deploy an Astro site in this iteration.

Remaining limits: broader independently
corroborated corpus; live semantic orchestration; remote D1 export (internal read
adapter tested locally only); recurring static export; full English translation and
frontend binding; verified benchmark/review catalog. No schema migration needed.

See `acceptance/phase3-mvp-2026-10-04.json` for bounded acceptance and
`acceptance/phase2-stability-2026-10-04.json` for this iteration's read-only sanity.

Event IDs hash cluster membership. Adding a new report to an occurrence changes its ID; a future durable D1 event registry/alias layer is needed before ongoing public permalinks. Publisher hostname dedup does not resolve corporate ownership or syndication automatically.

## Controlled writer rebind and cloud reproduction

Baseline: `72337dac9c5c6c6a68ab44177e062e298a4ab3db`. The rebind record inventories every old version/hash reference. Facts F1–F4 remain unchanged, as do all claim bindings, unknowns, sections, candidate/event/article IDs, scores, evidence, Phase2 receipts and non-writer exports. Title/deck/summary and I2/I3/J1 restore system constraints, customer migration and “Does it actually ship?” framing. J1/J2 remain `user_approved:false`. Historical old references remain only as supersession/baseline information and a rejection test.

Use a fresh GitHub checkout with Node 24, without private local files:

```sh
node --test cloudflare/phase3/tests/*.test.mjs
node scripts/phase3/build.mjs --draft cloudflare/phase3/samples/insight-draft.json
node scripts/phase3/verify.mjs
git diff --exit-code -- content/generated
```

The committed recovered skill, candidate/evidence snapshot, draft and Phase2 acceptance/evidence are sufficient for deterministic writer validation and artifact rebuild. Re-authoring prose is a separate author/session activity; no deterministic model generation or automated semantic entailment claim is made. A Library readback must match the pinned hash before claiming the two-cloud copy condition. CI uses only GitHub and Node, with no paid model API, Mac paths or old chats. See `acceptance/phase3-writer-skill-cloud-acceptance-2026-10-04.json` for current CI and Library evidence and verdict.

Draft [PR #3](https://github.com/Matataphysika911/AIHOT/pull/3) still targets the Phase2 feature branch. PR #2 is untouched. No merge or deployment. Earlier CI run 37184088618 validated the old implementation only; recovered rebind CI is tracked separately.

Cloud rebind CI: [run 37205021898](https://github.com/Matataphysika911/AIHOT/actions/runs/37205021898), PASS on `a419e60852ded5513bd1ebb95af7ed15f437b189` (28 tests, build, verify and drift clean). Local root typecheck, web production build and 31 web tests PASS. Overall pure-cloud acceptance is **PARTIAL** only because Library raw-byte/hash readback is unavailable: its named path and recovered prose were independently opened, but Download returned no export. GitHub validation has no Mac/private-chat dependency.
