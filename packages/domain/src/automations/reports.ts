import { createHash } from 'node:crypto';
import { REPORT_KEYS, type ReportKey } from './model';

const HEADER = 'report,period_start,period_end,metric,value';

const METRIC: Record<ReportKey, { metric: string; value: string }> = {
  sales: { metric: 'revenue', value: '12840.50' },
  inventory: { metric: 'units_on_hand', value: '240' },
  financial: { metric: 'cash_balance', value: '56000.00' },
};

export function isReportKey(value: string): value is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(value);
}

/** CSV fictício do portal de demonstração. O período pedido entra em cada linha. */
export function renderReportCsv(kind: ReportKey, periodStart: string, periodEnd: string): string {
  const row = METRIC[kind];
  return `${HEADER}\n${kind},${periodStart},${periodEnd},${row.metric},${row.value}\n`;
}

export type ReportFile = {
  name: string;
  mime: string;
  body: Buffer | string;
};

const CSV_MIME = new Set(['text/csv', 'application/csv', 'text/plain']);

function textOf(file: ReportFile): string {
  return typeof file.body === 'string' ? file.body : file.body.toString('utf8');
}

/**
 * Confere presença, formato e período de todos os relatórios pedidos.
 * Arquivos a mais são ignorados; ausência ou período divergente reprova o lote.
 */
export function validateReportBundle(
  files: ReportFile[],
  params: { reports: string[]; periodStart: string; periodEnd: string },
): { ok: true } | { ok: false; reason: string } {
  const requested = params.reports.filter(isReportKey);
  if (requested.length !== params.reports.length) {
    return { ok: false, reason: 'Há um relatório solicitado que esta automação não conhece.' };
  }
  for (const kind of requested) {
    const file = files.find((candidate) => candidate.name.toLowerCase().includes(kind));
    if (!file) return { ok: false, reason: `Relatório ausente: ${kind}.` };
    if (!CSV_MIME.has(file.mime.split(';')[0]?.trim() ?? '')) {
      return { ok: false, reason: `Formato inválido em ${kind}.` };
    }
    const lines = textOf(file).trim().split(/\r?\n/).filter((line) => line.length > 0);
    const header = lines[0]?.split(',').map((cell) => cell.trim());
    if (!header || header[0] !== 'report' || !header.includes('period_start') || !header.includes('period_end')) {
      return { ok: false, reason: `Cabeçalho CSV inválido em ${kind}.` };
    }
    const startIdx = header.indexOf('period_start');
    const endIdx = header.indexOf('period_end');
    const reportIdx = header.indexOf('report');
    const matched = lines.slice(1).some((line) => {
      const cells = line.split(',');
      return (
        cells[reportIdx]?.trim() === kind &&
        cells[startIdx]?.trim() === params.periodStart &&
        cells[endIdx]?.trim() === params.periodEnd
      );
    });
    if (!matched) return { ok: false, reason: `O período de ${kind} não confere com o pedido.` };
  }
  return { ok: true };
}

export function checksumBuffer(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}
