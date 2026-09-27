'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { errorMessage } from '@/lib/format';

type PlaybookStep = { ordinal: number; text: string; actionType?: 'create_task' | 'send_email' };

export type PlaybookRow = {
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

export function PlaybooksSettings({
  playbooks,
  apiBasePath,
}: {
  playbooks: PlaybookRow[];
  apiBasePath: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlaybookRow | null>(null);

  async function save(form: FormData): Promise<boolean> {
    setPending(true);
    setError(null);
    const payload = {
      slug: String(form.get('slug') ?? '').trim(),
      title: String(form.get('title') ?? '').trim(),
      trigger: String(form.get('trigger') ?? '').trim(),
      steps: textToSteps(String(form.get('steps') ?? '')),
      enabled: form.get('enabled') === 'on',
    };
    const response = await fetch(editing ? `${apiBasePath}/${editing.id}` : apiBasePath, {
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
    if (!window.confirm('Remover este playbook?')) return;
    setPending(true);
    setError(null);
    const response = await fetch(`${apiBasePath}/${id}`, { method: 'DELETE' });
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
    <div className="flex flex-col gap-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <h2 className="text-base font-medium text-foreground">{editing ? 'Editar playbook' : 'Novo playbook'}</h2>
        <form
          key={editing?.id ?? 'new'}
          className="mt-3 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void save(new FormData(form)).then((ok) => {
              if (ok && !editing) form.reset();
            });
          }}
        >
          <Field htmlFor="pb-title" label="Título">
            <Input id="pb-title" name="title" required defaultValue={editing?.title ?? ''} />
          </Field>
          <Field htmlFor="pb-slug" label="Slug" hint="2–64 caracteres: a-z, 0-9 e hífen.">
            <Input id="pb-slug" name="slug" required pattern="[-a-z0-9]{2,64}" defaultValue={editing?.slug ?? ''} />
          </Field>
          <Field htmlFor="pb-trigger" label="Quando usar">
            <Textarea id="pb-trigger" name="trigger" rows={2} required defaultValue={editing?.trigger ?? ''} />
          </Field>
          <Field htmlFor="pb-steps" label="Passos" hint="Um passo por linha. O assistente narra; não executa.">
            <Textarea
              id="pb-steps"
              name="steps"
              rows={5}
              required
              defaultValue={editing ? stepsToText(editing.steps) : ''}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" name="enabled" defaultChecked={editing?.enabled ?? true} />
            Habilitado
          </label>
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>
              {editing ? 'Salvar playbook' : 'Criar playbook'}
            </Button>
            {editing ? (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setEditing(null)}>
                Cancelar
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {playbooks.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Nenhum playbook.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {playbooks.map((playbook) => (
            <li key={playbook.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{playbook.title}</p>
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
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                  {playbook.steps.map((step) => (
                    <li key={step.ordinal}>{step.text}</li>
                  ))}
                </ol>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
