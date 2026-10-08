// Short access tokens; active clients renew a bounded idle lease through rotation.
export const AUTH_POLICY = { accessTokenTTL: 3600, refreshTokenTTL: 86400, refreshTokenIdleTTL: 86400 } as const;
export const AUTH_CONSENT = 'Access tokens expire after one hour. The refresh grant expires after 24 hours without a successful refresh; active clients renew it through token rotation. Existing scopes and grant revocation remain in force.';
