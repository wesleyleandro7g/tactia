import { redirect } from 'next/navigation';

/** Rota legada: o app começa no dashboard. */
export default function AppEntryPage() {
  redirect('/dashboard');
}
