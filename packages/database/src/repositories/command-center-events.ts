import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient } from '../client';

type EventDb = PrismaClient | Prisma.TransactionClient;

export const COMMAND_CENTER_EVENT_NAMES = [
  'plan_created',
  'decision_resolved',
  'execution_state_changed',
  'clarification_requested',
  'clarification_received',
] as const;

export type CommandCenterEventName = (typeof COMMAND_CENTER_EVENT_NAMES)[number];

export const COMMAND_CENTER_EVENT_METADATA_KEYS = [
  'version',
  'kind',
  'choice',
  'planVersion',
  'status',
  'planId',
  'gapId',
  'clear',
] as const;

export type CommandCenterEventMetadata = Record<string, string | number | boolean | null>;

export type CommandCenterEventWindow = {
  tenantId: string;
  from: Date;
  to: Date;
};

export type CommandCenterEventListQuery = CommandCenterEventWindow & {
  name?: CommandCenterEventName;
  page: number;
  pageSize: number;
};

export type CommandCenterEventRecord = {
  id: string;
  name: CommandCenterEventName;
  entityId: string;
  metadata: CommandCenterEventMetadata;
  occurredAt: Date;
};

export type CommandCenterEventAggregate = {
  counts: Record<CommandCenterEventName, number>;
  decisions: { kind: Record<string, number>; choice: Record<string, number> };
  executions: { status: Record<string, number> };
  clarifications: { clear: number; unclear: number };
  daily: Array<{ day: string; name: CommandCenterEventName; count: number }>;
};

export function isCommandCenterEventName(value: string): value is CommandCenterEventName {
  return (COMMAND_CENTER_EVENT_NAMES as readonly string[]).includes(value);
}

function emptyCounts(): Record<CommandCenterEventName, number> {
  return {
    plan_created: 0,
    decision_resolved: 0,
    execution_state_changed: 0,
    clarification_requested: 0,
    clarification_received: 0,
  };
}

/** Drops anything that is not an ID, state, version or boolean already allowed at write time. */
export function sanitizeCommandCenterEventMetadata(value: Prisma.JsonValue): CommandCenterEventMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const metadata: CommandCenterEventMetadata = {};
  for (const key of COMMAND_CENTER_EVENT_METADATA_KEYS) {
    if (!(key in source)) continue;
    const item = source[key];
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      metadata[key] = item;
    }
  }
  return metadata;
}

function windowWhere(input: CommandCenterEventWindow): Prisma.CommandCenterEventWhereInput {
  return {
    tenantId: input.tenantId,
    occurredAt: { gte: input.from, lt: input.to },
  };
}

function toCountMap(rows: Array<{ value: string | null; count: number | bigint }>): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    if (!row.value) continue;
    map[row.value] = Number(row.count);
  }
  return map;
}

async function groupMetadata(
  db: EventDb,
  input: CommandCenterEventWindow,
  name: CommandCenterEventName,
  field: 'kind' | 'choice' | 'status',
) {
  const column =
    field === 'kind'
      ? Prisma.sql`metadata->>'kind'`
      : field === 'choice'
        ? Prisma.sql`metadata->>'choice'`
        : Prisma.sql`metadata->>'status'`;
  return db.$queryRaw<Array<{ value: string | null; count: number }>>(Prisma.sql`
    SELECT ${column} AS value, COUNT(*)::int AS count
    FROM command_center_events
    WHERE tenant_id = ${input.tenantId}::uuid
      AND occurred_at >= ${input.from}
      AND occurred_at < ${input.to}
      AND name = ${name}
    GROUP BY 1
  `);
}

/** The caller supplies only IDs, states and counts; never message or contact data. */
export async function recordCommandCenterEvent(db: EventDb, input: {
  tenantId: string;
  eventKey: string;
  name: CommandCenterEventName;
  entityId: string;
  metadata?: CommandCenterEventMetadata;
}) {
  await db.commandCenterEvent.createMany({
    data: {
      id: createId(),
      tenantId: input.tenantId,
      eventKey: input.eventKey,
      name: input.name,
      entityId: input.entityId,
      metadata: sanitizeCommandCenterEventMetadata((input.metadata ?? {}) as Prisma.JsonValue) as Prisma.InputJsonValue,
    },
    skipDuplicates: true,
  });
}

export async function aggregateCommandCenterEvents(
  db: EventDb,
  input: CommandCenterEventWindow,
): Promise<CommandCenterEventAggregate> {
  const where = windowWhere(input);
  const [grouped, decisionKinds, decisionChoices, executionStatuses, clearReceived, dailyRows] = await Promise.all([
    db.commandCenterEvent.groupBy({
      by: ['name'],
      where: { ...where, name: { in: [...COMMAND_CENTER_EVENT_NAMES] } },
      _count: { _all: true },
    }),
    groupMetadata(db, input, 'decision_resolved', 'kind'),
    groupMetadata(db, input, 'decision_resolved', 'choice'),
    groupMetadata(db, input, 'execution_state_changed', 'status'),
    db.commandCenterEvent.count({
      where: { ...where, name: 'clarification_received', metadata: { path: ['clear'], equals: true } },
    }),
    db.$queryRaw<Array<{ day: string; name: string; count: number }>>(Prisma.sql`
      SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             name,
             COUNT(*)::int AS count
      FROM command_center_events
      WHERE tenant_id = ${input.tenantId}::uuid
        AND occurred_at >= ${input.from}
        AND occurred_at < ${input.to}
        AND name IN (${Prisma.join([...COMMAND_CENTER_EVENT_NAMES])})
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    `),
  ]);

  const counts = emptyCounts();
  for (const row of grouped) {
    if (isCommandCenterEventName(row.name)) counts[row.name] = row._count._all;
  }

  return {
    counts,
    decisions: { kind: toCountMap(decisionKinds), choice: toCountMap(decisionChoices) },
    executions: { status: toCountMap(executionStatuses) },
    clarifications: {
      clear: clearReceived,
      unclear: Math.max(0, counts.clarification_received - clearReceived),
    },
    daily: dailyRows.flatMap((row) =>
      isCommandCenterEventName(row.name)
        ? [{ day: row.day, name: row.name, count: Number(row.count) }]
        : [],
    ),
  };
}

export async function listCommandCenterEvents(db: EventDb, input: CommandCenterEventListQuery) {
  const where: Prisma.CommandCenterEventWhereInput = {
    ...windowWhere(input),
    name: input.name ?? { in: [...COMMAND_CENTER_EVENT_NAMES] },
  };
  const [total, rows] = await Promise.all([
    db.commandCenterEvent.count({ where }),
    db.commandCenterEvent.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: { id: true, name: true, entityId: true, metadata: true, occurredAt: true },
    }),
  ]);

  return {
    total,
    page: input.page,
    pageSize: input.pageSize,
    items: rows.flatMap((row) =>
      isCommandCenterEventName(row.name)
        ? [{
            id: row.id,
            name: row.name,
            entityId: row.entityId,
            metadata: sanitizeCommandCenterEventMetadata(row.metadata),
            occurredAt: row.occurredAt,
          } satisfies CommandCenterEventRecord]
        : [],
    ),
  };
}

export class CommandCenterEventRepository {
  constructor(private readonly db: PrismaClient) {}

  aggregate(input: CommandCenterEventWindow) {
    return aggregateCommandCenterEvents(this.db, input);
  }

  list(input: CommandCenterEventListQuery) {
    return listCommandCenterEvents(this.db, input);
  }
}
