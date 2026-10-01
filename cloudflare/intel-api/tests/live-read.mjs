// Explicit live acceptance only; never part of npm test. No model API calls.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const origin = 'https://uprivate-intelligence-api.wdhnlx.workers.dev';
const secret = JSON.parse(await fs.readFile(process.argv[2], 'utf8')).OWNER_LOGIN_KEY;
const evidence = { recorded_at: new Date().toISOString(), client: 'official MCP SDK (not ChatGPT)', origin, checks: {} };
async function check(path, expected) {
  const response = await fetch(origin + path);
  assert.equal(response.status, expected, path);
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : null;
  evidence.checks[path] = { status: response.status, body, challenge: response.headers.get('www-authenticate') };
  return body;
}
await check('/health', 200);
await check('/metadata', 200);
await check('/manifest.json', 200);
await check('/.well-known/oauth-protected-resource', 200);
await check('/.well-known/oauth-authorization-server', 200);
await check('/mcp', 401);
const invalid = await fetch(origin + '/mcp', { headers: { Authorization: 'Bearer invalid-probe-token' } });
assert.equal(invalid.status, 401);
evidence.checks.invalid_bearer = { status: invalid.status };
const hostile = await fetch(origin + '/mcp', { headers: { Origin: 'https://untrusted.example' } });
assert.equal(hostile.status, 403);
evidence.checks.hostile_origin = { status: hostile.status };

const register = await fetch(origin + '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_name: 'Phase 2A SDK acceptance', redirect_uris: ['http://localhost:9876/callback'],
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
assert.equal(register.status, 201, await register.clone().text());
const clientInfo = await register.json();
const verifier = crypto.randomBytes(32).toString('base64url');
const query = new URLSearchParams({ client_id: clientInfo.client_id, redirect_uri: 'http://localhost:9876/callback',
  response_type: 'code', scope: 'articles:read', resource: origin + '/mcp', state: crypto.randomUUID(),
  code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
const consent = await fetch(origin + '/authorize?' + query);
assert.equal(consent.status, 200, await consent.clone().text());
const page = await consent.text();
const handle = page.match(/name="handle" value="([^"]+)"/)[1];
const cookie = consent.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const approve = await fetch(origin + '/authorize', { method: 'POST', redirect: 'manual', headers: {
  'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, Origin: origin },
  body: new URLSearchParams({ handle, owner_key: secret, decision: 'approve' }) });
assert.equal(approve.status, 302, await approve.clone().text());
const callback = new URL(approve.headers.get('location'));
assert.equal(callback.searchParams.get('state'), query.get('state'));
const tokenResponse = await fetch(origin + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientInfo.client_id,
    code: callback.searchParams.get('code'), redirect_uri: 'http://localhost:9876/callback',
    code_verifier: verifier, resource: origin + '/mcp' }) });
assert.equal(tokenResponse.status, 200, await tokenResponse.clone().text());
const tokens = await tokenResponse.json();
assert.equal(tokens.scope, 'articles:read');
evidence.oauth = { dynamic_registration: register.status, consent: consent.status, approval: approve.status,
  pkce_exchange: tokenResponse.status, scope: tokens.scope, expires_in: tokens.expires_in, refresh_token_issued: Boolean(tokens.refresh_token) };
const client = new Client({ name: 'phase2a-acceptance', version: '1.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), {
  requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
}));
const tools = await client.listTools();
assert.deepEqual(tools.tools.slice(0, 2).map(t => t.name), ['get_processing_batch', 'get_article']);
assert.ok(tools.tools.slice(0, 2).every(t => t.annotations.readOnlyHint === true));
if (tools.tools.length === 3) {
  assert.equal(tools.tools[2].name, 'save_processing_probe');
  assert.equal(tools.tools[2].annotations.readOnlyHint, false);
  const denied = await client.callTool({ name: 'save_processing_probe', arguments: {
    article_id: 'phase2a-does-not-exist', note: 'Read token must not write', run_id: 'phase2a-read-scope-negative',
  } });
  assert.equal(denied.isError, true);
  assert.ok(denied._meta['mcp/www_authenticate']);
  evidence.checks.read_scope_cannot_write = { isError: true, oauth_step_up_challenge: true };
}
evidence.tools = tools.tools;
const batch = await client.callTool({ name: 'get_processing_batch', arguments: { limit: 3, statuses: ['new'] } });
assert.equal(batch.isError, undefined);
assert.equal(batch.structuredContent.count, 3);
evidence.batch = batch.structuredContent;
const id = batch.structuredContent.articles[0].id;
const article = await client.callTool({ name: 'get_article', arguments: { id } });
assert.equal(article.structuredContent.article.id, id);
assert.equal(article.structuredContent.found, true);
evidence.article = article.structuredContent;
const missing = await client.callTool({ name: 'get_article', arguments: { id: 'phase2a-does-not-exist' } });
assert.equal(missing.structuredContent.found, false);
evidence.checks.missing_article = { found: false };
const oversized = await client.callTool({ name: 'get_processing_batch', arguments: { limit: 21 } });
assert.equal(oversized.isError, true);
evidence.checks.oversized_batch = { isError: true };
const sql = await client.callTool({ name: 'get_processing_batch', arguments: { sql: 'SELECT * FROM sources' } });
assert.equal(sql.isError, true);
evidence.checks.arbitrary_sql = { isError: true };
const huge = await fetch(origin + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`,
  'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: 'x'.repeat(9000) });
assert.equal(huge.status, 413);
evidence.checks.oversized_body = { status: huge.status };
await client.close();
await fs.writeFile(process.argv[3], JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ live_sdk_read: 'passed', article_id: id, title: evidence.article.article.title, output: process.argv[3] }));
