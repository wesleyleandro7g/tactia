import { ZodError, z } from 'zod';
import {
  COMMAND_CENTER_EVENT_NAMES,
  type CommandCenterEventAggregate,
  type CommandCenterEventName,
  type CommandCenterEventRepository,
} from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertOperatorForTenant } from '../authz';

export const COMMAND_CENTER_METRICS_MAX_DAYS = 90;
export const COMMAND_CENTER_METRICS_DEFAULT_DAYS = 30;

const MS_PER_DAY = 86_400_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const eventNameSchema = z.enum(COMMAND_CENTER_EVENT_NAMES);

const querySchema = z.object({
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  name: z.preprocess((value) => (value === '' ? undefined : value), eventNameSchema.optional()),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type OperationalMetricAvailability = 'ready' | 'empty';

export type OperationalMetric = {
  key: string;
  definition: string;
  value: number | null;
  unit: 'count' | 'ratio';
  period: { from: string; to: string };
  availability: OperationalMetricAvailability;
  denominator: { value: number; definition: string } | null;
  limitation: string;
};

export type UnsupportedPilotMetric = {
  key: string;
  reason: string;
};

export const UNSUPPORTED_PILOT_METRICS: readonly UnsupportedPilotMetric[] = [
  {
    key: 'time_to_first_value',
    reason: 'Os eventos não registram o primeiro acesso, a primeira decisão útil nem o instante em que a empresa passou a acompanhar o ciclo.',
  },
  {
    key: 'effort_reduction',
    reason: 'Não há evento de trabalho manual do cliente; ausência de cadastro ou check-in não pode ser convertida em economia medida.',
  },
  {
    key: 'commercial_outcome',
    reason: 'Receita, retenção e impacto causal vivem na medição do plano, não nestes eventos operacionais.',
  },
];

function validation(message: string, details?: unknown): never {
  throw new AppError(ErrorCode.VALIDATION_ERROR, message, details);
}

function parseBoundary(value: string, role: 'from' | 'to'): Date {
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    const start = Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return new Date(role === 'to' ? start + MS_PER_DAY : start);
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    validation('from e to precisam ser datas ISO válidas.');
  }
  return instant;
}

function utcDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function defaultWindow(now: Date) {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const to = new Date(startOfToday + MS_PER_DAY);
  const from = new Date(to.getTime() - COMMAND_CENTER_METRICS_DEFAULT_DAYS * MS_PER_DAY);
  return { from, to };
}

export function resolveCommandCenterMetricsWindow(
  raw: { from?: string; to?: string },
  now = new Date(),
) {
  if (!raw.from && !raw.to) return defaultWindow(now);
  if (!raw.from || !raw.to) {
    validation('Informe from e to juntos, como datas ISO.');
  }
  const from = parseBoundary(raw.from, 'from');
  const to = parseBoundary(raw.to, 'to');
  const durationMs = to.getTime() - from.getTime();
  if (durationMs <= 0) {
    validation('Informe um intervalo com início anterior ao fim.');
  }
  if (durationMs > COMMAND_CENTER_METRICS_MAX_DAYS * MS_PER_DAY) {
    validation(`O intervalo não pode passar de ${COMMAND_CENTER_METRICS_MAX_DAYS} dias.`);
  }
  return { from, to };
}

function parseQuery(raw: Record<string, string | undefined>, now?: Date) {
  let parsed: z.infer<typeof querySchema>;
  try {
    parsed = querySchema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      validation('Parâmetros inválidos para a consulta de indicadores.', error.flatten());
    }
    throw error;
  }
  const window = resolveCommandCenterMetricsWindow(parsed, now);
  return {
    ...window,
    name: parsed.name,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}

const EMPTY_COUNT_LIMITATION =
  'Nenhum evento deste tipo no período. Ausência não é zero de desempenho nem sucesso comercial.';

function countMetric(
  key: string,
  definition: string,
  count: number,
  period: OperationalMetric['period'],
): OperationalMetric {
  const empty = count === 0;
  return {
    key,
    definition,
    value: empty ? null : count,
    unit: 'count',
    period,
    availability: empty ? 'empty' : 'ready',
    denominator: null,
    limitation: empty
      ? EMPTY_COUNT_LIMITATION
      : 'Contagem de eventos gravados; não mede resultado comercial nem esforço do cliente.',
  };
}

function rateMetric(input: {
  key: string;
  definition: string;
  numerator: number;
  denominator: number;
  denominatorDefinition: string;
  period: OperationalMetric['period'];
  limitation: string;
}): OperationalMetric {
  const empty = input.denominator === 0;
  return {
    key: input.key,
    definition: input.definition,
    value: empty ? null : input.numerator / input.denominator,
    unit: 'ratio',
    period: input.period,
    availability: empty ? 'empty' : 'ready',
    denominator: { value: input.denominator, definition: input.denominatorDefinition },
    limitation: empty
      ? 'Sem denominador no período; a taxa não é calculada e não representa 0% de desempenho.'
      : input.limitation,
  };
}

function serializeEvent(item: {
  id: string;
  name: CommandCenterEventName;
  entityId: string;
  metadata: Record<string, string | number | boolean | null>;
  occurredAt: Date;
}) {
  return {
    id: item.id,
    name: item.name,
    entityId: item.entityId,
    metadata: item.metadata,
    occurredAt: item.occurredAt.toISOString(),
  };
}

function buildMetrics(aggregate: CommandCenterEventAggregate, period: OperationalMetric['period']) {
  const { counts } = aggregate;
  return [
    countMetric(
      'plans_created',
      'Planos gravados no período. Cada plano conta uma vez; reprocessamento com a mesma chave não entra de novo.',
      counts.plan_created,
      period,
    ),
    countMetric(
      'decisions_resolved',
      'Decisões de revisão ou aprovação resolvidas no período, sem o conteúdo da decisão.',
      counts.decision_resolved,
      period,
    ),
    countMetric(
      'execution_transitions',
      'Transições de estado de execução vinculadas a um plano. Não é conclusão do objetivo.',
      counts.execution_state_changed,
      period,
    ),
    countMetric(
      'clarifications_requested',
      'Esclarecimentos solicitados no período. Conta o pedido, não a pergunta nem o contato.',
      counts.clarification_requested,
      period,
    ),
    countMetric(
      'clarifications_received',
      'Respostas de esclarecimento gravadas no período. Silêncio não aparece aqui.',
      counts.clarification_received,
      period,
    ),
    rateMetric({
      key: 'clarification_response_rate',
      definition:
        'Respostas gravadas divididas pelos esclarecimentos solicitados no mesmo período.',
      numerator: counts.clarification_received,
      denominator: counts.clarification_requested,
      denominatorDefinition: 'Esclarecimentos solicitados no período.',
      period,
      limitation:
        'Pedido e resposta podem cair em janelas diferentes. Silêncio não entra no numerador e não confirma a lacuna.',
    }),
    rateMetric({
      key: 'clarification_clear_rate',
      definition:
        'Respostas classificadas como claras, divididas pelas respostas recebidas no período.',
      numerator: aggregate.clarifications.clear,
      denominator: counts.clarification_received,
      denominatorDefinition: 'Esclarecimentos recebidos no período.',
      period,
      limitation:
        'A clareza é heurística determinística. Resposta ambígua permanece no denominador e não resolve a lacuna.',
    }),
  ];
}

export class CommandCenterMetricsService {
  constructor(private readonly events: CommandCenterEventRepository) {}

  async summarize(ctx: RequestContext, raw: Record<string, string | undefined> = {}, now = new Date()) {
    assertOperatorForTenant(ctx);
    const query = parseQuery(raw, now);
    const window = { tenantId: ctx.tenantId, from: query.from, to: query.to };
    const [aggregate, events] = await Promise.all([
      this.events.aggregate(window),
      this.events.list({ ...window, name: query.name, page: query.page, pageSize: query.pageSize }),
    ]);
    const period = { from: query.from.toISOString(), to: query.to.toISOString() };
    return {
      tenantId: ctx.tenantId,
      period,
      periodInclusive: {
        from: utcDateString(query.from),
        to: utcDateString(new Date(query.to.getTime() - 1)),
      },
      filter: { name: query.name ?? null },
      metrics: buildMetrics(aggregate, period),
      breakdowns: {
        decisions: aggregate.decisions,
        executions: aggregate.executions,
        clarifications: aggregate.clarifications,
      },
      daily: aggregate.daily,
      events: {
        total: events.total,
        page: events.page,
        pageSize: events.pageSize,
        items: events.items.map(serializeEvent),
      },
      unsupported: UNSUPPORTED_PILOT_METRICS,
    };
  }
}
