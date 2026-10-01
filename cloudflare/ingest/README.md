# uPrivate Robotics Intelligence — Cloudflare Ingestion

Phase 1 moves the deterministic collection layer of AIHOT to Cloudflare while preserving the AIHOT source schema and old-news behavior.

## What this worker does

```
Cron (15 min)
  -> D1: sources due to run
  -> Cloudflare Queue
  -> RSS / JSON / direct HTML collectors
  -> canonical URL + SHA-256 exact dedup
  -> 48h old-news/backfill rule
  -> D1: structured article metadata
  -> R2: raw source response
```

AI processing is intentionally not part of this worker. Prefilter, dual scoring, structure extraction, event grouping and reports are separate phases.

## Source compatibility

The admin sync endpoint accepts the existing AIHOT `industry/sources.json` shape:

```bash
curl -X POST "https://<worker>/admin/sources/sync" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @industry/sources.json
```

Phase 1.1 actively collects:

- `rss` / Atom
- `json_list`
- `web_list` for direct HTML list pages

The `web_list` implementation intentionally targets deterministic, directly fetchable HTML. JavaScript-rendered lists and Jina/browser-rendered pages are deferred so the free Cloudflare collector stays cheap and predictable.

## Cloudflare resources

Create these once:

```bash
npx wrangler d1 create uprivate-intelligence
npx wrangler r2 bucket create uprivate-intelligence-raw
npx wrangler queues create uprivate-source-jobs
npx wrangler queues create uprivate-source-jobs-dlq
```

The current `wrangler.jsonc` records the provisioned account and D1 database ID. For another account, replace both IDs and create its resources. See [DEPLOYMENT.md](DEPLOYMENT.md) for the actual Phase 1.2 state.

Enable R2 in the Cloudflare Dashboard before creating its bucket. Wrangler returns error 10042 when R2 has not been activated.

Set the admin secret:

```bash
npx wrangler secret put ADMIN_TOKEN
```

Apply schema and deploy:

```bash
npm ci
npm run d1:migrate:remote
npm run deploy
```

Health check:

```bash
curl https://<worker>/health
```

Queue an individual source for verification:

```bash
curl -X POST "https://<worker>/admin/collect" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sourceId":"robotics-arxiv-robotics"}'
```

## Invariants preserved from AIHOT

1. Source identity and tiering come from the industry source manifest.
2. Canonical URL hashes prevent exact duplicate URLs from creating multiple articles.
3. Per-source content hashes catch the same item appearing again under a different URL.
4. Tracking parameters are stripped before hashing.
5. The first import of a source is always backfill; later discoveries older than 48 hours are also backfill and are not publish-eligible.
6. Failed source collection never becomes a successful checkpoint; failures back off and progress from degraded to failing health.
7. Raw acquisition evidence is archived separately from the structured database.
8. AI selection is downstream and cannot cause collection loss.
9. Daily adaptive polling follows recent seven-day output: productive free sources approach 15 minutes, quiet editorial sources relax to 60 minutes, hot-signal sources may relax to 180 minutes.

## Observability

`GET /health` reports aggregate source health, articles discovered in the last 24 hours and failed runs in the last 24 hours.

The `collection_runs` table records fetched, inserted, duplicate and backfill counts for every run. Source rows keep consecutive failures, health, last error, last success and next fetch time.

## Phase 1.1 acceptance criteria

Before enabling AI processing, verify in the real Cloudflare account that:

- at least one RSS source inserts new rows;
- at least one GitHub `json_list` source inserts releases;
- Figure or Unitree `web_list` can be fetched from direct HTML;
- a repeated collection produces duplicates rather than new rows;
- first-import rows are marked backfill;
- an intentionally broken source moves to degraded health and retries later;
- raw responses appear in R2;
- the 20:20 UTC daily cron adjusts intervals from seven-day production.

## Next phase

Phase 2:
- IntelligenceProvider abstraction
- AIHOT-compatible prefilter
- independent dual scoring
- structure extraction
- processing queue / status transitions

## R2 storage monitoring and retention (Phase 1.2)

Three deployed Cron schedules run independently:

| UTC Cron | Asia/Shanghai | Purpose |
| --- | --- | --- |
| `*/15 * * * *` | Every 15 minutes | Enqueue due RSS/JSON/web sources |
| `20 20 * * *` | 04:20 daily | Adaptive source intervals |
| `35 20 * * *` | 04:35 daily | R2 metrics, retention and maintenance audit |

`storage_metrics` persists each measurement. `maintenance_runs` records before/after payload bytes and object counts, deleted count/bytes, policy, provider availability and failures. `scheduler_runs` records actual Cron invocation results. Concurrent maintenance is prevented by a D1 lease; failed maintenance releases its lease and preserves confirmed deletion progress.

### Metrics and quota scope

