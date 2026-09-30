import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { AVAILABILITY_LABEL, type Availability } from './types';

export function ExecutiveSummary({
  objectiveTitle,
  periodLabel,
  summary,
  attention,
  availability,
  limitation,
  updatedAt,
  evidenceHref,
  chatHref,
}: {
  objectiveTitle: string | null;
  periodLabel: string;
  summary: string | null;
  attention: string | null;
  availability: Availability;
  limitation?: string | null;
  updatedAt?: string | null;
  evidenceHref?: string | null;
  chatHref: string;
}) {
  const tone = availability === 'ready' ? 'success' : availability === 'error' ? 'danger' : 'warning';
  return (
    <Card aria-labelledby="executive-summary-title" className="lg:col-span-2">
      <CardHeader>
        <div>
          <Badge tone={tone}>{AVAILABILITY_LABEL[availability]}</Badge>
          <CardTitle id="executive-summary-title" className="mt-3 font-display text-2xl">
            {objectiveTitle ? `Seu foco: ${objectiveTitle}` : 'Seu foco está sendo preparado'}
          </CardTitle>
          <CardDescription>{periodLabel}{updatedAt ? ` · dados até ${updatedAt}` : ''}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex max-w-[68ch] flex-col gap-3">
        <p className="text-base leading-7">{summary ?? 'A Tactia está reconciliando as fontes disponíveis para preparar um diagnóstico verificável.'}</p>
        {attention ? <p className="font-medium">Principal atenção: {attention}</p> : <p className="text-muted-foreground">Nenhuma decisão necessária agora.</p>}
        {limitation ? <Alert tone={tone === 'success' ? 'warning' : tone} title="Limitação conhecida">{limitation}</Alert> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {evidenceHref ? <Link className={cn(buttonVariants({ variant: 'outline', size: 'md' }))} href={evidenceHref}>Ver evidências</Link> : null}
        <Link className={cn(buttonVariants({ size: 'md' }))} href={chatHref}>Conversar sobre isso</Link>
      </CardFooter>
    </Card>
  );
}
