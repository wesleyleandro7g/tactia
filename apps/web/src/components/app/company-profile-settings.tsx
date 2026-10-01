'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FormTextarea } from '@/components/ui/field';
import { PageHeader } from '@/components/app/page-header';

const fields = [
  ['industry', 'Setor', 'Em que setor a empresa atua?'],
  ['offering', 'Oferta', 'O que vende ou entrega?'],
  ['customers', 'Clientes', 'Quem compra e quais necessidades atende?'],
  ['geography', 'Atuação', 'Onde opera e atende?'],
  ['positioning', 'Posicionamento', 'Como se diferencia?'],
  ['priorities', 'Prioridades', 'Quais objetivos e limites estratégicos devem orientar as recomendações?'],
] as const;

type Profile = Record<(typeof fields)[number][0], string>;
const emptyProfile: Profile = {
  industry: '', offering: '', customers: '', geography: '', positioning: '', priorities: '',
};

export function CompanyProfileSettings({ initial, canEdit }: { initial: Partial<Profile> | null; canEdit: boolean }) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>({ ...emptyProfile, ...initial });
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');

  async function save() {
    setPending(true);
    setNotice('');
    try {
      const response = await fetch('/api/v1/agent-context/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error('Não foi possível salvar o perfil.');
      setNotice('Perfil salvo. O agente já pode usá-lo nas próximas respostas.');
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao salvar.');
    } finally {
      setPending(false);
    }
  }

  async function suggest() {
    setPending(true);
    setNotice('');
    try {
      const response = await fetch('/api/v1/agent-context/profile/suggestions', { method: 'POST' });
      if (!response.ok) throw new Error('Não foi possível gerar sugestões.');
      const body = await response.json() as { suggestions: Partial<Profile> };
      const suggested = body.suggestions ?? {};
      setProfile((current) => Object.fromEntries(fields.map(([key]) => [key, current[key] || suggested[key] || ''])) as Profile);
      setNotice(Object.keys(suggested).length ? 'Sugestões preenchidas nos campos vazios. Revise antes de salvar.' : 'Ainda não há informações suficientes nas conversas para sugerir complementos.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao gerar sugestões.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Perfil da empresa" description="Contexto oficial que orienta o agente no chat e no WhatsApp. Informações das conversas podem sugerir complementos, mas só entram aqui após sua revisão." />
      <Card className="flex flex-col gap-5 p-5">
        {fields.map(([key, label, hint]) => (
          <Field key={key} htmlFor={`company-${key}`} label={label} hint={hint}>
            <FormTextarea
              id={`company-${key}`} rows={2} maxLength={key === 'industry' || key === 'geography' ? 1000 : key === 'offering' || key === 'priorities' ? 2000 : 1500}
              value={profile[key]} disabled={!canEdit || pending}
              onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))}
            />
          </Field>
        ))}
        {canEdit ? <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} loading={pending}>Salvar perfil</Button>
          <Button variant="outline" onClick={() => void suggest()} disabled={pending}>Sugerir a partir das conversas</Button>
        </div> : <p className="text-sm text-muted-foreground">Owner/admin pode editar este perfil.</p>}
        {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      </Card>
    </div>
  );
}
