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

Phase 1 actively collects:

- `rss`
- `json_list`

`web_list` records can already be synced into D1 but deliberately fail collection with a clear error until the HTML selector collector is implemented in Phase 1.1.

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
2. Exact duplicate URLs never create multiple articles.
3. Tracking parameters are stripped before hashing.
4. First discovery of material older than 48 hours is stored as backfill and is not publish-eligible.
5. Failed source collection does not advance to a successful checkpoint.
6. Raw acquisition evidence is archived separately from the structured database.
7. AI selection is downstream and cannot cause collection loss.

## Next phase

Phase 1.1:
- `web_list` HTML selector support
- per-source adaptive fetch intervals
- content-level duplicate fingerprint
- collector observability endpoint

Phase 2:
- IntelligenceProvider abstraction
- prefilter
- independent dual scoring
- structure extraction
