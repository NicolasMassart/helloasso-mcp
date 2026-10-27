/** Error raised for any HelloAsso API / auth problem. Messages never contain secrets. */
export class HelloAssoError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HelloAssoError';
    this.status = status;
  }
}

/** Extracts a short, human readable detail from an API error body (never echoes request data). */
export function errorDetail(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body.slice(0, 300);
  if (typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['error_description', 'message', 'title', 'detail', 'error']) {
    if (typeof b[key] === 'string' && b[key]) parts.push(b[key] as string);
  }
  if (Array.isArray(b.errors)) {
    for (const e of b.errors.slice(0, 5)) {
      if (typeof e === 'string') parts.push(e);
      else if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).message === 'string') {
        parts.push((e as Record<string, string>).message);
      }
    }
  } else if (b.errors && typeof b.errors === 'object') {
    for (const [k, v] of Object.entries(b.errors).slice(0, 5)) parts.push(`${k}: ${JSON.stringify(v)}`);
  }
  return [...new Set(parts)].join('; ').slice(0, 500);
}

export function retryAfter(res: Response): string {
  const ra = res.headers.get('retry-after');
  return ra ? ` Retry after ${ra} seconds.` : ' Wait a bit before retrying.';
}
