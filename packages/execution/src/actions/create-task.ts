import { z } from 'zod';
import type { ActivityRepository, CustomerRepository, LeadRepository, SellerRepository } from '@tactia/database';
import { AppError, ErrorCode } from '@tactia/shared';
import { defineAction } from '../action-registry';
import type { ActionDefinition } from '../types';

export const createTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(200).describe('Título da tarefa.'),
  description: z.string().trim().max(2000).optional().describe('Detalhes da tarefa.'),
  dueDate: z.coerce.date().optional().describe('Data de vencimento (ISO 8601).'),
  customerId: z.string().uuid().optional().describe('Cliente relacionado.'),
  leadId: z.string().uuid().optional().describe('Lead relacionado.'),
  sellerId: z.string().uuid().optional().describe('Responsável pela tarefa.'),
});

export type CreateTaskDeps = {
  activities: ActivityRepository;
  customers: CustomerRepository;
  leads: LeadRepository;
  sellers: SellerRepository;
};

/**
 * create_task — materializes a task as an `Activity` of type `task`.
 *
 * Uses repositories instead of domain services on purpose: the execution may
 * run after the originating request, so there is no session to authorize
 * against. Referenced entities are re-checked here so a stale proposal (or one
 * pointing at another tenant) fails loudly instead of writing bad data.
 */
export function createTaskAction(deps: CreateTaskDeps): ActionDefinition {
  return defineAction({
    type: 'create_task',
    name: 'Criar tarefa',
    description:
      'Cria uma tarefa (Activity do tipo task) para acompanhamento de um cliente, lead ou vendedor.',
    defaultRequiresApproval: true,
    inputSchema: createTaskInputSchema,
    async execute(ctx, input) {
      if (input.customerId) {
        const customer = await deps.customers.findById({
          tenantId: ctx.tenantId,
          id: input.customerId,
        });
        if (!customer) throw new AppError(ErrorCode.NOT_FOUND, 'Cliente informado não existe');
      }
      if (input.leadId) {
        const lead = await deps.leads.findById({ tenantId: ctx.tenantId, id: input.leadId });
        if (!lead) throw new AppError(ErrorCode.NOT_FOUND, 'Lead informado não existe');
      }
      if (input.sellerId) {
        const seller = await deps.sellers.findById({ tenantId: ctx.tenantId, id: input.sellerId });
        if (!seller) throw new AppError(ErrorCode.NOT_FOUND, 'Vendedor informado não existe');
      }

      const activity = await deps.activities.create({
        tenantId: ctx.tenantId,
        type: 'task',
        customerId: input.customerId ?? null,
        leadId: input.leadId ?? null,
        sellerId: input.sellerId ?? null,
        occurredAt: input.dueDate ?? new Date(),
        metadata: {
          title: input.title,
          ...(input.description ? { description: input.description } : {}),
          ...(input.dueDate ? { dueDate: input.dueDate.toISOString() } : {}),
          source: 'action',
          actionExecutionId: ctx.executionId,
        },
      });

      return {
        activityId: activity.id,
        title: input.title,
        occurredAt: activity.occurredAt.toISOString(),
      };
    },
  });
}
