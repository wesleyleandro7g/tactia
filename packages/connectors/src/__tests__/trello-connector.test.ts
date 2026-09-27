import { describe, expect, it, vi } from 'vitest';
import { TrelloClient } from '../trello-client';
import { TrelloOAuthError } from '../trello-oauth';
import type { RawRecordRepository } from '@tactia/database';
import { TrelloConnector } from '../trello-connector';

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('TrelloClient', () => {
  it('authenticates in the header and never puts credentials in the URL', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => response({ id: 'member-1', username: 'ops' }));
    const client = new TrelloClient({
      auth: { apiKey: 'key-secret', token: 'token-secret' },
      baseUrl: 'https://trello.test/1',
      fetch: fetcher,
    });

    await client.me();

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).not.toContain('secret');
    expect(new Headers(init?.headers).get('authorization')).toContain('oauth_consumer_key="key-secret"');
  });

  it('retries 429 and succeeds', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ error: 'API_TOKEN_LIMIT_EXCEEDED', message: 'Rate limit exceeded' }, 429))
      .mockResolvedValueOnce(response([{ id: 'board-1' }]));
    const sleep = vi.fn(async () => undefined);
    const client = new TrelloClient({
      auth: { apiKey: 'key', token: 'token' },
      baseUrl: 'https://trello.test/1',
      fetch: fetcher,
      sleep,
    });

    expect(await client.listBoards()).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('classifies revoked credentials without retrying', async () => {
    const fetcher = vi.fn(async () => response({ message: 'invalid token' }, 401));
    const client = new TrelloClient({ auth: { apiKey: 'key', token: 'bad' }, fetch: fetcher });
    await expect(client.me()).rejects.toMatchObject({ status: 401, retryable: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('refreshes an OAuth access token once after a 401', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ message: 'expired' }, 401))
      .mockResolvedValueOnce(response({ id: 'member-1' }));
    const refreshAccessToken = vi.fn(async () => 'access-2');
    const client = new TrelloClient({
      auth: { kind: 'oauth2', accessToken: 'access-1', refreshAccessToken },
      fetch: fetcher,
    });
    await expect(client.me()).resolves.toMatchObject({ id: 'member-1' });
    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('Bearer access-2');
  });

  it('does not retry an invalid OAuth grant as a network error', async () => {
    const fetcher = vi.fn(async () => response({ message: 'expired' }, 401));
    const refreshAccessToken = vi.fn(async () => {
      throw new TrelloOAuthError('Refresh token expired', 'invalid_grant', 400);
    });
    const client = new TrelloClient({
      auth: { kind: 'oauth2', accessToken: 'access-1', refreshAccessToken },
      fetch: fetcher,
    });
    await expect(client.me()).rejects.toMatchObject({ name: 'TrelloOAuthError', code: 'invalid_grant' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(refreshAccessToken).toHaveBeenCalledOnce();
  });
});

describe('TrelloConnector', () => {
  it('discovers Trello resources and previews selected boards', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/members/me')) return response({ id: 'member-1' });
      if (path.endsWith('/boards/b1')) return response({ id: 'b1', name: 'Delivery', closed: false });
      if (path.endsWith('/boards/b1/cards/all')) return response([{ id: 'c1', name: 'Ship', idList: 'l1', customFieldItems: [{ idCustomField: 'cf1', value: { text: 'High' } }] }]);
      if (path.endsWith('/boards/b1/customFields')) return response([{ id: 'cf1', name: 'Priority', fieldGroup: 'group-priority', type: 'text' }]);
      return response([]);
    });
    const connector = new TrelloConnector({
      boardIds: ['b1'],
      auth: { apiKey: 'key', token: 'token' },
      baseUrl: 'https://trello.test/1',
      fetch: fetcher as typeof fetch,
    });

    const cards = await connector.fetch('cards', { limit: 10 });
    expect(cards[0]).toMatchObject({ id: 'c1', board_id: 'b1', board_name: 'Delivery', 'custom.group-priority': 'High' });
    const discovery = await connector.discover();
    expect(discovery.resources.map((item) => item.name)).toContain('actions');
  });

  it('persists the proprietary model without mappings and duplicates configured projections', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/boards/b1')) return response({ id: 'b1', name: 'Delivery' });
      if (path.endsWith('/boards/b1/cards/all')) return response([{ id: 'c1', name: 'Ship', idList: 'doing' }]);
      return response([]);
    });
    const upsertByKey = vi.fn(async (_input: Parameters<RawRecordRepository['upsertByKey']>[0]) => ({ record: { id: 'raw', checksum: 'sum' }, created: true }));
    const connector = new TrelloConnector({
      boardIds: ['b1'],
      auth: { apiKey: 'key', token: 'token' },
      baseUrl: 'https://trello.test/1',
      fetch: fetcher as typeof fetch,
    }, { upsertByKey } as unknown as RawRecordRepository);

    await connector.sync({
      tenantId: 'tenant', dataSourceId: 'source', syncJobId: 'job',
      mappings: [{ sourceEntity: 'cards', targetEntity: 'activity', configuration: { fields: [] } }],
    });

    const inputs = upsertByKey.mock.calls.map(([input]) => input);
    expect(inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'trello:boards', externalId: 'b1' }),
      expect.objectContaining({ entityType: 'trello:cards', externalId: 'c1' }),
      expect.objectContaining({ entityType: 'activity', externalId: 'cards:c1' }),
    ]));
  });
});

import {
  computeTrelloWebhookSignature,
  sanitizeTrelloPayload,
  verifyTrelloWebhookSignature,
} from '../trello-webhook';

describe('Trello webhook security', () => {
  it('verifies the exact raw body and callback URL', () => {
    const rawBody = '{"action":{"id":"a1"}}';
    const callbackUrl = 'https://app.test/api/v1/webhooks/trello/s1?tenantId=t1';
    const signature = computeTrelloWebhookSignature(rawBody, callbackUrl, 'app-secret');
    expect(verifyTrelloWebhookSignature({ rawBody, callbackUrl, secret: 'app-secret', signature })).toBe(true);
    expect(verifyTrelloWebhookSignature({ rawBody: `${rawBody} `, callbackUrl, secret: 'app-secret', signature })).toBe(false);
  });

  it('removes duplicated member profile PII but keeps identifiers and comments', () => {
    expect(sanitizeTrelloPayload({
      id: 'a1',
      memberCreator: { id: 'm1', fullName: 'Person', username: 'person', avatarUrl: 'https://avatar' },
      data: { text: 'Operational comment' },
    })).toEqual({ id: 'a1', memberCreator: { id: 'm1' }, data: { text: 'Operational comment' } });
  });
});
