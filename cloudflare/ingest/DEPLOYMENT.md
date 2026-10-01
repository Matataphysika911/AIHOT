# Phase 1.2 real Cloudflare deployment and acceptance

Recorded 2026-10-01, Asia/Shanghai. The ingestion Worker is deployed and its three collection kinds have passed live acceptance. Storage inventory/retention is operational. Dedicated Analytics token setup and observation of daily Cron executions remain explicit follow-ups; neither is represented as already verified.

## Deployed resources

Account: `8681f9abc29572d2ea09be866b251519`.

| Resource | Name | Verified result |
| --- | --- | --- |
| D1 | uprivate-intelligence | `796475b7-6819-48fe-b61e-16971d36c985`, WNAM; migrations 0001–0004 applied |
| Queue | uprivate-source-jobs | `efe26a585dc843f6857e9770c5c4331e`; 1 Worker producer and 1 Worker consumer |
| DLQ | uprivate-source-jobs-dlq | `fc2188c154634d4da5330ed7935e1431`; deployed dead-letter binding |
| R2 | uprivate-intelligence-raw | Created 2026-10-01 21:53:18 +08:00, WNAM, Standard |
| Worker | uprivate-intelligence-ingest | Production code deployed; D1/R2/Queue bindings active |
| ADMIN_TOKEN | Worker secret | Existing secret retained; authenticated sync/collect/storage calls passed |

Production URL: **https://uprivate-intelligence-ingest.wdhnlx.workers.dev**.

Latest code version at this record: `04ab90c1-8a35-48ee-9b5a-5ac274b75050`. A Dashboard secret change may create a newer version without changing this source code.

No billing enrollment, terms acceptance, storage-class transition or plan change was performed. R2 activation was already confirmed by the user.

## HTTP and source sync

- `GET /health`: HTTP 200; D1 queries and storage state returned.
- Unauthenticated `POST /admin/collect`: HTTP 401.
- Authenticated `POST /admin/sources/sync` with the exact `industry/sources.json` payload: HTTP 200, **19 inserted, 0 updated, 0 skipped** on first sync.
- Authenticated manual collection for each acceptance source: HTTP 200, then successful **D1 collection_runs** confirmed Queue execution. Queue acceptance alone was not counted as a successful collection.
- Authenticated `POST /admin/storage/check` with `dryRun:false`: HTTP 200; before/after inventory and zero expired deletions recorded in D1.

## Live collection and dedup

| Source | Kind | First fetched / inserted / backfill | Stable repeat fetched / inserted / duplicates |
| --- | --- | --- | --- |
| robotics-nvidia-robotics | RSS | 8 / 8 / 8 | 74 / 0 / 74 |
| robotics-lerobot | json_list | 5 / 5 / 5 | 5 / 0 / 5 |
| robotics-figure | web_list | 8 / 8 / 8 | 21 / 0 / 21 |

First runs started at 21:58:05–21:58:08 +08:00. Every first-run article had `is_backfill=1`, `publish_eligible=0`. The first source initialization timestamps were set only after successful collection.

The second NVIDIA/Figure runs expanded beyond the initial-backfill limit of eight: 66 RSS and 13 web items were genuinely previously unimported. A third stable run showed zero insertions for all three sources. SQL grouping found zero repeated URL hashes and zero repeated `(source_id,content_hash)` groups.

Acceptance exposed a pre-existing direct-HTML collector gap: it ignored the configured publication-date selector. The deployed fix reads title selectors and `time[datetime]`/date text. Repeated collection now fills missing publication dates on existing canonical URLs and conservatively sets old items to backfill/ineligible. All 21 Figure rows now have dates and are backfill/ineligible; the latest article remains first-import backfill even though its publication date is recent. None of the dated old articles remain incorrectly publish-eligible. No articles were deleted or reimported for this repair.

## Health and retry

The three accepted sources have health `ok`, zero consecutive failures, non-null last-success/initialization times and future next-fetch timestamps. After the first real Cron run, all **19 enabled manifest sources** were reported healthy; the only degraded row is the disabled controlled fixture. The database contained **205 articles** at 22:17 +08:00.

A temporary source `phase12-acceptance-retry` fetched a deliberately missing path on this Worker, producing controlled HTTP 404 without depending on an unstable third party:

- First failure at 22:07:05 +08:00: `health=degraded`, failures=1, next fetch 22:37:05 (30-minute backoff).
- Second manual failure at 22:09:21 +08:00: failures=2, next fetch 22:54:21 (45-minute backoff).
- Live Worker tail confirmed `collection retry scheduled`, **delaySeconds=2700**, attempts=1 for the second manual Queue message.
- The failed runs retained the upstream HTTP 404 error; no successful checkpoint or articles were created.
- Fixture disabled after acceptance (`enabled=0`). Its audit rows are retained. Its two already-delayed Queue messages will acknowledge without fetching when delivered because collection excludes disabled sources.

