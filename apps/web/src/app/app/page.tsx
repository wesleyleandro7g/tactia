import { redirect } from 'next/navigation';

/** Rota de entrada: o app começa em Objetivos. */
export default function AppEntryPage() {
  redirect('/objectives');
}
