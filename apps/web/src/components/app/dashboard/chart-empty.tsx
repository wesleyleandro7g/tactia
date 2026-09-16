import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ChartEmpty({
  title,
  description,
  message = 'Sem dados no período.',
}: {
  title: string;
  description?: string;
  message?: string;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="mb-0">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
      </CardHeader>
      <p className="py-10 text-center text-sm text-muted-foreground">{message}</p>
    </Card>
  );
}
