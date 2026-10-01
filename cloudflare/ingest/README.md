# uPrivate Robotics Intelligence — Cloudflare Ingestion

Phase 1 moves the deterministic collection layer of AIHOT to Cloudflare while preserving the AIHOT source schema and old-news behavior.

## What this worker does

```
Cron (15 min)
  -> D1: sources due to run
  -> Cloudflare Queue
  -> RSS / JSON collectors
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

Copy the D1 database id into `wrangler.jsonc`.

Set the admin secret:

```bash
npx wrangler secret put ADMIN_TOKEN
```

Apply schema and deploy:

```bash
npm install
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
