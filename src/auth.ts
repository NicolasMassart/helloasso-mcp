import { HelloAssoError, errorDetail, retryAfter } from './errors.js';

export interface TokenManagerOptions {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Renew the access token this many ms before it expires (default 60 s). */
  skewMs?: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
}

const DEFAULT_EXPIRES_IN_S = 1800;
/** HelloAsso refresh tokens last 30 days; we stop using them a day early. */
const REFRESH_TTL_MS = 29 * 24 * 3600 * 1000;

/**
 * OAuth2 client_credentials token cache for HelloAsso.
 * - caches the access token (30 min) in memory,
 * - renews it with the refresh_token, as HelloAsso requires (do not re-authenticate every call),
 * - falls back to client_credentials only if the refresh token is missing, expired or rejected.
 */
export class TokenManager {
  private accessToken?: string;
  private accessExpiresAt = 0;
  private refreshToken?: string;
  private refreshExpiresAt = 0;
  private inflight?: Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly skewMs: number;

  constructor(private readonly opts: TokenManagerOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.skewMs = opts.skewMs ?? 60_000;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.accessExpiresAt - this.skewMs) return this.accessToken;
    if (!this.inflight) {
      this.inflight = this.renew().finally(() => {
        this.inflight = undefined;
      });
    }
    return this.inflight;
  }

  /** Forget the current access token (e.g. after a 401); the refresh token is kept. */
  invalidate(): void {
    this.accessToken = undefined;
    this.accessExpiresAt = 0;
  }

  private async renew(): Promise<string> {
    if (this.refreshToken && this.now() < this.refreshExpiresAt) {
      try {
        return await this.request({ grant_type: 'refresh_token', refresh_token: this.refreshToken });
      } catch (err) {
        // Rate limiting is not a reason to re-authenticate: it would only make things worse.
        if (err instanceof HelloAssoError && err.status === 429) throw err;
        this.refreshToken = undefined;
      }
    }
    if (!this.opts.clientId || !this.opts.clientSecret) {
      throw new HelloAssoError(
        'HelloAsso credentials are missing: set HELLOASSO_CLIENT_ID and HELLOASSO_CLIENT_SECRET in the MCP server environment.',
      );
    }
    return this.request({
      grant_type: 'client_credentials',
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
    });
  }

  private async request(form: Record<string, string>): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.opts.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams(form).toString(),
      });
    } catch (err) {
      throw new HelloAssoError(`Cannot reach the HelloAsso token endpoint: ${(err as Error).message}`);
    }
    const body = await readBody(res);
    if (!res.ok) {
      const detail = errorDetail(body);
      const suffix = detail ? ` (${detail})` : '';
      if (res.status === 429) {
        throw new HelloAssoError(
          `HelloAsso token endpoint rate limit reached (429): max 10 calls/10 s, 20/10 min, 50/hour.${retryAfter(res)}`,
          429,
        );
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new HelloAssoError(
          `HelloAsso authentication failed (${res.status})${suffix}. Check HELLOASSO_CLIENT_ID / HELLOASSO_CLIENT_SECRET and HELLOASSO_ENV (sandbox keys only work with sandbox, production keys with production).`,
          res.status,
        );
      }
      throw new HelloAssoError(`HelloAsso token endpoint error (${res.status})${suffix}.`, res.status);
    }
    const t = (body ?? {}) as TokenResponse;
    if (!t.access_token) throw new HelloAssoError('HelloAsso token endpoint returned no access_token.');
    const expiresIn = Number(t.expires_in);
    const now = this.now();
    this.accessToken = t.access_token;
    this.accessExpiresAt = now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_EXPIRES_IN_S) * 1000;
    if (t.refresh_token) {
      this.refreshToken = t.refresh_token;
      this.refreshExpiresAt = now + REFRESH_TTL_MS;
    }
    return t.access_token;
  }
}

export async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
