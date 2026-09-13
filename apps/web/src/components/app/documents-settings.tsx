'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileDropzone } from '@/components/app/file-dropzone';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Field, FormInput, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/app/page-header';
import { detectUploadKind } from '@/lib/upload-mimes';
import { errorMessage } from '@/lib/format';

export type DocumentRow = {
  id: string;
  title: string;
  kind: string;
  mime: string;
  status: string;
  error: string | null;
  createdAt: string;
};

export type MediaRow = {
  id: string;
  mime: string;
  status: string;
  error: string | null;
  classification: string | null;
  resultKind: string | null;
  createdAt: string;
};

export type PendingMappingRow = {
  id: string;
  entityType: string;
  hint: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Na fila',
  processing: 'Processando',
  ready: 'Pronto',
  failed: 'Falhou',
};

const KIND_LABELS: Record<string, string> = {
  policy: 'Política',
  playbook_doc: 'Playbook',
  contract: 'Contrato',
  other: 'Outro',
};

export function DocumentsSettings({
  documents,
  media,
  pendingMapping,
  canWrite,
}: {
  documents: DocumentRow[];
  media: MediaRow[];
  pendingMapping: PendingMappingRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState('policy');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);

  async function upload() {
    if (!file) {
      setError('Escolha um arquivo.');
      return;
    }
    setPending(true);
    setError(null);
    const detected = detectUploadKind(file);
    const form = new FormData();
    form.set('file', file);
    const isMedia = detected === 'image' || detected === 'audio';
    if (isMedia) {
      form.set('purpose', 'auto');
    } else {
      form.set('kind', kind);
      if (title.trim()) form.set('title', title.trim());
    }
    const response = await fetch(isMedia ? '/api/v1/media' : '/api/v1/documents', {
      method: 'POST',
      body: form,
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }
    setFile(null);
    setTitle('');
    router.refresh();
  }

  async function remove(id: string) {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/v1/documents/${id}`, { method: 'DELETE' });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Documentos"
        description="Políticas, contratos, prints e áudios. O assistente busca o texto; números de receita e estoque continuam vindo das ferramentas determinísticas."
      />

      {canWrite ? (
        <Card className="flex flex-col gap-4 p-5">
          <Field htmlFor="doc-title" label="Título" hint="Opcional; o nome do arquivo é usado se vazio.">
            <FormInput
              id="doc-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field htmlFor="doc-kind" label="Tipo (PDF/TXT/MD)">
            <Select id="doc-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="policy">Política</option>
              <option value="playbook_doc">Playbook</option>
              <option value="contract">Contrato</option>
              <option value="other">Outro</option>
            </Select>
          </Field>
          <FileDropzone
            kinds={['document', 'image', 'audio']}
            loading={pending}
            fileName={file?.name ?? null}
            fileSize={file?.size ?? null}
            onFile={setFile}
            onClear={() => setFile(null)}
          />
          <Button type="button" loading={pending} disabled={!file} onClick={() => void upload()}>
            Enviar
          </Button>
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
        </Card>
      ) : null}

      {pendingMapping.length > 0 ? (
        <Card className="flex flex-col gap-2 p-5">
          <h2 className="text-sm font-medium">Pendentes de mapeamento</h2>
          <p className="text-xs text-muted-foreground">
            Extraímos os campos. Importe como venda/despesa no onboarding para entrar nas métricas.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {pendingMapping.map((item) => (
              <li key={item.id} className="text-muted-foreground">
                {item.entityType} · {item.id.slice(0, 8)}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {documents.length === 0 && media.length === 0 ? (
        <EmptyState
          title="Nenhum documento"
          description="Envie um PDF, texto, imagem ou áudio para indexar o que não é tabela."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {documents.map((document) => (
            <li key={document.id}>
              <Card className="flex items-start justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{document.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {KIND_LABELS[document.kind] ?? document.kind} · {STATUS_LABELS[document.status] ?? document.status}
                    {document.error ? ` · ${document.error}` : ''}
                  </p>
                </div>
                {canWrite ? (
                  <Button type="button" variant="ghost" disabled={pending} onClick={() => void remove(document.id)}>
                    Excluir
                  </Button>
                ) : null}
              </Card>
            </li>
          ))}
          {media.map((item) => (
            <li key={item.id}>
              <Card className="p-4">
                <p className="font-medium">{item.mime}</p>
                <p className="text-xs text-muted-foreground">
                  {STATUS_LABELS[item.status] ?? item.status}
                  {item.classification ? ` · ${item.classification}` : ''}
                  {item.resultKind === 'raw_record'
                    ? ' · extraído, pendente de mapeamento'
                    : item.resultKind
                      ? ` · ${item.resultKind}`
                      : ''}
                  {item.error ? ` · ${item.error}` : ''}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
