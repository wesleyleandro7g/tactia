export type TrelloKanbanConfig = {
  inProgressListIds?: string[];
  doneListIds?: string[];
  blockedListIds?: string[];
  windowDays?: number;
};

export type TrelloKanbanMetrics = {
  wip: number;
  throughput: number;
  overdue: number;
  blocked: number;
  averageAgeDays: number;
  averageLeadTimeHours: number | null;
  averageCycleTimeHours: number | null;
  backflow: number;
};

type Row = Record<string, unknown>;

function time(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function computeTrelloKanbanMetrics(
  cards: Row[],
  actions: Row[],
  config: TrelloKanbanConfig = {},
  now = new Date(),
): TrelloKanbanMetrics {
  const inProgress = new Set(config.inProgressListIds ?? []);
  const done = new Set(config.doneListIds ?? []);
  const blocked = new Set(config.blockedListIds ?? []);
  const cutoff = now.getTime() - (config.windowDays ?? 30) * 24 * 60 * 60 * 1000;
  const open = cards.filter((card) => card['closed'] !== true && !done.has(String(card['idList'] ?? '')));
  const ages = open.map((card) => {
    const last = time(card['dateLastActivity']) ?? time(card['date']) ?? now.getTime();
    return Math.max(0, (now.getTime() - last) / 86_400_000);
  });

  const transitions = actions
    .filter((action) => action['type'] === 'updateCard' && time(action['date']) != null)
    .sort((a, b) => time(a['date'])! - time(b['date'])!);
  const createdAt = new Map<string, number>();
  const startedAt = new Map<string, number>();
  const leadTimes: number[] = [];
  const cycleTimes: number[] = [];
  let throughput = 0;
  let backflow = 0;

  for (const action of actions) {
    if (action['type'] !== 'createCard') continue;
    const cardId = String(action['data.card.id'] ?? '');
    const occurred = time(action['date']);
    if (cardId && occurred != null) createdAt.set(cardId, occurred);
  }

  for (const action of transitions) {
    const cardId = String(action['data.card.id'] ?? '');
    const from = String(action['data.listBefore.id'] ?? '');
    const to = String(action['data.listAfter.id'] ?? action['data.list.id'] ?? '');
    const occurred = time(action['date'])!;
    if (!cardId || !to) continue;
    if (inProgress.has(to) && !startedAt.has(cardId)) startedAt.set(cardId, occurred);
    if (done.has(from) && !done.has(to)) backflow += 1;
    if (inProgress.has(from) && !done.has(to) && !inProgress.has(to)) backflow += 1;
    if (done.has(to)) {
      if (occurred >= cutoff) throughput += 1;
      const created = createdAt.get(cardId);
      const started = startedAt.get(cardId);
      if (created != null && occurred >= created) leadTimes.push((occurred - created) / 3_600_000);
      if (started != null && occurred >= started) cycleTimes.push((occurred - started) / 3_600_000);
    }
  }

  return {
    wip: open.length,
    throughput,
    overdue: open.filter((card) => {
      const due = time(card['due']);
      return due != null && due < now.getTime() && card['dueComplete'] !== true;
    }).length,
    blocked: open.filter((card) => blocked.has(String(card['idList'] ?? ''))).length,
    averageAgeDays: Number((average(ages) ?? 0).toFixed(2)),
    averageLeadTimeHours: average(leadTimes),
    averageCycleTimeHours: average(cycleTimes),
    backflow,
  };
}
