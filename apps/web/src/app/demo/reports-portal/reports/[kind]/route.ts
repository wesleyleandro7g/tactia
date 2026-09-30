import { demoPortalAuthorized, reportCsv } from '@/lib/demo-reports-portal';

export async function GET(request: Request, segment: { params: Promise<{ kind: string }> }) {
  if (!(await demoPortalAuthorized())) {
    return new Response('Autenticação necessária.', { status: 401 });
  }
  const { kind } = await segment.params;
  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const file = reportCsv(kind, from, to);
  if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return new Response('Relatório inválido.', { status: 400 });
  }
  return new Response(file.body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.name}"`,
    },
  });
}
