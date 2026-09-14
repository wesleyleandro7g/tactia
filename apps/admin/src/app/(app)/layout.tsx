import { OpsShell } from '@/components/app/ops-shell';
import { requireOperator } from '@/lib/server-context';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { operator } = await requireOperator();
  return (
    <OpsShell operatorName={operator.name} operatorEmail={operator.email}>
      {children}
    </OpsShell>
  );
}
