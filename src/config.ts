export type HelloAssoEnv = 'production' | 'sandbox';

export interface Config {
  clientId: string;
  clientSecret: string;
  /** Organization slug used when a tool call does not pass `orgSlug`. */
  defaultOrgSlug?: string;
  env: HelloAssoEnv;
  apiBaseUrl: string;
  tokenUrl: string;
}

const HOSTS: Record<HelloAssoEnv, string> = {
  production: 'https://api.helloasso.com',
  sandbox: 'https://api.helloasso-sandbox.com',
};

/**
 * Reads configuration from environment variables. Missing credentials do not throw here so the
 * server can still start and list its tools; tool calls report the problem instead.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const rawEnv = (env.HELLOASSO_ENV ?? 'sandbox').trim().toLowerCase() || 'sandbox';
  if (rawEnv !== 'production' && rawEnv !== 'sandbox') {
    throw new Error(`Invalid HELLOASSO_ENV "${rawEnv}": expected "production" or "sandbox".`);
  }
  const host = HOSTS[rawEnv];
  const slug = (env.HELLOASSO_ORG_SLUG ?? '').trim();
  return {
    clientId: (env.HELLOASSO_CLIENT_ID ?? '').trim(),
    clientSecret: (env.HELLOASSO_CLIENT_SECRET ?? '').trim(),
    defaultOrgSlug: slug || undefined,
    env: rawEnv,
    apiBaseUrl: `${host}/v5`,
    tokenUrl: `${host}/oauth2/token`,
  };
}
