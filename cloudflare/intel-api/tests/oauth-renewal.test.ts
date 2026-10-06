import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('real OAuth provider rotates active grants beyond 24h; idle, scope escalation and revocation fail closed', async () => {
  const bundle = await build({entryPoints: ['tests/oauth-fixture.ts'], bundle: true, write: false,
    format: 'esm', platform: 'browser', external: ['cloudflare:workers']});
  const mf = new Miniflare(convertV4MiniflareOptions({modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat','global_fetch_strictly_public'], kvNamespaces: ['OAUTH_KV']}));
  const epoch = Date.now();
  let now = epoch;
  const request = (path: string, init: any = {}) => mf.dispatchFetch(`http://localhost${path}`, {
    ...init, headers: {...init.headers, 'test-clock': String(now)},
  });
  const post = (path: string, body: Record<string,string>) => request(path, {
    method: 'POST', headers: {'content-type':'application/x-www-form-urlencoded'}, body: new URLSearchParams(body),
  });
  try {
    const registered = await request('/register', {method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({redirect_uris:['http://localhost/cb'], token_endpoint_auth_method:'none',
        grant_types:['authorization_code','refresh_token'], response_types:['code'], client_name:'local test'})});
    assert.equal(registered.status, 201);
    const client = await registered.json() as any;
    const verifier = 'local-integration-verifier-012345678901234567890123456789';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const issue = async (scope: string) => {
      const qs = new URLSearchParams({client_id: client.client_id, redirect_uri:'http://localhost/cb',
        response_type:'code', scope, resource:'http://localhost/mcp', code_challenge:challenge, code_challenge_method:'S256'});
      const auth = await request(`/authorize?${qs}`);
      assert.equal(auth.status,200);
      const redirect = await auth.json() as any;
      const code = new URL(redirect.redirectTo).searchParams.get('code')!;
      const tokens = await post('/token', {grant_type:'authorization_code', client_id:client.client_id,
        redirect_uri:'http://localhost/cb', code, code_verifier:verifier, resource:'http://localhost/mcp'});
      assert.equal(tokens.status,200);
      return tokens.json() as Promise<any>;
    };
    let a = await issue('processing:a');
    const b = await issue('processing:b');
    assert.equal((await request('/mcp', {headers:{authorization:`Bearer ${a.access_token}`}})).status,200,
      'B login must preserve the separate A grant');
    assert.equal(a.expires_in,3600);
    const refresh = (token: string, scope?: string) => post('/token', {grant_type:'refresh_token',
      client_id:client.client_id, refresh_token:token, resource:'http://localhost/mcp', ...(scope ? {scope}: {})});
    now = epoch + 23 * 3600000;
    let r = await refresh(a.refresh_token);
    assert.equal(r.status,200);
    const renewed = await r.json() as any;
    assert.notEqual(renewed.refresh_token,a.refresh_token);
    a = renewed;
    now = epoch + 46 * 3600000;
    r = await refresh(a.refresh_token);
    assert.equal(r.status,200,'active rotation must survive the original fixed 24h expiry');
    a = await r.json() as any;
    assert.equal((await refresh(a.refresh_token,'processing:b')).status,400,'A cannot acquire B scope by refresh');
    assert.equal((await refresh(b.refresh_token)).status,400,'B expired after >24h idle');
    assert.equal((await request('/test/revoke')).status,200);
    assert.equal((await refresh(a.refresh_token)).status,400,'revocation must prevent renewal');
  } finally { await mf.dispose(); }
});
