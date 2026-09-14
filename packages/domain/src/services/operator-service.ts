import type { OperatorRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertOperator } from '../authz';
import type { AuthProvider } from '../ports/auth-provider';
import { operatorCreateSchema } from '../schemas/identity';

export class OperatorService {
  constructor(
    private readonly operators: OperatorRepository,
    private readonly authProvider: AuthProvider,
  ) {}

  async ensureFromExternalAuth(input: {
    externalAuthId: string;
    name: string;
    email: string;
  }) {
    const existing = await this.operators.findByExternalAuthId(input.externalAuthId);
    if (existing) return existing;
    const byEmail = await this.operators.findByEmail(input.email);
    if (byEmail) {
      throw new AppError(ErrorCode.CONFLICT, 'An operator with this email already exists');
    }
    return this.operators.create(input);
  }

  async getMe(ctx: RequestContext) {
    assertOperator(ctx);
    const operator = await this.operators.findById(ctx.operatorId);
    if (!operator || operator.status !== 'active') {
      throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Authentication required');
    }
    return operator;
  }

  async list(ctx: RequestContext) {
    assertOperator(ctx);
    return this.operators.list();
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertOperator(ctx);
    const input = operatorCreateSchema.parse(raw);
    const existing = await this.operators.findByEmail(input.email);
    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, 'An operator with this email already exists');
    }

    const authUser = await this.authProvider.createCredentialsUser({
      email: input.email,
      name: input.name,
      password: input.password,
    });

    return this.ensureFromExternalAuth({
      externalAuthId: authUser.externalAuthId,
      name: input.name,
      email: input.email,
    });
  }

  /**
   * Bootstrap path (seed): no operator session yet. Idempotent on email.
   */
  async bootstrap(input: { name: string; email: string; password: string }) {
    const parsed = operatorCreateSchema.parse(input);
    const existing = await this.operators.findByEmail(parsed.email);
    if (existing) return existing;

    const authUser = await this.authProvider.createCredentialsUser({
      email: parsed.email,
      name: parsed.name,
      password: parsed.password,
    });

    return this.ensureFromExternalAuth({
      externalAuthId: authUser.externalAuthId,
      name: parsed.name,
      email: parsed.email,
    });
  }

  async disable(ctx: RequestContext, id: string) {
    assertOperator(ctx);
    const target = await this.operators.findById(id);
    if (!target) throw new AppError(ErrorCode.NOT_FOUND, 'Operator not found');
    if (target.id === ctx.operatorId) {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Cannot disable your own operator account');
    }
    if (target.status === 'disabled') return target;

    const activeCount = await this.operators.countByStatus('active');
    if (activeCount <= 1) {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Cannot disable the last active operator');
    }

    return this.operators.updateStatus(id, 'disabled');
  }
}
