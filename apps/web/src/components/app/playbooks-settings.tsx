'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Field, FormInput, FormTextarea } from '@/components/ui/field';
import { errorMessage } from '@/lib/format';

type PlaybookStep = { ordinal: number; text: string; actionType?: 'create_task' | 'send_email' };

type PlaybookRow = {
  id: string;
  slug: string;
  title: string;
  trigger: string;
  steps: PlaybookStep[];
  enabled: boolean;
  indexed: boolean;
};

function stepsToText(steps: PlaybookStep[]): string {
  return [...steps]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((step) => step.text)
    .join('\n');
}

function textToSteps(value: string): PlaybookStep[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, index) => ({ ordinal: index + 1, text }));
}

export function PlaybooksSettings({ playbooks }: { playbooks: PlaybookRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlaybookRow | null>(null);

  async function save(form: FormData) {
    setPending(true);
    setError(null);
    const payload = {
      slug: String(form.get('slug') ?? '').trim(),
      title: String(form.get('title') ?? '').trim(),
      trigger: String(form.get('trigger') ?? '').trim(),
      steps: textToSteps(String(form.get('steps') ?? '')),
      enabled: form.get('enabled') === 'on',
    };
    const response = await fetch(editing ? `/api/v1/playbooks/${editing.id}` : '/api/v1/playbooks', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return false;
    }
    setEditing(null);
    router.refresh();
    return true;
  }

  async function remove(id: string) {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/v1/playbooks/${id}`, { method: 'DELETE' });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }
    if (editing?.id === id) setEditing(null);
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Playbooks</h1>
        <p className="text-sm text-muted-foreground">
          Procedimentos que a Tactia narra no chat. O assistente nunca executa um playbook sozinho.
        </p>
      </header>

      <Card className="p-5">
        <form
          key={editing?.id ?? 'new'}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void save(new FormData(form)).then((ok) => {
              if (ok && !editing) form.reset();
            });
          }}
        >
          <Field htmlFor="title" label="Título">
            <FormInput id="title" name="title" required defaultValue={editing?.title ?? ''} />
          </Field>
          <Field htmlFor="slug" label="Slug" hint="2–64 caracteres: a-z, 0-9 e hífen.">
            <FormInput
              id="slug"
              name="slug"
              required
              pattern="[-a-z0-9]{2,64}"
              defaultValue={editing?.slug ?? ''}
            />
          </Field>
          <Field htmlFor="trigger" label="Quando usar">
            <FormTextarea id="trigger" name="trigger" rows={2} required defaultValue={editing?.trigger ?? ''} />
          </Field>
          <Field htmlFor="steps" label="Passos" hint="Um passo por linha. O assistente narra; não executa.">
            <FormTextarea
              id="steps"
              name="steps"
              rows={5}
              required
              defaultValue={editing ? stepsToText(editing.steps) : ''}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={editing?.enabled ?? true} />
            Habilitado
          </label>
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>
              {editing ? 'Salvar playbook' : 'Criar playbook'}
            </Button>
            {editing ? (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setEditing(null)}
              >
                Cancelar
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {playbooks.length === 0 ? (
        <EmptyState title="Nenhum playbook" description="Crie o primeiro procedimento da empresa." />
      ) : (
        <ul className="flex flex-col gap-3">
          {playbooks.map((playbook) => (
            <li key={playbook.id}>
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{playbook.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {playbook.slug}
                      {playbook.enabled ? '' : ' · desabilitado'}
                      {' · '}
                      {playbook.indexed ? 'indexado' : 'pendente de índice'}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{playbook.trigger}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(playbook)}>
                      Editar
                    </Button>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => void remove(playbook.id)}>
                      Remover
                    </Button>
                  </div>
                </div>
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {playbook.steps.map((step) => (
                    <li key={step.ordinal}>{step.text}</li>
                  ))}
                </ol>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
