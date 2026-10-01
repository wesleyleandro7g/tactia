import { describe, expect, it } from 'vitest';
import {
  BROWSER_COMPACT_POLL_MS,
  BROWSER_ERROR_FALLBACK,
  BROWSER_LIVE_POLL_MS,
  BROWSER_STATUS_LABELS,
  browserDownloadLabel,
  browserProgressHost,
  browserStatusLabel,
  browserCardBlocksFollowUps,
  browserResultWaitExpired,
  browserTaskPollDelay,
  browserUserError,
  canStopBrowserTask,
  conversationBlocksFollowUps,
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

  it('keeps polling until the elaborated answer is saved', () => {
    expect(browserCardBlocksFollowUps('RUNNING', false)).toBe(true);
    expect(browserCardBlocksFollowUps('COMPLETED', false)).toBe(true);
    expect(browserCardBlocksFollowUps('FAILED', false)).toBe(true);
    expect(browserCardBlocksFollowUps('COMPLETED', true)).toBe(false);
    expect(browserCardBlocksFollowUps('CANCELLED', false)).toBe(false);
    expect(browserTaskPollDelay('COMPLETED', false, true)).toBe(BROWSER_COMPACT_POLL_MS);
    expect(browserTaskPollDelay('CANCELLED', false, false)).toBeNull();
    expect(browserResultWaitExpired(1_000, 1_000 + 59_999)).toBe(false);
    expect(browserResultWaitExpired(1_000, 1_000 + 60_000)).toBe(true);
    expect(browserResultWaitExpired(null, 61_000)).toBe(false);
  });

  it('hides follow-ups for a task started in this session until the card reports it idle', () => {
    const pending = new Set(['task-new']);
    expect(conversationBlocksFollowUps(['task-new'], {}, pending)).toBe(true);
    expect(conversationBlocksFollowUps(['task-new'], { 'task-new': true }, pending)).toBe(true);
    expect(conversationBlocksFollowUps(['task-new'], { 'task-new': false }, pending)).toBe(false);
    expect(conversationBlocksFollowUps(['task-old'], {}, new Set())).toBe(false);
  });

  it('flags queued tasks that have not been claimed after 15 seconds', () => {
    const createdAt = '2026-09-26T20:00:00.000Z';
    expect(isBrowserTaskQueuedStale('QUEUED', createdAt, Date.parse(createdAt) + 14_999)).toBe(false);
    expect(isBrowserTaskQueuedStale('QUEUED', createdAt, Date.parse(createdAt) + 15_000)).toBe(true);
    expect(isBrowserTaskQueuedStale('RUNNING', createdAt, Date.parse(createdAt) + 60_000)).toBe(false);
  });

  it('labels each status in plain language and hides unknown codes', () => {
    expect(BROWSER_STATUS_LABELS).toEqual({
      QUEUED: 'Preparando',
      RUNNING: 'Navegando',
      WAITING_APPROVAL: 'Aguardando',
      COMPLETED: 'Pronto',
      FAILED: 'Não concluí',
      CANCELLED: 'Interrompido',
    });
    expect(browserStatusLabel('EXPLODED')).toBe('Em andamento');
    expect(browserUserError('NETWORK_BLOCKED')).toBe('Esse site não está liberado para esta empresa.');
    expect(browserUserError('ELEMENT_NOT_FOUND_42')).toBe(BROWSER_ERROR_FALLBACK);
    expect(browserProgressHost('https://erp.exemplo.com/app/pedidos?token=1#sec')).toBe('erp.exemplo.com');
    expect(browserProgressHost('não é url')).toBeNull();
    expect(browserDownloadLabel('vendas-agosto.pdf')).toBe('Baixar vendas-agosto.pdf');
    expect(browserDownloadLabel('a1b2c3d4e5f67890.bin')).toBe('Baixar relatório');
  });

  it('shows stop only for active tasks and members allowed to control them', () => {
    for (const status of ['QUEUED', 'RUNNING', 'WAITING_APPROVAL']) {
      expect(canStopBrowserTask(status, true)).toBe(true);
      expect(canStopBrowserTask(status, false)).toBe(false);
    }
    for (const status of ['COMPLETED', 'FAILED', 'CANCELLED']) {
      expect(canStopBrowserTask(status, true)).toBe(false);
    }
  });
});
