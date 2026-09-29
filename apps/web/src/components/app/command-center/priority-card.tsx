import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Badge, severityTone } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { PreparePlanButton } from './prepare-plan-button';

export function PriorityCard({
  rank,
  title,
  summary,
  severity,
  rankReason,
  evidence,
  action,
  prepare,
  limitation,
}: {
  rank: number;
  title: string;
  summary: string;
  severity: string;
  rankReason: string;
  evidence: string[];
  action: { label: string; href: string } | null;
  prepare?: { recommendationId: string; goalId: string } | null;
  limitation?: string | null;
}) {
  return (
    <Card size="sm" aria-labelledby={`priority-${rank}`}>
      <CardHeader>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prioridade {rank}</p>
          <CardTitle id={`priority-${rank}`} className="mt-1">{title}</CardTitle>
          <CardDescription>{summary}</CardDescription>
        </div>
        <Badge tone={severityTone(severity)}>{severity === 'critical' ? 'Crítica' : severity === 'high' ? 'Alta' : severity === 'medium' ? 'Média' : 'Baixa'}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm"><span className="font-medium">Por que está aqui:</span> {rankReason}</p>
        {evidence.length ? <ul className="flex flex-col gap-1 text-sm text-muted-foreground">{evidence.slice(0, 3).map((item) => <li key={item}>• {item}</li>)}</ul> : <Alert tone="warning">A evidência detalhada ainda está sendo reconciliada.</Alert>}
        {limitation ? <Alert tone="warning" title="Limitação">{limitation}</Alert> : null}
      </CardContent>
      {prepare ? (
        <CardFooter>
          <PreparePlanButton
            recommendationId={prepare.recommendationId}
            goalId={prepare.goalId}
          />
        </CardFooter>
      ) : action ? (
        <CardFooter>
          <Link href={action.href} className={cn(buttonVariants({ size: 'md' }), 'w-full sm:w-auto')}>
            {action.label}
          </Link>
        </CardFooter>
      ) : null}
    </Card>
  );
}
