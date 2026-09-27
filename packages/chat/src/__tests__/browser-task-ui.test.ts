import { describe, expect, it } from 'vitest';
import {
  BROWSER_COMPACT_POLL_MS,
  BROWSER_LIVE_POLL_MS,
  browserTaskPollDelay,
  canStopBrowserTask,
  isBrowserTaskActive,
  isBrowserTaskQueuedStale,
} from '../browser-task-ui';

describe('browser task card rules', () => {
  it.each(['QUEUED', 'RUNNING', 'WAITING_APPROVAL'])(
    'polls %s every second when live and every 3 seconds when compact',
    (status) => {
      expect(browserTaskPollDelay(status, true)).toBe(BROWSER_LIVE_POLL_MS);
      expect(browserTaskPollDelay(status, false)).toBe(BROWSER_COMPACT_POLL_MS);
      expect(BROWSER_LIVE_POLL_MS).toBe(1000);
      expect(BROWSER_COMPACT_POLL_MS).toBe(3000);
    },
  );

  it.each(['COMPLETED', 'FAILED', 'CANCELLED'])('stops polling once %s', (status) => {
    expect(isBrowserTaskActive(status)).toBe(false);
    expect(browserTaskPollDelay(status, true)).toBeNull();
    expect(browserTaskPollDelay(status, false)).toBeNull();
  });

  it('flags queued tasks that have not been claimed after 15 seconds', () => {
    const createdAt = '2026-09-26T20:00:00.000Z';
    expect(isBrowserTaskQueuedStale('QUEUED', createdAt, Date.parse(createdAt) + 14_999)).toBe(false);
    expect(isBrowserTaskQueuedStale('QUEUED', createdAt, Date.parse(createdAt) + 15_000)).toBe(true);
    expect(isBrowserTaskQueuedStale('RUNNING', createdAt, Date.parse(createdAt) + 60_000)).toBe(false);
  });

  it('shows "Parar agente" only for active tasks and members allowed to control them', () => {
    for (const status of ['QUEUED', 'RUNNING', 'WAITING_APPROVAL']) {
      expect(canStopBrowserTask(status, true)).toBe(true);
      expect(canStopBrowserTask(status, false)).toBe(false);
    }
    for (const status of ['COMPLETED', 'FAILED', 'CANCELLED']) {
      expect(canStopBrowserTask(status, true)).toBe(false);
    }
  });
});
