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
  body: JSON.stringify({ client_name: 'Phase 2B read-only SDK acceptance', redirect_uris: ['http://localhost:9876/callback'],
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
const client = new Client({ name: 'phase2b-read-only-acceptance', version: '1.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), {
  requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
}));
const tools = await client.listTools();
assert.ok(tools.tools.some(t=>t.name==='save_prefilter'));
const denied=await client.callTool({name:'save_prefilter',arguments:{article_id:'missing',run_id:'scope-negative',prompt_version:'robotics-plus-mcp.phase2b.v1',status:'PASS',reason:'must not write'}});
assert.equal(denied.isError,true);
evidence.legacy_read_scope_cannot_write=true;
await client.close();
// Issue a separate read-only SDK role token. Never writes production judgments.
async function roleRead(role){
 const q=new URLSearchParams(query);q.set('scope',`processing:${role.toLowerCase()}`);q.set('state',crypto.randomUUID());
 const c=await fetch(origin+'/authorize?'+q);assert.equal(c.status,200);const html=await c.text();
 const h=html.match(/name="handle" value="([^"]+)"/)[1];
 const cookies=c.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const a=await fetch(origin+'/authorize',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookies,Origin:origin},body:new URLSearchParams({handle:h,owner_key:secret,decision:'approve',reviewer_role:role})});assert.equal(a.status,302);
 const code=new URL(a.headers.get('location')).searchParams.get('code');
 const t=await fetch(origin+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientInfo.client_id,code,redirect_uri:'http://localhost:9876/callback',code_verifier:verifier,resource:origin+'/mcp'})});assert.equal(t.status,200);const tok=await t.json();assert.equal(tok.scope,`processing:${role.toLowerCase()}`);
 const cl=new Client({name:'phase2b1-sdk-role-'+role,version:'1'});await cl.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp/reviewer-'+role.toLowerCase()),{requestInit:{headers:{Authorization:`Bearer ${tok.access_token}`}}}));
 const ts=await cl.listTools();const names=ts.tools.map(t=>t.name);
 assert.deepEqual(names,role==='A'?['get_reviewer_a_batch','get_reviewer_a_receipt','validate_review_result','append_review_probe','submit_reviewer_a_result']:['get_reviewer_b_batch','get_reviewer_b_receipt','submit_reviewer_b_result']); if(role==='A') { for(const name of ['validate_review_result','append_review_probe','submit_reviewer_a_result']) {const tool=ts.tools.find(t=>t.name===name); assert.equal(tool.annotations.readOnlyHint,name==='validate_review_result'); assert.equal(tool.annotations.destructiveHint,false); assert.equal(tool.annotations.openWorldHint,false); assert.equal(tool.annotations.idempotentHint,true);} }
 const facts=await cl.callTool({name:`get_reviewer_${role.toLowerCase()}_batch`,arguments:{limit:1,...(process.argv[4]?{article_id:process.argv[4]}:{})}});assert.ok(!facts.isError);
 const other=await fetch(origin+'/mcp/reviewer-'+(role==='A'?'b':'a'),{headers:{Authorization:`Bearer ${tok.access_token}`}});assert.equal(other.status,403);
 const legacy=await fetch(origin+'/mcp',{headers:{Authorization:`Bearer ${tok.access_token}`}});assert.equal(legacy.status,403);
 await cl.close();return {scope:tok.scope,tools:names,batch:facts.structuredContent,metadata:ts.tools,other_role_http:other.status,legacy_http:legacy.status};
}
evidence.reviewer_a=await roleRead('A');evidence.reviewer_b=await roleRead('B');
await fs.writeFile(process.argv[3],JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({sdk_read_only:'passed',roles:['A','B'],output:process.argv[3]}));
