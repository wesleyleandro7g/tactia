import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient } from '../client';

type EventDb = PrismaClient | Prisma.TransactionClient;

export type CommandCenterEventName =
  | 'plan_created'
  | 'decision_resolved'
  | 'execution_state_changed'
  | 'clarification_requested'
  | 'clarification_received';

/** The caller supplies only IDs, states and counts; never message or contact data. */
export async function recordCommandCenterEvent(db: EventDb, input: {
  tenantId: string;
  eventKey: string;
  name: CommandCenterEventName;
  entityId: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  await db.commandCenterEvent.createMany({
    data: {
      id: createId(),
      tenantId: input.tenantId,
      eventKey: input.eventKey,
      name: input.name,
      entityId: input.entityId,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
    skipDuplicates: true,
  });
}
