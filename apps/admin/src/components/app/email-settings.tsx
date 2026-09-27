'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { errorMessage, formatDateTime } from '@/lib/format';

export type EmailProviderOption = {
  id: string;
  label: string;
  hint?: string;
  /** true when this provider needs host/port/secure (i.e. `custom`). */
  requiresHost: boolean;
};

export type EmailConfigView = {
  configured: boolean;
  provider?: string;
  fromName?: string;
  fromEmail?: string;
  username?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  hasPassword: boolean;
  updatedAt?: string;
};

function describeError(code?: string, message?: string) {
  if (code === 'VALIDATION_ERROR' && message) return message;
  return errorMessage(code);
}

async function parseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  return describeError(body?.error?.code, body?.error?.message);
}

export function EmailSettings({
  config,
  providers,
  apiBasePath,
}: {
  config: EmailConfigView;
  providers: EmailProviderOption[];
  apiBasePath: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [testPending, setTestPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>(config.provider ?? providers[0]?.id ?? 'gmail');
  const [current, setCurrent] = useState<EmailConfigView>(config);

  const selectedProvider = providers.find((item) => item.id === provider);
  const requiresHost = selectedProvider?.requiresHost ?? false;

  async function save(form: FormData): Promise<boolean> {
    const fromEmail = String(form.get('fromEmail') ?? '').trim();
    const username = String(form.get('username') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const fromName = String(form.get('fromName') ?? '').trim();
    if (!fromEmail || !username || !password) {
      setError('Informe o e-mail remetente, o usuário e a senha.');
      return false;
    }

    const payload: Record<string, unknown> = {
      provider,
      fromEmail,
      username,
      password,
      ...(fromName ? { fromName } : {}),
    };
    if (requiresHost) {
      payload.host = String(form.get('host') ?? '').trim();
      payload.port = Number(form.get('port') ?? 0);
      payload.secure = String(form.get('secure') ?? 'true') === 'true';
    }

    setPending(true);
    setError(null);
    setNotice(null);
    const response = await fetch(apiBasePath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setPending(false);
    if (!response.ok) {
      setError(await parseError(response));
      return false;
    }
    const body = (await response.json()) as { data?: EmailConfigView };
    if (body.data) setCurrent(body.data);
    setNotice('Configuração salva.');
    router.refresh();
    return true;
  }

  async function remove() {
    if (!window.confirm('Remover a configuração de e-mail desta empresa?')) return;
    setPending(true);
    setError(null);
    setNotice(null);
    const response = await fetch(apiBasePath, { method: 'DELETE' });
    setPending(false);
    if (!response.ok) {
      setError(await parseError(response));
      return;
    }
    setCurrent({ configured: false, hasPassword: false });
    setNotice('Configuração removida.');
    router.refresh();
  }

  async function sendTest(form: FormData) {
    const to = String(form.get('to') ?? '').trim();
    if (!to) {
      setError('Informe um destinatário para o teste.');
      return;
    }
    setTestPending(true);
    setError(null);
    setNotice(null);
    const response = await fetch(`${apiBasePath}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to }),
    });
    setTestPending(false);
    if (!response.ok) {
      setError(await parseError(response));
      return;
    }
    setNotice(`E-mail de teste enviado para ${to}.`);
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="text-base font-medium text-foreground">Caixa de e-mail (SMTP)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure a caixa usada pela Tactia para enviar e-mails desta empresa. A senha é
          armazenada criptografada e nunca é exibida novamente.
        </p>
        {current.configured ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Configurado{current.updatedAt ? ` · atualizado em ${formatDateTime(current.updatedAt)}` : ''}
            {current.hasPassword ? ' · senha armazenada' : ''}
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Nenhuma caixa configurada.</p>
        )}

        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void save(new FormData(form));
          }}
        >
          <Field htmlFor="email-provider" label="Provedor" hint={selectedProvider?.hint}>
            <Select
              id="email-provider"
              name="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              {providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field htmlFor="email-from-name" label="Nome do remetente" hint="Opcional. Ex.: Equipe Acme">
            <Input
              id="email-from-name"
              name="fromName"
              defaultValue={current.fromName ?? ''}
              placeholder="Equipe Acme"
              maxLength={120}
            />
          </Field>

          <Field htmlFor="email-from" label="E-mail remetente">
            <Input
              id="email-from"
              name="fromEmail"
              type="email"
              defaultValue={current.fromEmail ?? ''}
              placeholder="noreply@suaempresa.com"
              required
              maxLength={200}
            />
          </Field>

          <Field htmlFor="email-username" label="Usuário SMTP" hint="Normalmente o mesmo e-mail.">
            <Input
              id="email-username"
              name="username"
              defaultValue={current.username ?? ''}
              placeholder="noreply@suaempresa.com"
              required
              maxLength={200}
            />
          </Field>

          <Field
            htmlFor="email-password"
            label="Senha"
            hint={current.hasPassword ? 'Já configurada. Preencha para substituir.' : 'Senha de app do provedor.'}
          >
            <Input
              id="email-password"
              name="password"
              type="password"
              placeholder={current.hasPassword ? '••••••••' : 'Senha de app'}
              maxLength={500}
            />
          </Field>

          {requiresHost ? (
            <div className="flex flex-col gap-4 rounded-md border border-input p-4">
              <Field htmlFor="email-host" label="Host SMTP">
                <Input
                  id="email-host"
                  name="host"
                  defaultValue={current.host ?? ''}
                  placeholder="smtp.suaempresa.com"
                  maxLength={255}
                />
              </Field>
              <Field htmlFor="email-port" label="Porta" hint="465 (TLS) ou 587 (STARTTLS)">
                <Input
                  id="email-port"
                  name="port"
                  inputMode="numeric"
                  defaultValue={current.port ?? 587}
                  placeholder="587"
                />
              </Field>
              <Field htmlFor="email-secure" label="Segurança">
                <Select
                  id="email-secure"
                  name="secure"
                  defaultValue={current.secure === true ? 'true' : 'false'}
                >
                  <option value="false">STARTTLS (porta 587)</option>
                  <option value="true">TLS implícito (porta 465)</option>
                </Select>
              </Field>
            </div>
          ) : null}

          <div className="flex flex-row gap-3">
            <Button type="submit" loading={pending} className="self-start">
              Salvar
            </Button>
            {current.configured ? (
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => void remove()}
              >
                Remover
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="text-base font-medium text-foreground">Enviar e-mail de teste</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Valida a conexão SMTP e envia uma mensagem de teste usando a configuração salva.
        </p>
        {current.configured ? (
          <form
            className="mt-3 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              void sendTest(new FormData(form)).then(() => form.reset());
            }}
          >
            <Field htmlFor="email-test-to" label="Destinatário">
              <Input
                id="email-test-to"
                name="to"
                type="email"
                placeholder="voce@suaempresa.com"
                required
                maxLength={200}
              />
            </Field>
            <Button type="submit" loading={testPending} className="self-start">
              Enviar teste
            </Button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Salve a configuração antes de enviar um teste.
          </p>
        )}
      </Card>
    </div>
  );
}
