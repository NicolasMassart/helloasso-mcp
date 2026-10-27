import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('defaults to sandbox URLs', () => {
    const c = loadConfig({ HELLOASSO_CLIENT_ID: 'id', HELLOASSO_CLIENT_SECRET: 'secret' });
    expect(c.env).toBe('sandbox');
    expect(c.apiBaseUrl).toBe('https://api.helloasso-sandbox.com/v5');
    expect(c.tokenUrl).toBe('https://api.helloasso-sandbox.com/oauth2/token');
    expect(c.defaultOrgSlug).toBeUndefined();
  });

  it('uses production URLs when HELLOASSO_ENV=production', () => {
    const c = loadConfig({ HELLOASSO_ENV: 'Production', HELLOASSO_ORG_SLUG: ' my-association ' });
    expect(c.env).toBe('production');
    expect(c.apiBaseUrl).toBe('https://api.helloasso.com/v5');
    expect(c.tokenUrl).toBe('https://api.helloasso.com/oauth2/token');
    expect(c.defaultOrgSlug).toBe('my-association');
  });

  it('rejects an unknown environment', () => {
    expect(() => loadConfig({ HELLOASSO_ENV: 'staging' })).toThrow(/HELLOASSO_ENV/);
  });

  it('does not throw when credentials are missing (tools report it at call time)', () => {
    const c = loadConfig({});
    expect(c.clientId).toBe('');
    expect(c.clientSecret).toBe('');
  });
});
