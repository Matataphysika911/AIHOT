# Phase 1.2 deployment record

Recorded on 2026-10-01 (Asia/Shanghai). This is a partial provisioning record, not a completed ingestion acceptance report.

## Real resources

Cloudflare account ID: `8681f9abc29572d2ea09be866b251519`.

| Resource | Name | ID / state | Worker binding |
| --- | --- | --- | --- |
| D1 | uprivate-intelligence | 796475b7-6819-48fe-b61e-16971d36c985; WNAM | DB |
| Queue | uprivate-source-jobs | efe26a585dc843f6857e9770c5c4331e | SOURCE_QUEUE; intended consumer is this Worker |
| Dead-letter Queue | uprivate-source-jobs-dlq | fc2188c154634d4da5330ed7935e1431 | consumer dead_letter_queue |
| R2 | uprivate-intelligence-raw | Pending account activation; bucket not created | RAW_ARCHIVE (configured only) |
| Worker | uprivate-intelligence-ingest | Created by secret upload; ingestion code not deployed | — |
| Secret | ADMIN_TOKEN | Upload confirmed; value never committed | ADMIN_TOKEN |

Both remote migrations (`0001_initial.sql`, `0002_phase_1_1.sql`) applied successfully. A subsequent migration-list command reports no pending migrations. The queues currently have no producers or consumers; bindings take effect after deployment.

## Build verification

- `npm run typecheck`: passed.
- `npm run deploy -- --dry-run`: passed, 161.76 KiB total / 41.53 KiB gzip.
- `npm install`: 47 packages audited, zero reported vulnerabilities.
- Fixed unpublished `@cloudflare/workers-types@^4.20260926.0`; pinned published `5.20261001.1` and compatible Wrangler `4.144.0`, with a package lock.
- Added module ignore rules for Wrangler state and local secrets.

## Blocking condition

Official Wrangler `r2 bucket list` returned Cloudflare code **10042**: "Please enable R2 through the Cloudflare Dashboard." The user must activate R2 in their account and complete any billing or agreement steps themselves. No billing enrollment or terms were accepted by the agent.

## Resume procedure

From `cloudflare/ingest`, after R2 activation:

```bash
npm ci
npx wrangler r2 bucket create uprivate-intelligence-raw
npm run d1:migrate:remote
npm run deploy
```

Use the actual workers.dev URL emitted by deployment. Check `/health`, unauthorized admin rejection, sync `../../industry/sources.json` to `/admin/sources/sync` using ADMIN_TOKEN, then enqueue sources through `/admin/collect`. Read D1 `collection_runs`, `articles`, and `sources` to verify completion; an accepted queue request alone is not a successful collection.

Candidate source IDs:

- RSS: `robotics-arxiv-robotics` or `robotics-nvidia-robotics`.
- JSON: `robotics-lerobot`.
- Direct HTML: `robotics-figure` and `robotics-unitree`.

For each kind, record fetched, inserted, duplicate, backfill and error counts. Confirm first-import articles have `is_backfill=1` and `publish_eligible=0`; repeat successful sources to verify dedup. Because the initial backfill limit is eight, a second RSS/web run may add previously unimported items; compare identical URL/content rows or use a later run after the backlog is exhausted. Confirm R2 objects exist and source health/checkpoints update. Verify old dated articles also remain ineligible on subsequent runs. Record all failures honestly and fix source-specific collection issues before declaring acceptance.

The configured cron schedules are every 15 minutes and 20:20 UTC daily (04:20 Asia/Shanghai). Their registration and actual execution remain unverified until deployment.

## Pending acceptance

Worker code deployment, public URL, `/health`, source sync, RSS/JSON/web collection, repeat dedup, backfill, source health, R2 snapshots, and cron execution are all **pending**, not passed. PR #2 must remain draft and must not be merged.
