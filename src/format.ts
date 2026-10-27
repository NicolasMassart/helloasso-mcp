/** Removes null/undefined/empty-string values recursively to keep tool output small. */
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined || v === '') continue;
      out[k] = compact(v);
    }
    return out;
  }
  return value;
}

export function toCompactJson(value: unknown): string {
  return JSON.stringify(compact(value ?? null));
}
