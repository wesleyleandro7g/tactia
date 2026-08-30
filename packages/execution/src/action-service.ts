import type {
  ActionExecutionRepository,
  ActionExecutionStatus,
  ActionRepository,
  ActionType,
} from '@tactia/database';
import { AuditAction, assertOwnerOrAdmin, assertTenantContext, type AuditLogService } from '@tactia/domain';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import type { ActionRegistry } from './action-registry';
import {
  createActionSchema,
  listActionsQuerySchema,
  listExecutionsQuerySchema,
  updateActionSchema,
} from './schemas';

/**
 * ActionService owns the tenant's action catalog (`Action`) and read access to
 * executions. Proposing/approving/running lives in the ExecutionEngine.
 */
export class ActionService {
  constructor(
    private readonly actions: ActionRepository,
    private readonly executions: ActionExecutionRepository,
    private readonly registry: ActionRegistry,
    private readonly auditLogs: AuditLogService,
  ) {}

  /** Action types this build can actually execute. */
  listDefinitions() {
    return this.registry.list().map((definition) => ({
      type: definition.type,
      name: definition.name,
      description: definition.description,
      defaultRequiresApproval: definition.defaultRequiresApproval,
    }));
  }

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listActionsQuerySchema.parse(query);
    const result = await this.actions.list({
      tenantId: ctx.tenantId,
      ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled === 'true' }),
      page: parsed.page,
      pageSize: parsed.pageSize,
    });
    return { ...result, available: this.listDefinitions() };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const action = await this.actions.findById({ tenantId: ctx.tenantId, id });
    if (!action) throw new AppError(ErrorCode.NOT_FOUND, 'Action not found');
    return action;
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const input = createActionSchema.parse(raw);

    // Only types with a registered executor can be catalogued.
    const definition = this.registry.get(input.type as ActionType);

    const existing = await this.actions.findByType({
      tenantId: ctx.tenantId,
      type: input.type as ActionType,
    });
    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, `Já existe uma ação '${input.type}' neste tenant`);
    }

    const action = await this.actions.create({
      tenantId: ctx.tenantId,
      type: input.type as ActionType,
      name: input.name ?? definition.name,
      description: input.description ?? definition.description,
      configuration: input.configuration ?? {},
      requiresApproval: input.requiresApproval ?? definition.defaultRequiresApproval,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    });

    await this.auditLogs.record(ctx, {
      action: AuditAction.ACTION_CREATED,
      entityType: 'action',
      entityId: action.id,
      metadata: { type: action.type, requiresApproval: action.requiresApproval },
    });

    return action;
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const input = updateActionSchema.parse(raw);
    await this.get(ctx, id);

    const action = await this.actions.update({ tenantId: ctx.tenantId, id }, input);

    await this.auditLogs.record(ctx, {
      action: AuditAction.ACTION_UPDATED,
      entityType: 'action',
      entityId: id,
      metadata: { ...input },
    });

    return action;
  }

  /** Creates the missing built-in definitions for the tenant. */
  async seedDefaults(ctx: RequestContext) {
    assertOwnerOrAdmin(ctx);

    const created: string[] = [];
    for (const definition of this.registry.list()) {
      const existing = await this.actions.findByType({
        tenantId: ctx.tenantId,
        type: definition.type,
      });
      if (existing) continue;

      const action = await this.actions.create({
        tenantId: ctx.tenantId,
        type: definition.type,
        name: definition.name,
        description: definition.description,
        configuration: {},
        requiresApproval: definition.defaultRequiresApproval,
      });
      created.push(definition.type);

      await this.auditLogs.record(ctx, {
        action: AuditAction.ACTION_CREATED,
        entityType: 'action',
        entityId: action.id,
        metadata: { type: definition.type, provisioned: 'default' },
      });
    }

    return { created, total: this.registry.types().length };
  }

  async listExecutions(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listExecutionsQuerySchema.parse(query);
    return this.executions.list({
      tenantId: ctx.tenantId,
      ...(parsed.status ? { status: parsed.status as ActionExecutionStatus } : {}),
      ...(parsed.actionId ? { actionId: parsed.actionId } : {}),
      page: parsed.page,
      pageSize: parsed.pageSize,
    });
  }

  async getExecution(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const execution = await this.executions.findById({ tenantId: ctx.tenantId, id });
    if (!execution) throw new AppError(ErrorCode.NOT_FOUND, 'ActionExecution not found');
    return execution;
  }
}
