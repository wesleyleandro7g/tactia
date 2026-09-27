'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { errorMessage, formatDateTime } from '@/lib/format';
import { acceptForKinds, detectUploadKind } from '@/lib/upload-mimes';

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
  documentsBasePath,
  mediaBasePath,
}: {
  documents: DocumentRow[];
  media: MediaRow[];
  pendingMapping: PendingMappingRow[];
  documentsBasePath: string;
  mediaBasePath: string;
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
    const detected = detectUploadKind(file);
    if (!detected) {
      setError('Envie um PDF, TXT, Markdown, imagem ou áudio.');
      return;
    }
    setPending(true);
    setError(null);
    const isMedia = detected === 'image' || detected === 'audio';
    const form = new FormData();
    form.set('file', file);
    if (isMedia) {
      form.set('purpose', 'auto');
    } else {
      form.set('kind', kind);
      if (title.trim()) form.set('title', title.trim());
    }
    const response = await fetch(isMedia ? mediaBasePath : documentsBasePath, {
      method: 'POST',
      body: form,
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      setError(body?.error?.message ?? errorMessage(body?.error?.code));
      return;
    }
    setFile(null);
    setTitle('');
    router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm('Remover este documento?')) return;
    setPending(true);
    setError(null);
    const response = await fetch(`${documentsBasePath}/${id}`, { method: 'DELETE' });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <h2 className="text-base font-medium text-foreground">Enviar arquivo</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          PDF, TXT ou Markdown viram documentos de conhecimento. Imagens e áudios são processados
          como mídia.
        </p>
        <div className="mt-3 flex flex-col gap-4">
          <Field htmlFor="doc-file" label="Arquivo">
            <input
              id="doc-file"
              type="file"
              accept={acceptForKinds(['document', 'image', 'audio'])}
              className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:font-mono file:text-xs file:uppercase file:text-secondary-foreground"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <Field htmlFor="doc-kind" label="Tipo" hint="Usado apenas para documentos (PDF/TXT/MD).">
            <Select id="doc-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="policy">Política</option>
              <option value="playbook_doc">Playbook</option>
              <option value="contract">Contrato</option>
              <option value="other">Outro</option>
            </Select>
          </Field>
          <Field htmlFor="doc-title" label="Título" hint="Opcional (documentos).">
            <Input
              id="doc-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Nome do documento"
              maxLength={120}
            />
          </Field>
          <Button type="button" loading={pending} disabled={!file} className="self-start" onClick={() => void upload()}>
            Enviar
          </Button>
        </div>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Documentos</h2>
        {documents.length === 0 ? (
          <Card>
            <p className="text-sm text-muted-foreground">Nenhum documento.</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((document) => (
              <li key={document.id}>
                <Card className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-foreground">{document.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {KIND_LABELS[document.kind] ?? document.kind} · {STATUS_LABELS[document.status] ?? document.status}
                      {` · ${formatDateTime(document.createdAt)}`}
                    </p>
                    {document.error ? <p className="text-xs text-danger">{document.error}</p> : null}
                  </div>
                  <Button type="button" variant="danger" disabled={pending} onClick={() => void remove(document.id)}>
                    Remover
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {media.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Mídia</h2>
          <ul className="flex flex-col gap-2">
            {media.map((item) => (
              <li key={item.id} className="text-sm text-muted-foreground">
                {item.mime} · {STATUS_LABELS[item.status] ?? item.status}
                {item.classification ? ` · ${item.classification}` : ''}
                {` · ${formatDateTime(item.createdAt)}`}
                {item.error ? ` · ${item.error}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pendingMapping.length > 0 ? (
        <Alert tone="warning" title="Mapeamentos pendentes">
          <ul className="mt-1 flex flex-col gap-1">
            {pendingMapping.map((item) => (
              <li key={item.id}>
                {item.entityType}: {item.hint}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}
