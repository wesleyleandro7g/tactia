'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SourceKind } from '@tactia/domain/data-sources/catalog';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { WizardStepper } from '@/components/app/wizard-stepper';
import { opsJson } from '@/lib/ops-fetch';

type TrelloBoard = {
  id: string;
  name?: string;
  closed?: boolean;
  url?: string;
  idOrganization?: string;
};

const STEPS = [
  { id: 'authorization', label: 'Autorização' },
  { id: 'boards', label: 'Quadros' },
  { id: 'review', label: 'Concluir' },
] as const;

const OAUTH_ERRORS: Record<string, string> = {
  authorization_denied: 'A autorização foi cancelada no Trello.',
  state_mismatch: 'A validação de segurança expirou ou não corresponde à sessão.',
  missing_code: 'O Trello não retornou o código de autorização.',
  oauth_failed: 'Não foi possível concluir a autorização com o Trello.',
};

export function TrelloConnectWizard({
  tenantId,
  kind,
  oauthCredentialId,
  oauthStatus,
  oauthReason,
}: {
  tenantId: string;
  kind: SourceKind;
  oauthCredentialId?: string;
  oauthStatus?: string;
  oauthReason?: string;
}) {
  const router = useRouter();
  const loadedCredential = useRef<string | null>(null);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(kind.label);
  const [credentialId] = useState(oauthCredentialId ?? '');
  const [boards, setBoards] = useState<TrelloBoard[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [historyDays, setHistoryDays] = useState<'30' | '90' | '180' | 'all'>('90');
  const [tested, setTested] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    oauthStatus === 'error' ? OAUTH_ERRORS[oauthReason ?? 'oauth_failed'] ?? OAUTH_ERRORS.oauth_failed! : null,
  );
  const [message, setMessage] = useState<string | null>(null);

  const selectedBoards = useMemo(
    () => boards.filter((board) => selected.includes(board.id)),
    [boards, selected],
  );

  const loadBoards = useCallback(async (id: string) => {
    setPending(true);
    setError(null);
    try {
      const result = await opsJson<{ success: boolean; message: string; boards?: TrelloBoard[] }>(
        `/api/v1/tenants/${tenantId}/data-sources/probe`,
        { body: { type: 'trello', credentialId: id } },
      );
      if (!result.success) {
        setTested(false);
        setError(result.message || 'Falha ao conectar com o Trello.');
        return;
      }
      const available = (result.boards ?? []).filter((board) => board.id);
      setBoards(available);
      setTested(true);
      setMessage(`Trello autorizado. ${available.length} quadro(s) disponível(is).`);
    } catch (cause) {
      setTested(false);
      setError(cause instanceof Error ? cause.message : 'Falha ao conectar com o Trello.');
    } finally {
      setPending(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!credentialId || loadedCredential.current === credentialId) return;
    loadedCredential.current = credentialId;
    void loadBoards(credentialId);
  }, [credentialId, loadBoards]);

  function toggleBoard(id: string) {
    setSelected((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  }

  function next() {
    if (step === 0 && (!credentialId || !tested)) {
      setError('Autorize e valide a conta Trello antes de continuar.');
      return;
    }
    if (step === 1 && selected.length === 0) {
      setError('Selecione ao menos um quadro.');
      return;
    }
    setError(null);
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  }

  async function conclude() {
    if (!credentialId || !tested || selected.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const created = await opsJson<{ id: string }>(`/api/v1/tenants/${tenantId}/data-sources`, {
        body: {
          name: name.trim(),
          type: 'trello',
          credentialId,
          configuration: {
            boardIds: selected,
            historyDays: historyDays === 'all' ? null : Number(historyDays),
          },
        },
      });
      router.push(`/tenants/${tenantId}/data-sources/${created.id}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao criar a fonte Trello.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <WizardStepper steps={[...STEPS]} currentIndex={step} />
      <div className="flex flex-col gap-4">
        {step === 0 ? (
          <>
            <Field htmlFor="trello-name" label="Nome da fonte">
              <Input id="trello-name" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            {credentialId && tested ? (
              <Alert tone="success" title="Conta Trello autorizada">
                Os tokens estão criptografados e serão renovados automaticamente.
              </Alert>
            ) : (
              <Alert title="OAuth 2.0 com PKCE">
                Você será redirecionado à Atlassian para autorizar acesso somente de leitura.
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <a
                className={buttonVariants()}
                href={`/api/v1/oauth/trello/start?tenantId=${encodeURIComponent(tenantId)}`}
              >
                {credentialId ? 'Autorizar outra conta' : 'Conectar com Trello'}
              </a>
              {credentialId ? (
                <Button type="button" variant="secondary" loading={pending} onClick={() => void loadBoards(credentialId)}>
                  Atualizar quadros
                </Button>
              ) : null}
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <p className="text-sm text-muted-foreground">Selecione os quadros que esta fonte deverá acompanhar.</p>
            <div className="max-h-80 overflow-y-auto rounded-md border border-border bg-card">
              {boards.map((board) => (
                <label key={board.id} className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-3 last:border-b-0">
                  <input type="checkbox" className="mt-1" checked={selected.includes(board.id)} onChange={() => toggleBoard(board.id)} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{board.name || board.id}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{board.closed ? 'arquivado · ' : ''}{board.id}</span>
                  </span>
                </label>
              ))}
              {boards.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">Nenhum quadro acessível.</p> : null}
            </div>
            <Field htmlFor="trello-history" label="Histórico inicial">
              <Select id="trello-history" value={historyDays} onChange={(event) => setHistoryDays(event.target.value as typeof historyDays)}>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
                <option value="180">Últimos 180 dias</option>
                <option value="all">Todo o histórico disponível</option>
              </Select>
            </Field>
          </>
        ) : null}

        {step === 2 ? (
          <dl className="rounded-md border border-border bg-card p-4 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Fonte</dt><dd>{name}</dd></div>
            <div className="mt-2 flex justify-between gap-4"><dt className="text-muted-foreground">Quadros</dt><dd>{selectedBoards.length}</dd></div>
            <div className="mt-2 flex justify-between gap-4"><dt className="text-muted-foreground">Histórico</dt><dd>{historyDays === 'all' ? 'Completo' : `${historyDays} dias`}</dd></div>
          </dl>
        ) : null}

        {message ? <Alert tone="success">{message}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex gap-2">
          {step > 0 ? <Button type="button" variant="secondary" disabled={pending} onClick={() => setStep((current) => current - 1)}>Voltar</Button> : null}
          {step < STEPS.length - 1 ? <Button type="button" disabled={pending} onClick={next}>Continuar</Button> : <Button type="button" loading={pending} onClick={() => void conclude()}>Conectar Trello</Button>}
        </div>
      </div>
    </div>
  );
}
