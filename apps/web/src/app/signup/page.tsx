import { LeadCaptureForm } from '@/components/landing/lead-capture-form';

export const metadata = {
  title: 'Consultoria gratuita · Tactia',
  description: 'Conte sobre sua empresa e descubra oportunidades de otimização e automação com IA.',
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ pergunta?: string | string[] }>;
}) {
  const { pergunta } = await searchParams;
  return (
    <LeadCaptureForm initialContext={typeof pergunta === 'string' ? pergunta.slice(0, 2000) : ''} />
  );
}
