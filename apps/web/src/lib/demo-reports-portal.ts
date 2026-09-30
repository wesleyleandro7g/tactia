import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { isReportKey, renderReportCsv, type ReportKey } from '@tactia/domain';

const COOKIE = 'tactia_demo_reports';

export function demoPortalPassword(): string | null {
  const configured = process.env['DEMO_REPORTS_PORTAL_PASSWORD']?.trim();
  if (configured) return configured;
  if (process.env['NODE_ENV'] === 'production') return null;
  return 'demo-reports';
}

function token(password: string): string {
  return createHmac('sha256', password).update('tactia-demo-reports-portal').digest('hex');
}

export function demoPortalSessionValue(password: string): string {
  return token(password);
}

export async function demoPortalAuthorized(): Promise<boolean> {
  const password = demoPortalPassword();
  if (!password) return false;
  const current = (await cookies()).get(COOKIE)?.value;
  if (!current) return false;
  const expected = token(password);
  const a = Buffer.from(current);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function reportCsv(kind: string, periodStart: string, periodEnd: string): { body: string; name: string } | null {
  if (!isReportKey(kind)) return null;
  return { name: `${kind}.csv`, body: renderReportCsv(kind as ReportKey, periodStart, periodEnd) };
}

export const DEMO_REPORTS_COOKIE = COOKIE;
