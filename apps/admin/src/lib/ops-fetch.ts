import { errorMessage } from '@/lib/format';

type ApiError = { error?: { code?: string; message?: string }; data?: unknown };

async function parse(response: Response): Promise<ApiError | null> {
  return (await response.json().catch(() => null)) as ApiError | null;
}

export async function opsJson<T = Record<string, unknown>>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await parse(response);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? errorMessage(payload?.error?.code));
  }
  return (payload?.data ?? {}) as T;
}

export async function opsForm<T = Record<string, unknown>>(url: string, file: File): Promise<T> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(url, { method: 'POST', body });
  const payload = await parse(response);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? errorMessage(payload?.error?.code));
  }
  return (payload?.data ?? {}) as T;
}
