import type { PrismaClient } from '@tactia/database';
import type { RequestContext } from '@tactia/shared';
import { logger } from '@tactia/shared';
import { SnapshotEngine, type SnapshotRunOptions } from '@tactia/intelligence';
import { assertTenantContext } from '../authz';

/**
 * Tenant-scoped facade for `SnapshotEngine` (Etapa 11). The pipeline and the
 * daily job call `runForTenant`; the API/UI use the ctx-scoped methods.
 */
export class SnapshotService {
  readonly engine: SnapshotEngine;

  constructor(db: PrismaClient, engine?: SnapshotEngine) {
    this.engine = engine ?? new SnapshotEngine(db);
  }

  /** Incremental materialization (backfill on first run, recompute last 3 days). */
  async runForTenant(tenantId: string, options: SnapshotRunOptions = {}) {
    const startedAt = Date.now();
    const result = await this.engine.run(tenantId, options);
    logger.info({
      tenant_id: tenantId,
      operation: 'metric_snapshots_materialized',
      days: result.days,
      rows: result.rows,
      backfilled: result.backfilled,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  }

  async run(ctx: RequestContext, options: SnapshotRunOptions = {}) {
    assertTenantContext(ctx);
    return this.runForTenant(ctx.tenantId, options);
  }

  /** Force recomputation of an explicit window (e.g. after a historical re-import). */
  async materialize(ctx: RequestContext, from: Date, to: Date) {
    assertTenantContext(ctx);
    return this.engine.materialize(ctx.tenantId, from, to);
  }

  async coverage(ctx: RequestContext) {
    assertTenantContext(ctx);
    return this.engine.coverage(ctx.tenantId);
  }
}
