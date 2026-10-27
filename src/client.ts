import { TokenManager, readBody } from './auth.js';
import { HelloAssoError, errorDetail, retryAfter } from './errors.js';

export type QueryValue = string | number | boolean | undefined | null | Array<string | number>;

export interface HelloAssoClientOptions {
  apiBaseUrl: string;
  tokens: TokenManager;
  fetch?: typeof fetch;
}

/** Minimal read-only HTTP client for the HelloAsso API v5. */
export class HelloAssoClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HelloAssoClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /** GET `path` (already URL-encoded, relative to /v5). Arrays are sent as repeated keys. */
  async get(path: string, query: Record<string, QueryValue> = {}): Promise<unknown> {
    const url = new URL(this.opts.apiBaseUrl.replace(/\/$/, '') + path);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
      else url.searchParams.set(key, String(value));
    }

    let res = await this.send(url);
    if (res.status === 401) {
      // Token may have been revoked or expired early: renew once and retry.
      this.opts.tokens.invalidate();
      res = await this.send(url);
    }
    const body = await readBody(res);
    if (!res.ok) throw httpError(res, body, path);
    return body;
  }

  private async send(url: URL): Promise<Response> {
    const token = await this.opts.tokens.getAccessToken();
    try {
      return await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      });
    } catch (err) {
      throw new HelloAssoError(`Cannot reach the HelloAsso API: ${(err as Error).message}`);
    }
  }
}

function httpError(res: Response, body: unknown, path: string): HelloAssoError {
  const detail = errorDetail(body);
  const suffix = detail ? ` Details: ${detail}` : '';
  const s = res.status;
  let msg: string;
  switch (s) {
    case 400:
      msg = `HelloAsso rejected the request (400 Bad Request) for ${path}.`;
      break;
    case 401:
      msg = `HelloAsso returned 401 Unauthorized for ${path} even after renewing the token: authentication failed, check the API client credentials and HELLOASSO_ENV.`;
      break;
    case 403:
      msg = `HelloAsso returned 403 Forbidden for ${path}: the API client lacks the required role or privilege. Transaction data (orders, payments, items) needs the OrganizationAdmin (or FormAdmin) role and the AccessTransactions privilege, and an association API client can only read its own organization: check the organization slug.`;
      break;
    case 404:
      msg = `HelloAsso returned 404 Not Found for ${path}: check the organization slug, form type/slug or id.`;
      break;
    case 429:
      msg = `HelloAsso returned 429 Too Many Requests: rate limit reached.${retryAfter(res)}`;
      break;
    default:
      msg = s >= 500 ? `HelloAsso server error (${s}) for ${path}; try again later.` : `HelloAsso error ${s} for ${path}.`;
  }
  return new HelloAssoError(msg + suffix, s);
}
