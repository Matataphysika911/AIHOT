# uPrivate Intelligence API — Phase 2 Finalization

Current production path: isolated Scheduled Reviewer A/B append-only submissions,
then Cloudflare deterministic apply. Phase 2 is **functional complete / pending
24h stability acceptance**. See [finalization report](../../PHASE2-FINALIZATION.md).
Reviewer A runs every 2 hours at minute 0; Reviewer B every 2 hours at minute 25,
each in a new chat. Worker apply uses `5,35 */2 * * *`; ingestion stays 15 minutes.
The 2h cadence reduces duplicate-review/trigger noise and Scheduled Task budget
use, aligns with ingestion, and is sufficiently timely for robotics news.
The legacy generic production tools described below are historical interfaces;
neither minimal reviewer endpoint exposes them. AGNES remains disabled.

Isolated Cloudflare Worker at https://uprivate-intelligence-api.wdhnlx.workers.dev/mcp.
It reads the Phase 1.2 D1 database and supports audited Phase 2B processing.
Ingestion, queues and R2 remain separate. An optional AGNES reviewer is available
only through the restricted production tool described below.

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
stage writes/finalization. The original pure Plus path uses no queue/provider API. Provider is stored as
`ChatGPT Plus Scheduled/MCP` or `ChatGPT Plus interactive/MCP` for new runs; earlier
immutable rows retain `ChatGPT Plus/MCP`. Runtime labels are declared claims,
which require external ChatGPT run evidence. Same-stage identical retries create
no new rows; conflicting payloads never overwrite. Incomplete runs can resume
under the same run id/client after OAuth reconnection; there is intentionally no
automatic takeover of another run or arbitrary reset tool.

Frozen policy: `industry/robotics/prompts/phase2b.v1.md`. The exact analysis and
scoring V1 files are returned through the read tool. SDK scope tests are separate
from actual Plus production processing acceptance. See `../ingest/PHASE2B.md`.

## Optional independent AGNES score B

The original pure Plus policy/version remains available. The optional policy
`get_independent_review_policy` uses `robotics-plus-agnes-mcp.phase2b.v1` and
run prefixes `phase2b-hybrid-interactive-` / `phase2b-hybrid-scheduled-`.
Plus performs prefilter, score A, structure and finalize. Between A and structure,
`run_independent_score_b(article_id,run_id,prompt_version,model?)` constructs a fresh
AGNES request using bounded original source evidence and the frozen scoring rubric.
No A score, reasoning, processing fields, raw references or conversational history
are sent. It reuses the existing OpenAI-compatible provider transport, validates
the response and saves B. The fixed AGNES endpoint is not caller-configurable.

AGNES is optional. Missing configuration, disabled calls, a hard lifetime budget
or provider errors record `fallback_allowed=true`; Plus can then write score B.
This records `ChatGPT Plus fallback/MCP` and `independence=not_verified` instead
of claiming that same-conversation dual scoring is independent. A pending call
whose Worker execution was interrupted remains blocked for investigation;
unknown billed outcomes are never automatically retried. Successfully received
responses resume without a new request. Identical completed calls replay receipts.

Migration 0008 adds `mcp_external_reviews` and a trigger that prohibits hybrid B
without the validated API response or an explicitly recorded fallback. The audit
view reports per-stage provider, billing path, requested/response model, response
ID, usage and fallback reason. Original receipts and facts are preserved.
Wrangler 4.144.0's query-based migration executor returned `incomplete input` for
the trigger; remote file import succeeds. Use `wrangler d1 execute
uprivate-intelligence --remote --file ../ingest/migrations/0008_optional_agnes_review.sql
--yes`, then register the successfully applied name in `d1_migrations`. Do not
rerun either 0007 or 0008 on a database where the tables already exist.

Local defaults remain disabled. Deployment enables only this bounded MCP review:
`wrangler deploy --var AGNES_REVIEW_ENABLED:true`. Store `AGNES_API_KEY` using
`wrangler secret put AGNES_API_KEY`; never commit it. The key was initially uploaded
from the user's existing local credential and later rotated by the user in the
API Worker's dashboard; cloud calls read the Worker secret
and do not require the user's computer to be on. `AGNES_MODEL=agnes-2.5-flash`,
`AGNES_REVIEW_CALL_LIMIT=5` caps all reserved API calls for this acceptance cohort
(including failed/unknown calls). Budget increases require an intentional deploy.
This does not enable the ingest Worker's background API processing.

Migration 0009 adds `mcp_provider_probes`. Owner-authenticated
`POST /admin/agnes-connectivity` accepts only a fixed probe id and either
`agnes-2.5-flash` or `agnes-3.0-flash`; it sends synthetic evidence through the same
cloud transport without reading or changing articles. Probes and B reviews share
the same permanent budget, including failures/unknown outcomes. Replay reads the
original receipt, never retries. The owner-only GET returns configuration and a
SHA-256 key fingerprint for rotation diagnostics, without a model request or key.

On 2026-10-02 the user authorized one additional model-3 probe after the original
five attempts, then explicitly selected model 2.5 and added five more attempts.
The live cumulative limit is therefore 11; the checked-in default remains 5 and
disabled. Deploy with explicit `--var AGNES_REVIEW_CALL_LIMIT:11` only for this
authorized acceptance cohort. Never delete or reset receipts to regain budget.

Migration 0010 adds stage, source id/input and validated-output fields to the probe
receipt. An owner can request `stage=score_b` with one `article_id` to diagnose the
exact frozen production rubric against original facts. It never sends saved A/B
or writes article fields / production stage receipts. Same probe id is bound to
model/stage/article; mismatched reuse rejects and identical replay costs nothing.
