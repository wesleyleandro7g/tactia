import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type InsightStatusValue = 'open' | 'acknowledged' | 'resolved' | 'dismissed';

export type CreateInsightInput = {
  tenantId: string;
  type: 'anomaly' | 'performance' | 'opportunity' | 'warning';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  ruleKey: string;
  evidence: unknown;
  periodFrom: Date;
  periodTo: Date;
  /** Stable identity (ruleKey + entity). Defaults to ruleKey. */
  fingerprint?: string;
  entityType?: string | null;
  entityId?: string | null;
  impactAmount?: number | null;
  confidence?: number | null;
  score?: number;
  drivers?: unknown;
};

export type UpdateInsightInput = {
  status?: InsightStatusValue;
  resolvedAt?: Date | null;
  dismissReason?: string | null;
  autoResolvedAt?: Date | null;
};

/** Fields refreshed when an already-open insight fires again with new numbers. */
export type RefreshInsightInput = {
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  evidence: unknown;
  impactAmount?: number | null;
  confidence?: number | null;
  score?: number;
  drivers?: unknown;
  periodFrom: Date;
  periodTo: Date;
};

export class InsightRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateInsightInput) {
    return this.db.insight.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        type: input.type,
        severity: input.severity,
        title: input.title,
        description: input.description,
        ruleKey: input.ruleKey,
        evidence: input.evidence as never,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        fingerprint: input.fingerprint ?? input.ruleKey,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        impactAmount: input.impactAmount ?? null,
        confidence: input.confidence ?? null,
        score: input.score ?? 0,
        drivers: (input.drivers ?? undefined) as never,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.insight.findFirst({
      where: { id, tenantId },
      include: { recommendations: true },
    });
  }

  /** Find an open/acknowledged insight for the same rule+period (legacy deduplication). */
  async findOpenByRuleAndPeriod({
    tenantId,
    ruleKey,
    periodFrom,
    periodTo,
  }: {
    tenantId: string;
    ruleKey: string;
    periodFrom: Date;
    periodTo: Date;
  }) {
    return this.db.insight.findFirst({
      where: {
        tenantId,
        ruleKey,
        periodFrom,
        periodTo,
        status: { in: ['open', 'acknowledged'] },
      },
    });
  }

  /** Open/acknowledged insight with the same identity (rule + entity), regardless of period. */
  async findOpenByFingerprint({ tenantId, fingerprint }: { tenantId: string; fingerprint: string }) {
    return this.db.insight.findFirst({
      where: { tenantId, fingerprint, status: { in: ['open', 'acknowledged'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** How many times the user dismissed this finding (used to suppress noise). */
  async countDismissedByFingerprint({
    tenantId,
    fingerprint,
    reason,
  }: {
    tenantId: string;
    fingerprint: string;
    reason?: string;
  }) {
    return this.db.insight.count({
      where: {
        tenantId,
        fingerprint,
        status: 'dismissed',
        ...(reason ? { dismissReason: reason } : {}),
      },
    });
  }

  /** Dismiss counts grouped by rule — feeds threshold calibration. */
  async dismissedCountsByRule({ tenantId, reason }: { tenantId: string; reason?: string }) {
    const rows = await this.db.insight.groupBy({
      by: ['ruleKey'],
      where: { tenantId, status: 'dismissed', ...(reason ? { dismissReason: reason } : {}) },
      _count: { id: true },
    });
    return rows.map((row) => ({ ruleKey: row.ruleKey, count: row._count.id }));
  }

  /** Refresh numbers/text of an insight that is still open and fired again. */
  async refresh({ id, tenantId }: { id: string; tenantId: string }, input: RefreshInsightInput) {
    return this.db.insight.update({
      where: { id, tenantId },
      data: {
        severity: input.severity,
        title: input.title,
        description: input.description,
        evidence: input.evidence as never,
        impactAmount: input.impactAmount ?? null,
        confidence: input.confidence ?? null,
        score: input.score ?? 0,
        drivers: (input.drivers ?? undefined) as never,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
      },
    });
  }

  /**
   * Auto-resolve open insights of the given rules whose fingerprint did NOT
   * fire in the current run: the condition disappeared.
   */
  async autoResolveNotIn({
    tenantId,
    ruleKeys,
    activeFingerprints,
  }: {
    tenantId: string;
    ruleKeys: string[];
    activeFingerprints: string[];
  }) {
    if (ruleKeys.length === 0) return 0;
    const now = new Date();
    const result = await this.db.insight.updateMany({
      where: {
        tenantId,
        ruleKey: { in: ruleKeys },
        status: { in: ['open', 'acknowledged'] },
        ...(activeFingerprints.length > 0 ? { fingerprint: { notIn: activeFingerprints } } : {}),
      },
      data: { status: 'resolved', resolvedAt: now, autoResolvedAt: now },
    });
    return result.count;
  }

  async update({ id, tenantId }: { id: string; tenantId: string }, input: UpdateInsightInput) {
    return this.db.insight.update({
      where: { id, tenantId },
      data: input,
    });
  }

  async list({
    tenantId,
    status,
    ruleKey,
    entityType,
    entityId,
    page = 1,
    pageSize = 20,
    orderBy = 'score',
  }: {
    tenantId: string;
    status?: InsightStatusValue;
    ruleKey?: string;
    entityType?: string;
    entityId?: string;
    page?: number;
    pageSize?: number;
    orderBy?: 'score' | 'severity' | 'createdAt';
  }) {
    const where = {
      tenantId,
      ...(status ? { status } : {}),
      ...(ruleKey ? { ruleKey } : {}),
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
    };
    const order =
      orderBy === 'score'
        ? [{ score: 'desc' as const }, { severity: 'desc' as const }, { createdAt: 'desc' as const }]
        : orderBy === 'severity'
          ? [{ severity: 'desc' as const }, { createdAt: 'desc' as const }]
          : [{ createdAt: 'desc' as const }];
    const [total, items] = await Promise.all([
      this.db.insight.count({ where }),
      this.db.insight.findMany({
        where,
        include: { recommendations: true },
        orderBy: order,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, items, page, pageSize };
  }
}
