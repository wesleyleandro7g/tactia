import { describe, expect, it } from 'vitest';
import { computeTrelloKanbanMetrics } from '../trello-metrics';

describe('Trello Kanban metrics', () => {
  it('computes WIP, throughput, lead/cycle time, aging, overdue and backflow', () => {
    const now = new Date('2026-09-21T12:00:00.000Z');
    const cards = [
      { id: 'c1', idList: 'doing', closed: false, due: '2026-09-20T12:00:00.000Z', dueComplete: false, dateLastActivity: '2026-09-19T12:00:00.000Z' },
      { id: 'c2', idList: 'blocked', closed: false, dateLastActivity: '2026-09-21T00:00:00.000Z' },
      { id: 'c3', idList: 'done', closed: false, dateLastActivity: '2026-09-21T00:00:00.000Z' },
    ];
    const actions = [
      { id: 'a1', type: 'createCard', date: '2026-09-18T12:00:00.000Z', 'data.card.id': 'c3' },
      { id: 'a2', type: 'updateCard', date: '2026-09-19T12:00:00.000Z', 'data.card.id': 'c3', 'data.listBefore.id': 'backlog', 'data.listAfter.id': 'doing' },
      { id: 'a3', type: 'updateCard', date: '2026-09-20T12:00:00.000Z', 'data.card.id': 'c3', 'data.listBefore.id': 'doing', 'data.listAfter.id': 'done' },
      { id: 'a4', type: 'updateCard', date: '2026-09-21T00:00:00.000Z', 'data.card.id': 'c3', 'data.listBefore.id': 'done', 'data.listAfter.id': 'doing' },
    ];
    const metrics = computeTrelloKanbanMetrics(cards, actions, {
      inProgressListIds: ['doing'],
      doneListIds: ['done'],
      blockedListIds: ['blocked'],
    }, now);

    expect(metrics).toMatchObject({ wip: 2, throughput: 1, overdue: 1, blocked: 1, backflow: 1 });
    expect(metrics.averageLeadTimeHours).toBe(48);
    expect(metrics.averageCycleTimeHours).toBe(24);
    expect(metrics.averageAgeDays).toBe(1.25);
  });
});
