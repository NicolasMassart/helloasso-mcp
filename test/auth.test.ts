import { describe, expect, it } from 'vitest';
import { TokenManager } from '../src/auth.js';
import { HelloAssoError } from '../src/errors.js';
import { jsonResponse, mockFetch, tokenOk } from './helpers.js';

const TOKEN_URL = 'https://api.helloasso-sandbox.com/oauth2/token';

function make(handlers: Parameters<typeof mockFetch>[0], clock = { t: 0 }) {
  const m = mockFetch(handlers);
  const tm = new TokenManager({
    clientId: 'my-client-id',
    clientSecret: 'super-secret-value',
    tokenUrl: TOKEN_URL,
    fetch: m.fetch,
    now: () => clock.t,
  });
  return { tm, ...m, clock };
}

describe('TokenManager', () => {
  it('gets a token with client_credentials, form-encoded', async () => {
    const { tm, calls } = make([tokenOk('A1', 'R1')]);
    expect(await tm.getAccessToken()).toBe('A1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TOKEN_URL);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['content-type']).toContain('application/x-www-form-urlencoded');
    const body = new URLSearchParams(calls[0].body);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('my-client-id');
    expect(body.get('client_secret')).toBe('super-secret-value');
  });

  it('caches the access token until shortly before expiry', async () => {
    const { tm, calls, clock } = make([tokenOk('A1', 'R1', '1800')]);
    await tm.getAccessToken();
    clock.t = 1000 * 1000; // 1000 s later, still valid
    expect(await tm.getAccessToken()).toBe('A1');
    expect(calls).toHaveLength(1);
  });

  it('uses the refresh_token (not client credentials) once expired', async () => {
    const { tm, calls, clock } = make([tokenOk('A1', 'R1'), tokenOk('A2', 'R2'), tokenOk('A3', 'R3')]);
    await tm.getAccessToken();
    clock.t = 1800 * 1000;
    expect(await tm.getAccessToken()).toBe('A2');
    const body = new URLSearchParams(calls[1].body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('R1');
    expect(body.get('client_secret')).toBeNull();
    // next refresh uses the rotated refresh token
    clock.t = 2 * 1800 * 1000;
    await tm.getAccessToken();
    expect(new URLSearchParams(calls[2].body).get('refresh_token')).toBe('R2');
  });

  it('falls back to client_credentials when the refresh token is rejected', async () => {
    const { tm, calls, clock } = make([
      tokenOk('A1', 'R1'),
      () => jsonResponse(400, { error: 'invalid_grant' }),
      tokenOk('A2', 'R2'),
    ]);
    await tm.getAccessToken();
    clock.t = 1800 * 1000;
    expect(await tm.getAccessToken()).toBe('A2');
    expect(new URLSearchParams(calls[2].body).get('grant_type')).toBe('client_credentials');
  });

  it('invalidate() forces a refresh on next call', async () => {
    const { tm, calls } = make([tokenOk('A1', 'R1'), tokenOk('A2', 'R2')]);
    await tm.getAccessToken();
    tm.invalidate();
    expect(await tm.getAccessToken()).toBe('A2');
    expect(new URLSearchParams(calls[1].body).get('grant_type')).toBe('refresh_token');
  });

  it('deduplicates concurrent token requests', async () => {
    const { tm, calls } = make([tokenOk('A1', 'R1')]);
    const [a, b] = await Promise.all([tm.getAccessToken(), tm.getAccessToken()]);
    expect(a).toBe('A1');
    expect(b).toBe('A1');
    expect(calls).toHaveLength(1);
  });

  it('fails clearly when credentials are missing, without calling the API', async () => {
    const m = mockFetch([]);
    const tm = new TokenManager({ clientId: '', clientSecret: '', tokenUrl: TOKEN_URL, fetch: m.fetch });
    await expect(tm.getAccessToken()).rejects.toThrow(/HELLOASSO_CLIENT_ID/);
    expect(m.calls).toHaveLength(0);
  });

  it('reports bad credentials without leaking the secret', async () => {
    const { tm } = make([() => jsonResponse(401, { error: 'unauthorized_client', error_description: 'bad' })]);
    const err = await tm.getAccessToken().catch((e) => e);
    expect(err).toBeInstanceOf(HelloAssoError);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/authentication failed/i);
    expect(err.message).not.toContain('super-secret-value');
  });

  it('reports token endpoint rate limiting (429)', async () => {
    const { tm } = make([() => jsonResponse(429, {}, { 'retry-after': '30' })]);
    await expect(tm.getAccessToken()).rejects.toThrow(/rate limit.*30/i);
  });
});
