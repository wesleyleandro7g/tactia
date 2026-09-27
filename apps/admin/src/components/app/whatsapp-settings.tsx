'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { errorMessage, formatDateTime } from '@/lib/format';

export type WhatsappNumberRow = {
  id: string;
  phone: string;
  label: string | null;
  contactName: string | null;
  contactRole: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  disabledAt: string | null;
  createdAt: string;
};

export type WhatsappUserOption = {
  id: string;
  name: string;
  email: string;
};

export type WhatsappAgentConfigValue = {
  tone: string;
  instructions: string;
  companyContext: string;
};

function describeError(code?: string, message?: string) {
  if (code === 'CONFLICT') return 'Este número já está cadastrado.';
  if (code === 'VALIDATION_ERROR' && message) return message;
  return errorMessage(code);
}

export function WhatsappSettings({
  numbers,
  users,
  apiBasePath,
  config,
}: {
  numbers: WhatsappNumberRow[];
  users: WhatsappUserOption[];
  apiBasePath: string;
  config: WhatsappAgentConfigValue;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localNumbers, setLocalNumbers] = useState<WhatsappNumberRow[] | null>(null);
  const [configForm, setConfigForm] = useState<WhatsappAgentConfigValue>(config);
  const [configPending, setConfigPending] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const displayed = localNumbers ?? numbers;
  const active = displayed.filter((row) => !row.disabledAt);
  const disabled = displayed.filter((row) => row.disabledAt);

  async function create(form: FormData): Promise<boolean> {
    const phone = String(form.get('phone') ?? '').trim();
    const userId = String(form.get('userId') ?? '').trim();
    const label = String(form.get('label') ?? '').trim();
    const contactName = String(form.get('contactName') ?? '').trim();
    const contactRole = String(form.get('contactRole') ?? '').trim();
    if (!phone || !userId) {
      setError('Informe o número e o usuário.');
      return false;
    }
    setPending(true);
    setError(null);
    const response = await fetch(`${apiBasePath}/numbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        userId,
        ...(label ? { label } : {}),
        ...(contactName ? { contactName } : {}),
        ...(contactRole ? { contactRole } : {}),
      }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      setError(describeError(body?.error?.code, body?.error?.message));
      return false;
    }
    const payload = (await response.json()) as {
      data?: {
        id: string;
        phone: string;
        label: string | null;
        contactName: string | null;
        contactRole: string | null;
        userId: string;
        user?: { name: string; email: string };
        disabledAt: string | null;
        createdAt: string;
      };
    };
    const created = payload.data;
    if (created) {
      const row: WhatsappNumberRow = {
        id: created.id,
        phone: created.phone,
        label: created.label,
        contactName: created.contactName,
        contactRole: created.contactRole,
        userId: created.userId,
        userName: created.user?.name ?? 'Usuário',
        userEmail: created.user?.email ?? '',
        disabledAt: created.disabledAt,
        createdAt: created.createdAt,
      };
      setLocalNumbers([row, ...displayed.filter((item) => item.id !== row.id)]);
    }
    router.refresh();
    return true;
  }

  async function saveConfig() {
    setConfigPending(true);
    setConfigError(null);
    setConfigSaved(false);
    const response = await fetch(`${apiBasePath}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tone: configForm.tone.trim() || null,
        instructions: configForm.instructions.trim() || null,
        companyContext: configForm.companyContext.trim() || null,
      }),
    });
    setConfigPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      setConfigError(describeError(body?.error?.code, body?.error?.message));
      return;
    }
    setConfigSaved(true);
    router.refresh();
  }

  async function disable(id: string) {
    if (!window.confirm('Desativar este número? O assistente para de responder mensagens dele.')) return;
    setPending(true);
    setError(null);
    const response = await fetch(`${apiBasePath}/numbers/${id}`, { method: 'DELETE' });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      setError(describeError(body?.error?.code, body?.error?.message));
      return;
    }
    const now = new Date().toISOString();
    setLocalNumbers((current) =>
      (current ?? numbers).map((row) => (row.id === id ? { ...row, disabledAt: now } : row)),
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <h2 className="text-base font-medium text-foreground">Comunicação do agente</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tom e contexto que o agente usa ao responder pelo WhatsApp desta empresa.
        </p>
        {configError ? (
          <div className="mt-2">
            <Alert tone="danger">{configError}</Alert>
          </div>
        ) : null}
        {configSaved ? <p className="mt-2 text-sm text-emerald-600">Configuração salva.</p> : null}
        <form
          className="mt-3 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveConfig();
          }}
        >
          <Field htmlFor="wa-tone" label="Tom de voz" hint="Ex.: Formal e objetivo">
            <Input
              id="wa-tone"
              value={configForm.tone}
              onChange={(event) => setConfigForm((c) => ({ ...c, tone: event.target.value }))}
              placeholder="Amigável, direto ao ponto"
              maxLength={80}
            />
          </Field>
          <Field htmlFor="wa-instructions" label="Instruções de atendimento">
            <Textarea
              id="wa-instructions"
              value={configForm.instructions}
              onChange={(event) => setConfigForm((c) => ({ ...c, instructions: event.target.value }))}
              placeholder="Confirme antes de enviar e-mails."
              rows={3}
              maxLength={2000}
            />
          </Field>
          <Field htmlFor="wa-company-context" label="Contexto da empresa">
            <Textarea
              id="wa-company-context"
              value={configForm.companyContext}
              onChange={(event) => setConfigForm((c) => ({ ...c, companyContext: event.target.value }))}
              placeholder="Loja de calçados com 3 filiais em SP."
              rows={3}
              maxLength={2000}
            />
          </Field>
          <Button type="submit" loading={configPending} className="self-start">
            Salvar configuração
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-base font-medium text-foreground">Autorizar número</h2>
        {users.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Cadastre um usuário ativo nesta empresa antes de autorizar um número.
          </p>
        ) : (
          <form
            className="mt-3 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              void create(new FormData(form)).then((ok) => {
                if (ok) form.reset();
              });
            }}
          >
            <Field htmlFor="wa-phone" label="Número" hint="DDI + DDD + número, só dígitos. Ex.: 5511999999999">
              <Input id="wa-phone" name="phone" inputMode="numeric" placeholder="5511999999999" required maxLength={32} />
            </Field>
            <Field htmlFor="wa-user" label="Usuário">
              <Select id="wa-user" name="userId" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.email}
                  </option>
                ))}
              </Select>
            </Field>
            <Field htmlFor="wa-label" label="Apelido" hint="Opcional">
              <Input id="wa-label" name="label" placeholder="Celular do João" maxLength={80} />
            </Field>
            <Field htmlFor="wa-contact-name" label="Nome de tratamento" hint="Opcional">
              <Input id="wa-contact-name" name="contactName" placeholder="João Silva" maxLength={120} />
            </Field>
            <Field htmlFor="wa-contact-role" label="Cargo" hint="Opcional">
              <Input id="wa-contact-role" name="contactRole" placeholder="Gerente Comercial" maxLength={120} />
            </Field>
            <Button type="submit" loading={pending} className="self-start">
              Autorizar
            </Button>
          </form>
        )}
      </Card>

      {active.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Nenhum número autorizado.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {active.map((row) => (
            <li key={row.id}>
              <Card className="flex flex-row items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-foreground">{row.label ?? row.phone}</p>
                  <p className="font-mono text-xs text-muted-foreground">{row.phone}</p>
                  {row.contactName || row.contactRole ? (
                    <p className="text-xs text-muted-foreground">
                      {[row.contactName, row.contactRole].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {row.userName} · {row.userEmail}
                    {` · desde ${formatDateTime(row.createdAt)}`}
                  </p>
                </div>
                <Button type="button" variant="danger" disabled={pending} onClick={() => void disable(row.id)}>
                  Desativar
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {disabled.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Desativados</h2>
          <ul className="flex flex-col gap-2">
            {disabled.map((row) => (
              <li key={row.id} className="text-sm text-muted-foreground">
                {row.phone} · {row.userName}
                {row.disabledAt ? ` · desativado em ${formatDateTime(row.disabledAt)}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
