import { vi } from 'vitest';

export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * Builds a fetch mock that answers from a queue of handlers and records every call.
 */
export function mockFetch(handlers: Array<(req: Recorded) => Response | Promise<Response>>) {
  const calls: Recorded[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const rec: Recorded = {
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : undefined,
    };
    calls.push(rec);
    const h = handlers.shift();
    if (!h) throw new Error(`Unexpected fetch call: ${rec.method} ${rec.url}`);
    return h(rec);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

export const tokenOk = (access = 'access-1', refresh = 'refresh-1', expiresIn: number | string = 1800) => () =>
  jsonResponse(200, { access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: expiresIn });
