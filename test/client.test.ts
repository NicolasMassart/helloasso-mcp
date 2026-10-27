import { describe, expect, it } from 'vitest';
import { TokenManager } from '../src/auth.js';
import { HelloAssoClient } from '../src/client.js';
import { jsonResponse, mockFetch, tokenOk } from './helpers.js';

const BASE = 'https://api.helloasso-sandbox.com/v5';

function make(handlers: Parameters<typeof mockFetch>[0]) {
  const m = mockFetch(handlers);
  const tokens = new TokenManager({
    clientId: 'id',
    clientSecret: 'secret',
    tokenUrl: 'https://api.helloasso-sandbox.com/oauth2/token',
    fetch: m.fetch,
  });
  const client = new HelloAssoClient({ apiBaseUrl: BASE, tokens, fetch: m.fetch });
  return { client, ...m };
}

describe('HelloAssoClient.get', () => {
  it('sends the bearer token and serializes query params', async () => {
    const { client, calls } = make([tokenOk('A1'), () => jsonResponse(200, { ok: true })]);
    const res = await client.get('/organizations/my-association/forms', {
      formTypes: ['Membership', 'Event'],
      pageSize: 50,
      withDetails: true,
      empty: undefined,
      blank: '',
    });
    expect(res).toEqual({ ok: true });
    const u = new URL(calls[1].url);
    expect(u.origin + u.pathname).toBe(`${BASE}/organizations/my-association/forms`);
    expect(u.searchParams.getAll('formTypes')).toEqual(['Membership', 'Event']);
    expect(u.searchParams.get('pageSize')).toBe('50');
    expect(u.searchParams.get('withDetails')).toBe('true');
    expect(u.searchParams.has('empty')).toBe(false);
    expect(u.searchParams.has('blank')).toBe(false);
    expect(calls[1].headers['authorization']).toBe('Bearer A1');
    expect(calls[1].headers['accept']).toBe('application/json');
  });

  it('on 401 refreshes the token once and retries', async () => {
    const { client, calls } = make([
      tokenOk('A1', 'R1'),
      () => jsonResponse(401, {}),
      tokenOk('A2', 'R2'),
      () => jsonResponse(200, { id: 1 }),
    ]);
    expect(await client.get('/payments/1')).toEqual({ id: 1 });
    expect(calls[3].headers['authorization']).toBe('Bearer A2');
    expect(new URLSearchParams(calls[2].body).get('grant_type')).toBe('refresh_token');
  });

  it('gives a clear error on persistent 401', async () => {
    const { client } = make([
      tokenOk('A1', 'R1'),
      () => jsonResponse(401, {}),
      tokenOk('A2', 'R2'),
      () => jsonResponse(401, {}),
    ]);
    await expect(client.get('/payments/1')).rejects.toThrow(/401.*(unauthori[sz]ed|authentication)/i);
  });

  it('explains 403 (missing role/privilege)', async () => {
    const { client } = make([tokenOk(), () => jsonResponse(403, { message: 'nope' })]);
    await expect(client.get('/organizations/other-association/orders')).rejects.toThrow(
      /403.*(OrganizationAdmin|privilege)/is,
    );
  });

  it('explains 429 with Retry-After', async () => {
    const { client } = make([tokenOk(), () => jsonResponse(429, {}, { 'retry-after': '12' })]);
    await expect(client.get('/organizations/my-association/payments')).rejects.toThrow(/429.*rate limit.*12/is);
  });

  it('explains 404', async () => {
    const { client } = make([tokenOk(), () => jsonResponse(404, {})]);
    await expect(client.get('/orders/999')).rejects.toThrow(/404.*not found/is);
  });

  it('includes API error details for 400', async () => {
    const { client } = make([tokenOk(), () => jsonResponse(400, { errors: [{ message: 'from must be before to' }] })]);
    await expect(client.get('/organizations/x/payments')).rejects.toThrow(/from must be before to/);
  });

  it('returns null for empty bodies', async () => {
    const { client } = make([tokenOk(), () => new Response(null, { status: 204 })]);
    expect(await client.get('/x')).toBeNull();
  });
});
