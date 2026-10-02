# uPrivate Intelligence API — Phase 2A

Isolated Cloudflare Worker at https://uprivate-intelligence-api.wdhnlx.workers.dev/mcp.
It reads the Phase 1.2 D1 database, without touching the ingestion Worker, queues,
R2, model providers, article processing state or scoring fields.

## Read tools

- `get_processing_batch(limit = 5, statuses = ["new"])`: fixed parameterized
  SELECT joining articles/sources, newest discovered first with stable id tie-break.
  1–20 rows. Status vocabulary is explicit in `src/articles.ts`; only `new` was
  present in production at the initial Phase 2A inspection. No claim/reservation.
- `get_article(id)`: one fixed parameterized SELECT; missing row has `found=false`.

Backfill articles are included intentionally to inspect real first-import data;
this is a private acceptance interface, not the public publication API. Returned
source metadata is name/kind/tier/first-party only. No source configuration,
raw archive key or full text. Summary max 2000 characters, title 512, URL 2048.
JSON data capped at 120000 UTF-8 bytes (duplicated text/structured content stays
below 250 KB); a larger result asks for a smaller batch. No arbitrary SQL input.

## Isolated write probe

After actual Plus read acceptance, `save_processing_probe(article_id, note, run_id)`
was enabled. It requires `probes:write`, appends only to `processing_probes`,
checks the article exists, and rejects a conflicting run_id without overwriting.
Matching retries return the same receipt. Note is capped at 256 characters and
run_id at 128. Set PROBE_ENABLED=false to hide the write tool.

## Connection and authentication

Streamable HTTP uses official `@modelcontextprotocol/sdk`. Cloudflare's maintained
`@cloudflare/workers-oauth-provider` handles OAuth 2.1, PKCE S256, resource/audience
validation, CIMD (including ChatGPT's hosted client.json), dynamic registration,
access tokens, refresh and browser-bound one-use consent forms.

For this single-owner experiment, `/authorize` authenticates against a dedicated
Worker secret `OWNER_LOGIN_KEY` (random 256-bit key), then grants `articles:read` and, only after explicit consent, `probes:write`.
This is independent of ingestion's ADMIN_TOKEN. Tokens expire after one hour;
the refresh grant expires after 24 hours. Replace single-owner key login with an
established identity provider before broader distribution. Do not publish the key,
tokens or consent cookies. Rotate the key with `wrangler secret`; use provider
grant revocation/KV administration to revoke an issued grant (key rotation alone
does not revoke existing access tokens).

Cloudflare native rate limits: 60 requests per 60 seconds per connecting IP,
plus a 60/minute authenticated owner limit across clients. Limits are approximate
and local to a Cloudflare location, not an exact globally synchronized quota.
All HTTP paths, including registration and failed login, pass the IP limiter.
MCP bodies limited to 8192 bytes. Known host/origin checks reject other origins.
OAuth consent uses anti-framing, no-store and browser-bound CSRF protection.
The validated callback origin is included in CSP so Chrome can follow the redirect.

Public discovery endpoints contain no articles or credentials:

- `/health`: D1 `SELECT 1`, minimal service health.
- `/metadata`: service, tools, limits, phase/gates.
- `/plugin.json` and `/manifest.json`: portable plugin identity metadata.
- `/mcp.json`: portable named streamable-http connection.
- `/.well-known/oauth-protected-resource/mcp`: canonical RFC 9728 metadata.
- `/.well-known/oauth-protected-resource`: compatible discovery alias.
- `/.well-known/oauth-authorization-server`: RFC 8414 authorization metadata.

No legacy `ai-plugin.json`/OpenAPI manifest is required for this remote MCP
connection. The Plugin directory creates the personal connection from `/mcp`.
Static manifests are metadata, not evidence of installation or public submission.

## Reproduce

Run `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, then
`npx wrangler deploy --dry-run`. Deployment requires existing Cloudflare auth,
the same D1 binding, a dedicated OAuth KV and an owner secret installed with
`wrangler secret bulk <private-json-file>`. No model API key is needed.

Explicit live read acceptance (not run by CI):

```
node tests/live-read.mjs /absolute/private/owner-key.json ../ingest/acceptance/phase2a-sdk-2026-10-01.json
```

The file must contain `OWNER_LOGIN_KEY`; evidence never contains its value or
issued tokens. This creates a temporary SDK OAuth grant and performs read-only
D1 calls. SDK success must not be presented as ChatGPT or Scheduled success.

See `../ingest/PHASE2A.md` for actual client acceptance and subsequent gates.

## Phase 2B production MCP processing

The same Worker now exposes `get_processing_policy`, `save_prefilter`,
`save_score` (A/B), `save_structure`, and `finalize_processing`, in addition to
both original reads and the isolated probe. Production writes require separately
consented `processing:write`; `articles:read` and `probes:write` cannot write
article decisions. `PROCESSING_ENABLED` controls tool exposure.

Migration 0007 adds isolated `mcp_processing_runs`, `mcp_task_receipts` and
`mcp_ai_runs` (equivalent audit view). SQL triggers enforce exclusive ownership,
new/processing state, exact immutable factual snapshots, stage order and atomic
stage writes/finalization. No queue/provider API is used. Provider is stored as
`ChatGPT Plus Scheduled/MCP` or `ChatGPT Plus interactive/MCP` for new runs; earlier
immutable rows retain `ChatGPT Plus/MCP`. Runtime labels are declared claims,
which require external ChatGPT run evidence. Same-stage identical retries create
no new rows; conflicting payloads never overwrite. Incomplete runs can resume
under the same run id/client after OAuth reconnection; there is intentionally no
automatic takeover of another run or arbitrary reset tool.

Frozen policy: `industry/robotics/prompts/phase2b.v1.md`. The exact analysis and
scoring V1 files are returned through the read tool. SDK scope tests are separate
from actual Plus production processing acceptance. See `../ingest/PHASE2B.md`.
