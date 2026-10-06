// Local workerd integration fixture only. Never deploy this handler.
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { AUTH_POLICY } from '../src/auth-policy';
const realNow = Date.now.bind(Date);
let clock = realNow();
Date.now = () => clock;
const provider = new OAuthProvider<any>({
  apiRoute: '/mcp', apiHandler: { async fetch() { return new Response('authorized'); } },
  authorizeEndpoint: '/authorize', tokenEndpoint: '/token', clientRegistrationEndpoint: '/register',
  scopesSupported: ['processing:a', 'processing:b'], requiredScopes: [],
  ...AUTH_POLICY,
  resourceMetadata: { resource: 'http://localhost/mcp', authorization_servers: ['http://localhost'] },
  defaultHandler: { async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/authorize') {
      const auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      return Response.json(await env.OAUTH_PROVIDER.completeAuthorization({
        request: auth, userId: 'local-test-owner', scope: auth.scope, props: {},
        revokeExistingGrants: false,
      }));
    }
    if (url.pathname === '/test/revoke') {
      const grants = await env.OAUTH_PROVIDER.listUserGrants('local-test-owner');
      for (const grant of grants.items) await env.OAUTH_PROVIDER.revokeGrant(grant.id, 'local-test-owner');
      return new Response('revoked');
    }
    return new Response('not found', {status: 404});
  } },
});
export default { async fetch(request: Request, env: any, ctx: ExecutionContext) {
  clock = Number(request.headers.get('test-clock') || realNow());
  return provider.fetch(request, env, ctx);
} };
