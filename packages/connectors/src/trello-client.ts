import { TrelloOAuthError } from './trello-oauth';
export type TrelloAuth =
  | { kind?: 'token'; apiKey: string; token: string }
  | { kind: 'oauth2'; accessToken: string; refreshAccessToken?: () => Promise<string> };

export type TrelloClientOptions = {
  auth: TrelloAuth;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
};

export class TrelloApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'TrelloApiError';
  }
}

function authHeader(auth: TrelloAuth): string {
  if (auth.kind === 'oauth2') return `Bearer ${auth.accessToken}`;
  return `OAuth oauth_consumer_key="${auth.apiKey}", oauth_token="${auth.token}"`;
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return Math.min(30_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
}

export class TrelloClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: TrelloClientOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://api.trello.com/1').replace(/\/$/, '');
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 4);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async get<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/${path.replace(/^\//, '')}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let refreshed = false;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(url, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: authHeader(this.options.auth) },
          signal: controller.signal,
        });
        const text = await response.text();
        let body: unknown;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }

        if (!response.ok) {
          if (
            response.status === 401 &&
            !refreshed &&
            this.options.auth.kind === 'oauth2' &&
            this.options.auth.refreshAccessToken
          ) {
            this.options.auth.accessToken = await this.options.auth.refreshAccessToken();
            refreshed = true;
            continue;
          }
          const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
          const code = typeof record['error'] === 'string' ? record['error'] : undefined;
          const message = typeof record['message'] === 'string' ? record['message'] : `Trello HTTP ${response.status}`;
          const retryable = response.status === 429 || response.status >= 500;
          if (retryable && attempt < this.maxAttempts) {
            await this.sleep(retryDelay(attempt, response.headers.get('retry-after')));
            continue;
          }
          throw new TrelloApiError(message, response.status, code, retryable);
        }

        const remainingHeader = response.headers.get('x-rate-limit-api-token-remaining');
        const remaining = remainingHeader == null ? Number.NaN : Number(remainingHeader);
        if (remaining === 0 && attempt < this.maxAttempts) {
          const interval = Number(response.headers.get('x-rate-limit-api-token-interval-ms'));
          await this.sleep(Number.isFinite(interval) && interval > 0 ? interval : 10_000);
        }
        return body as T;
      } catch (error) {
        if (error instanceof TrelloApiError || error instanceof TrelloOAuthError) throw error;
        if (attempt >= this.maxAttempts) {
          const message = error instanceof Error && error.name === 'AbortError'
            ? 'Trello request timed out'
            : error instanceof Error ? error.message : String(error);
          throw new TrelloApiError(message, 0, 'NETWORK_ERROR', true);
        }
        await this.sleep(retryDelay(attempt, null));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new TrelloApiError('Trello request failed', 0, 'UNKNOWN', true);
  }

  me() {
    return this.get<Record<string, unknown>>('members/me', { fields: 'id,username,fullName' });
  }

  listBoards() {
    return this.get<Array<Record<string, unknown>>>('members/me/boards', {
      filter: 'all',
      fields: 'id,name,closed,url,idOrganization,dateLastActivity',
    });
  }

  async listBoardActions(boardId: string, options: { since?: Date; limit?: number } = {}) {
    const result: Array<Record<string, unknown>> = [];
    const pageSize = Math.min(1000, Math.max(1, options.limit ?? 1000));
    let before: string | undefined;
    do {
      const page = await this.get<Array<Record<string, unknown>>>(`boards/${encodeURIComponent(boardId)}/actions`, {
        filter: 'all',
        limit: pageSize,
        ...(options.since ? { since: options.since.toISOString() } : {}),
        ...(before ? { before } : {}),
      });
      result.push(...page);
      if (page.length < pageSize) break;
      const last = page.at(-1);
      before = typeof last?.['id'] === 'string' ? last['id'] : undefined;
      if (!before) break;
    } while (true);
    return result;
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.mutate<T>('POST', path, body);
  }

  async delete(path: string): Promise<void> {
    await this.mutate<unknown>('DELETE', path);
  }

  createWebhook(input: { callbackURL: string; idModel: string; description?: string }) {
    return this.post<Record<string, unknown>>('webhooks', input);
  }

  deleteWebhook(webhookId: string) {
    return this.delete(`webhooks/${encodeURIComponent(webhookId)}`);
  }

  private async mutate<T>(method: 'POST' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/${path.replace(/^\//, '')}`;
    let refreshed = false;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(url, {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: authHeader(this.options.auth),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
        });
        const text = await response.text();
        const parsed = text ? JSON.parse(text) as unknown : undefined;
        if (!response.ok) {
          if (
            response.status === 401 &&
            !refreshed &&
            this.options.auth.kind === 'oauth2' &&
            this.options.auth.refreshAccessToken
          ) {
            this.options.auth.accessToken = await this.options.auth.refreshAccessToken();
            refreshed = true;
            continue;
          }
          const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
          const retryable = response.status === 429 || response.status >= 500;
          if (retryable && attempt < this.maxAttempts) {
            await this.sleep(retryDelay(attempt, response.headers.get('retry-after')));
            continue;
          }
          throw new TrelloApiError(
            typeof record['message'] === 'string' ? record['message'] : `Trello HTTP ${response.status}`,
            response.status,
            typeof record['error'] === 'string' ? record['error'] : undefined,
            retryable,
          );
        }
        return parsed as T;
      } catch (error) {
        if (error instanceof TrelloApiError || error instanceof TrelloOAuthError) throw error;
        if (attempt >= this.maxAttempts) throw new TrelloApiError(error instanceof Error ? error.message : String(error), 0, 'NETWORK_ERROR', true);
        await this.sleep(retryDelay(attempt, null));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new TrelloApiError('Trello request failed', 0, 'UNKNOWN', true);
  }
}
