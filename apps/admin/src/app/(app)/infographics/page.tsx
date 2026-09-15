import Link from 'next/link';
import {
  INFOGRAPHIC_TEMPLATE_LABELS,
  INFOGRAPHIC_TEMPLATES,
  demoInfographicSpec,
  renderInfographic,
  type InfographicTheme,
} from '@tactia/ai/infographics';
import { PageHeader } from '@/components/app/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardLabel } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { requireOperator } from '@/lib/server-context';

export const metadata = { title: 'Infográficos · Tactia Ops' };
export const runtime = 'nodejs';
/** Previews are generated on demand — avoid static caching of PNGs. */
export const dynamic = 'force-dynamic';

type PreviewItem = {
  template: (typeof INFOGRAPHIC_TEMPLATES)[number];
  label: string;
  dataUrl?: string;
  error?: string;
};

async function buildPreviews(theme: InfographicTheme): Promise<PreviewItem[]> {
  return Promise.all(
    INFOGRAPHIC_TEMPLATES.map(async (template) => {
      const label = INFOGRAPHIC_TEMPLATE_LABELS[template];
      try {
        const rendered = await renderInfographic(demoInfographicSpec(template, theme));
        return {
          template,
          label,
          dataUrl: `data:${rendered.mime};base64,${rendered.png.toString('base64')}`,
        };
      } catch (error) {
        return {
          template,
          label,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

export default async function InfographicsPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string }>;
}) {
  await requireOperator('/infographics');
  const params = await searchParams;
  const theme: InfographicTheme = params.theme === 'dark' ? 'dark' : 'light';
  const previews = await buildPreviews(theme);
  const failed = previews.filter((item) => item.error);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Infográficos"
        description="Prévia dos templates que o agente pode anexar no chat e no WhatsApp. Dados de demonstração."
        actions={
          <div className="flex gap-2">
            {(['light', 'dark'] as const).map((option) => (
              <Link
                key={option}
                href={option === 'light' ? '/infographics' : `/infographics?theme=${option}`}
                className={cn(
                  'rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide',
                  theme === option
                    ? 'border-primary bg-accent-soft text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {option === 'light' ? 'Claro' : 'Escuro'}
              </Link>
            ))}
          </div>
        }
      />

      {failed.length > 0 ? (
        <Alert tone="danger">
          Falha ao renderizar {failed.length} template(s). Verifique fontes e o pacote @resvg/resvg-js.
          {failed[0]?.error ? (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">
              {failed[0].error}
            </pre>
          ) : null}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {previews.map((item) => (
          <Card key={`${item.template}-${theme}`} className="overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <CardLabel>{item.template}</CardLabel>
                <p className="mt-1 font-mono text-sm text-foreground">{item.label}</p>
              </div>
              <Badge tone={item.error ? 'danger' : 'neutral'}>{theme}</Badge>
            </div>
            <div className="bg-muted/40 p-4">
              {item.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.dataUrl}
                  alt={`Prévia ${item.label} (${theme})`}
                  className="mx-auto h-auto w-full max-w-md rounded-md border border-border bg-background shadow-sm"
                />
              ) : (
                <p className="font-mono text-xs text-danger">{item.error ?? 'Falha ao gerar.'}</p>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
