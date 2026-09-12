import type { DetectedEvent } from '../types';
import type { Rule } from './types';

/** A data source has not synced within `staleDataHours` — insights may be outdated. */
export const staleDataRule: Rule = {
  key: 'stale_data',
  async evaluate(ctx) {
    const sources = await ctx.db.dataSource.findMany({
      where: { tenantId: ctx.tenantId, status: { not: 'inactive' } },
      select: { id: true, name: true, type: true, lastSyncAt: true, status: true },
    });
    if (sources.length === 0) return [];

    const staleMs = ctx.thresholds.staleDataHours * 60 * 60 * 1000;
    const now = Date.now();
    const events: DetectedEvent[] = [];
    for (const source of sources) {
      // CSV uploads are one-off by nature: only flag connected sources or errors.
      const connected = source.type === 'postgres' || source.type === 'rest' || source.type === 'google_sheets';
      const ageHours =
        source.lastSyncAt == null ? null : (now - source.lastSyncAt.getTime()) / (60 * 60 * 1000);
      const isStale = ageHours == null || ageHours * 60 * 60 * 1000 > staleMs;
      if (source.status !== 'error' && (!connected || !isStale)) continue;

      events.push({
        ruleKey: 'stale_data',
        type: 'warning',
        severity: source.status === 'error' ? 'medium' : 'low',
        title:
          source.status === 'error'
            ? `Fonte "${source.name}" com erro de sincronização`
            : `Fonte "${source.name}" sem sincronizar há ${ageHours == null ? 'muito tempo' : `${Math.round(ageHours)}h`}`,
        description:
          source.status === 'error'
            ? `A fonte ${source.name} (${source.type}) está em erro. Métricas e insights podem estar defasados até a próxima sincronização bem-sucedida.`
            : `A fonte ${source.name} (${source.type}) não sincroniza há ${ageHours == null ? 'um tempo indeterminado' : `${Math.round(ageHours)} horas`} (limite ${ctx.thresholds.staleDataHours}h). Os números abaixo podem não refletir a operação atual.`,
        evidence: [
          {
            key: 'data_age_hours',
            value: ageHours == null ? -1 : Math.round(ageHours),
            period: { from: ctx.period.from.toISOString(), to: ctx.period.to.toISOString() },
          },
        ],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        entityType: 'data_source',
        entityId: source.id,
        entityLabel: source.name,
        confidence: 1,
      });
    }
    return events;
  },
};
