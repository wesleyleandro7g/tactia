import { AppError, ErrorCode } from '@tactia/shared';

export type BrowserElement = {
  ref: string;
  role: string;
  name: string;
  href?: string;
};
export type BrowserState = {
  url: string;
  title: string;
  /** Legacy combined representation retained while runtimes roll forward. */
  text: string;
  visibleText?: string;
  elements?: BrowserElement[];
  navigationItems?: BrowserElement[];
  fingerprint?: string;
  refs: Record<string, string>;
  tabs: Array<{ id: string; url: string }>;
};
export type BrowserAction = { type: 'click' | 'fill' | 'press' | 'wait' | 'scroll' | 'select' | 'check' | 'hover' | 'download'; target?: string; value?: string; seconds?: number };

const RUNTIME_ERROR_CODES =
  /(?:ELEMENT_NOT_FOUND|NETWORK_BLOCKED|SESSION_EXPIRED|DOWNLOAD_TIMEOUT|CAPACITY_EXCEEDED|PAGE_CRASHED|EGRESS_PROXY_REQUIRED)/;

export function browserRuntimeErrorCode(status: number, body: string): string {
  const known = body.match(RUNTIME_ERROR_CODES)?.[0];
  if (known) return known;
  if (status === 401 || status === 403) return 'BROWSER_RUNTIME_UNAUTHORIZED';
  if (status === 502 || status === 503 || status === 504) return 'BROWSER_RUNTIME_UNAVAILABLE';
  return 'BROWSER_RUNTIME_ERROR';
}

export class BrowserRuntimeClient {
  private readonly baseUrl: string;
  readonly runtimeId: string;

  constructor(runtimeId = 'default') {
    this.runtimeId = runtimeId;
    const configured = process.env.BROWSER_RUNTIME_URLS?.split(',').map((part) => part.trim()).filter(Boolean) ?? [];
    this.baseUrl = configured[Number(runtimeId) || 0] ?? process.env.BROWSER_RUNTIME_URL ?? 'http://browser-runtime:8765';
  }

  static select(taskId: string) {
    const count = process.env.BROWSER_RUNTIME_URLS?.split(',').filter(Boolean).length ?? 0;
    const index = count ? [...taskId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % count : 0;
    return new BrowserRuntimeClient(String(index));
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
    const token = process.env.BROWSER_RUNTIME_TOKEN;
    if (!token) throw new AppError(ErrorCode.INTERNAL_ERROR, 'BROWSER_RUNTIME_TOKEN is not configured');
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'x-browser-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      const code = browserRuntimeErrorCode(response.status, raw);
      throw new AppError(response.status === 400 ? ErrorCode.VALIDATION_ERROR : ErrorCode.INTERNAL_ERROR, code);
    }
    return response.json() as Promise<T>;
  }

  start(input: { sessionId: string; startUrl: string; allowedDomains: string[]; storageState?: object | null }) {
    return this.request<{ sessionId: string; state: BrowserState }>('POST', '/internal/browser/sessions', input);
  }
  navigate(sessionId: string, url: string) {
    return this.request<{ success: boolean; state: BrowserState }>('POST', `/internal/browser/sessions/${sessionId}/navigate`, { url });
  }
  snapshot(sessionId: string) {
    return this.request<BrowserState>('POST', `/internal/browser/sessions/${sessionId}/snapshot`);
  }
  action(sessionId: string, action: BrowserAction) {
    return this.request<{ success: boolean; state: BrowserState; download?: { filename: string; size: number } }>('POST', `/internal/browser/sessions/${sessionId}/actions`, action);
  }
  screenshot(sessionId: string) {
    return this.request<{ mimeType: string; base64: string }>('POST', `/internal/browser/sessions/${sessionId}/screenshot`);
  }
  extract(sessionId: string) {
    return this.request<{ text: string }>('POST', `/internal/browser/sessions/${sessionId}/extract`);
  }
  close(sessionId: string) {
    return this.request<{ closed: boolean; storageState: object | null }>('DELETE', `/internal/browser/sessions/${sessionId}`);
  }
  async download(sessionId: string, filename: string): Promise<Buffer> {
    const token = process.env.BROWSER_RUNTIME_TOKEN;
    if (!token) throw new AppError(ErrorCode.INTERNAL_ERROR, 'BROWSER_RUNTIME_TOKEN is not configured');
    const response = await fetch(`${this.baseUrl}/internal/browser/sessions/${sessionId}/downloads/${encodeURIComponent(filename)}`, {
      headers: { 'x-browser-token': token }, signal: AbortSignal.timeout(60_000), cache: 'no-store',
    });
    if (!response.ok) throw new AppError(ErrorCode.INTERNAL_ERROR, 'DOWNLOAD_NOT_FOUND');
    return Buffer.from(await response.arrayBuffer());
  }
}
