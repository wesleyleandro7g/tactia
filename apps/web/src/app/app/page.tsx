import { redirect } from 'next/navigation';
import { hasCommandCenter } from '@/lib/command-center-flag';
import { getServerContext } from '@/lib/server-context';

/** Rota legada: o app começa no dashboard, ou em Objetivos na central de comando. */
export default async function AppEntryPage() {
  const ctx = await getServerContext();
  if (await hasCommandCenter(ctx.tenantId)) redirect('/objectives');
  redirect('/dashboard');
}