Queue retry now honors D1 backoff using `message.retry({delaySeconds})`; `max_retries=3` and the DLQ remain deployed. Exhaustion into DLQ and a real recovery from a failing upstream were not forced in production. The failure state, backoff schedule and runtime retry call were verified.

## R2 evidence and metrics

Actual Figure raw archive retrieved successfully using official Wrangler:

`raw/2026/10/01/robotics-figure/2026-10-01T13-58-58-952Z.html`

Its approximately 55 KB HTML includes article links and publication timestamps. RSS/XML and JSON snapshots are also present in the same date partition. No raw payload or credential is committed with this report.

A live inventory at 22:08:42 +08:00 measured **1,822,312 payload bytes, 9 objects** across all bucket prefixes (0.01822312% of the 10 GB capacity proxy). All objects were newly created; **0 objects eligible, 0 deleted**, and before/after counts matched. After the real Cron collection, another manual maintenance run at **22:17:26 +08:00** measured **4,893,882 payload bytes, 28 objects**, no expired objects and zero deletions (approximately 0.04894% of the capacity proxy). Later collection creates more snapshots, so these are timestamped measurements rather than a permanent total.

Official `wrangler r2 bucket info` and a local GraphQL query were tried first. Initially Wrangler displayed zero objects/zero bytes, while the GraphQL query returned no samples and inventory already contained snapshots. Zero from this delayed provider view is not treated as proof of an empty bucket. The monitor stores provider availability separately and falls back to paginated official R2 binding inventory.

The user is being guided to create a dedicated **Account Analytics Read** token and save it as Worker secret `CF_ANALYTICS_TOKEN`. It was not present at initial acceptance. Local agnesAI's `AGNES_API_KEY` is an application credential, not a Cloudflare Analytics token, and was not uploaded or exposed. No personal OAuth refresh credential was installed in the Worker.

See [README monitoring policy](README.md#r2-storage-monitoring-and-retention-phase-12): 70% warning, 85% critical, 90% pressure flag, desired result under 85%, 60-day default minimum retention, daily inspection, bounded cleanup of expired `raw/YYYY/MM/DD/` only. Current bucket payload bytes are not an exact account-wide GB-month bill; other buckets, metadata, multipart uploads and separate operation quotas require provider/billing data. Unknown billing coverage is explicitly reported.

Native lifecycle rule **raw-retention-60d**, prefix **raw/**, expire after **60 days**, is installed and verified. The default seven-day multipart abort rule was retained. `reports/`, `backup-staging/` and other prefixes have no object-expiry rule. Changing retention requires updating both Worker policy and lifecycle configuration.

Alerts are exposed through `/health`, protected `/admin/storage/status`, D1 records and Worker warning logs. No email/push alert destination or NAS backup was configured/verified in Phase 1.2.

## Cron registration and remaining observations

Wrangler deployment confirmed all schedules and active Queue producer/consumer:

- `*/15 * * * *`: source scheduling, every 15 minutes.
- `20 20 * * *`: adaptive polling, 04:20 Asia/Shanghai next day.
- `35 20 * * *`: storage maintenance, 04:35 Asia/Shanghai next day.

The scheduler writes invocation status/errors to `scheduler_runs`. The first real quarter-hour invocation was observed at **2026-10-01 22:15:50 +08:00**, completing successfully at **22:15:52**. Its `scheduler_runs` row is `cfdcb882-2f16-47b8-ae37-36dabd0c871c`, status `success`, no error. Registration and actual source-scheduler execution are both verified. Observe the daily jobs on **2026-10-02 at 04:20 / 04:35 Asia/Shanghai**; these daily triggers have not been awaited in this acceptance session.

## Validation and GitHub state

- Module typecheck passed.
- Seven targeted storage tests passed, including retention/protected-prefix boundaries, incomplete scans, dry runs, deletion audit/failure, lease release and provider permission errors.
- Live RSS/JSON/web, stable dedup, first-import backfill, web-date repair, health/backoff, Queue retry delay and R2 snapshot checks passed.
- Additive remote migrations applied; no application PostgreSQL schema was changed.
- Root PostgreSQL/web build/smoke checks were not run: this change is restricted to the standalone Cloudflare module.
- All source/config/documentation changes belong to `feat/cloudflare-ingestion-v1`; PR #2 remains Draft and is not merged.