The monitor first tries the official [Cloudflare GraphQL storage dataset](https://developers.cloudflare.com/r2/platform/metrics-analytics/) using the optional Worker secret `CF_ANALYTICS_TOKEN`. Create a dedicated token with **Account / Account Analytics / Read**, scoped to this account, then install it:

```bash
npx wrangler secret put CF_ANALYTICS_TOKEN
```

Dashboard alternative: Workers & Pages → uprivate-intelligence-ingest → Settings → Variables and Secrets → Add → Type Secret → Name CF_ANALYTICS_TOKEN → Deploy. The token is never committed or returned through the API. Never upload a personal Wrangler OAuth refresh credential as this secret. See the [token setup instructions](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/).

If analytics credentials, permissions or fresh samples are unavailable, the monitor explicitly records the reason and uses the official R2 binding's paginated `list()` inventory. This measures this bucket's current payload bytes across **all prefixes**, including reserved prefixes. It is not a billing total: it excludes metadata, pending multipart uploads and other buckets. Provider samples include payload/metadata, are delayed, and expose latest observed account bucket samples separately. They are not a complete account inventory or an invoice.

R2 Standard's [free allowance](https://developers.cloudflare.com/r2/pricing/) is **10 GB-month per account**, shared with other buckets; operation quotas are separate. Current bytes are a conservative capacity proxy, not an exact monthly GB-month bill. `accountBillingQuotaStatus` remains explicitly unknown. Standard storage is retained; no plan or billing changes are made.

### Policy

| Setting | Default | Behavior |
| --- | --- | --- |
| `RAW_RETENTION_DAYS` | 60 | Minimum archive retention; positive, configurable |
| `R2_FREE_BYTES` | 10000000000 | Capacity proxy corresponding to 10 decimal GB |
| `R2_WARNING_PERCENT` | 70 | Warning at 7 GB |
| `R2_CRITICAL_PERCENT` | 85 | Critical at 8.5 GB |
| `R2_CLEANUP_PERCENT` | 90 | Pressure flag at 9 GB; desired result below 85% |
| `R2_SCAN_MAX_PAGES` | 20 | Up to 20,000 objects per inventory; allowed 1–100 pages |
| `R2_DELETE_MAX_OBJECTS` | 100 | Deletion cap per run; allowed 1–200 |

Daily retention removes expired objects even below the capacity thresholds. Capacity pressure never shortens retention or authorizes deletion of protected data. If only recent/protected objects remain, the critical status persists; the target is not guaranteed. An incomplete scan is a lower bound, sets unknown/critical status as appropriate, and skips deletion. Increase the scan limit within the documented bound or use provider analytics as the archive grows.

Only keys under `raw/YYYY/MM/DD/` with a valid date are eligible. Both the date partition **and upload age** must be older than the retention cutoff. The worker rechecks object metadata before deletion; ingestion uses immutable timestamped keys. `reports/`, `backup-staging/` and every other prefix are protected. Daily deletion work is bounded; a native lifecycle rule handles larger expiry backlogs.

Native [R2 lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) fallback is installed and verified:

```bash
npx wrangler r2 bucket lifecycle add uprivate-intelligence-raw raw-retention-60d raw/ --expire-days 60 --force
npx wrangler r2 bucket lifecycle list uprivate-intelligence-raw
```

It expires only `raw/` objects after 60 days of upload age and preserves the default 7-day incomplete multipart abort rule. Lifecycle deletion is asynchronous, typically within 24 hours of expiry. Worker audit deletion counts exclude Cloudflare lifecycle deletions; subsequent inventory reflects them. To change retention, update **both** the Worker variable and this lifecycle rule (remove the named rule then add the new duration); increasing Worker retention alone cannot override the lifecycle fallback. NAS replication must operate within this window; no NAS backup has been verified in this phase.

### Dashboard endpoints and manual checks

- `GET /health`: source counts, storage state and last observed Cron invocation.
- `GET /admin/storage/status`: authenticated latest metrics, maintenance record, policy and staleness (>30 hours).
- `POST /admin/storage/check`: authenticated measurement/retention run; defaults to dry run. `{"dryRun":false}` permits expiration cleanup.

```bash
curl "https://uprivate-intelligence-ingest.wdhnlx.workers.dev/admin/storage/status" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
curl -X POST "https://uprivate-intelligence-ingest.wdhnlx.workers.dev/admin/storage/check" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"dryRun":true}'
```

Warnings are available through D1, Dashboard polling and Worker warning logs. No email, push or third-party alert destination is configured. The later NAS Dashboard should surface warning/critical, stale/incomplete metrics and failed maintenance. These checks reduce storage risk but do not impose a billing hard cap.

### Verification

```bash
npm run typecheck
npm test
```

Tests cover protected prefixes, valid dates and upload age, bounded/incomplete scans, dry runs, before/after audit, failed deletion, lease release, and provider permission errors without network calls. The module CI uses the lockfile and runs typecheck plus these tests. Real source/backfill/dedup/retry/R2 acceptance is recorded separately in [DEPLOYMENT.md](DEPLOYMENT.md). PostgreSQL/web application checks from the root AGENTS.md are not applicable to this standalone Cloudflare module and were not run; no root application code was changed.

## Phase 2 Intelligence Layer

See [PHASE2.md](PHASE2.md) for provider setup, processing states, audit/receipt safety, protected endpoints and deployment acceptance. Live processing is disabled until a separate API key, endpoint and model are configured. Mock jobs do not write production article decisions.
