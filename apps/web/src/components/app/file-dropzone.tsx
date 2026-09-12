'use client';

import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { MAX_UPLOAD_BYTES, isCsvFile } from '@/lib/csv-upload-shared';

export type FileDropzoneProps = {
  accept?: string;
  maxSizeBytes?: number;
  disabled?: boolean;
  loading?: boolean;
  fileName?: string | null;
  fileSize?: number | null;
  error?: string | null;
  onFile: (file: File) => void;
  onClear?: () => void;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Baia de recebimento: clique abre o seletor, arrastar solta o arquivo.
 * O input de arquivo fica visualmente oculto; o botão carrega o rótulo acessível.
 */
export function FileDropzone({
  accept = '.csv,text/csv',
  maxSizeBytes = MAX_UPLOAD_BYTES,
  disabled = false,
  loading = false,
  fileName,
  fileSize,
  error,
  onFile,
  onClear,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const shownError = error ?? localError;
  const ready = Boolean(fileName) && !loading;
  const locked = disabled || loading;

  function openPicker() {
    if (locked) return;
    inputRef.current?.click();
  }

  function validateAndEmit(file: File | undefined) {
    if (!file) return;
    if (!isCsvFile(file)) {
      setLocalError('Envie um arquivo CSV.');
      return;
    }
    if (file.size > maxSizeBytes) {
      setLocalError('O arquivo pode ter no máximo 20 MB.');
      return;
    }
    setLocalError(null);
    onFile(file);
  }

  function onDragOver(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (locked) return;
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  }

  function onDragLeave() {
    setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    if (locked) return;
    validateAndEmit(event.dataTransfer.files[0]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-label={
          ready
            ? `Arquivo ${fileName}. Clique para trocar ou arraste outro.`
            : 'Arraste o arquivo ou clique para escolher'
        }
        aria-describedby={shownError ? errorId : undefined}
        aria-busy={loading || undefined}
        disabled={locked}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'relative flex min-h-44 w-full flex-col items-center justify-center gap-3 overflow-hidden',
          'rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-200',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          !ready && !dragging && !shownError && 'border-border bg-card hover:border-muted hover:bg-card-hover',
          dragging && 'border-accent bg-accent-soft',
          ready && !shownError && 'border-success/50 bg-success-soft',
          shownError && 'border-danger/50 bg-danger-soft',
          locked && 'cursor-not-allowed opacity-70',
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        {loading ? (
          <span aria-live="polite" className="relative text-sm text-muted-foreground">
            Enviando arquivo…
          </span>
        ) : ready ? (
          <span className="relative flex max-w-full flex-col items-center gap-2">
            <span className="rounded-full border border-success/40 bg-card px-3 py-1 text-sm tabular text-fg">
              {fileName}
            </span>
            {fileSize ? <span className="text-xs text-muted-foreground tabular">{formatBytes(fileSize)}</span> : null}
            <span className="text-xs text-muted-foreground">Clique ou arraste para trocar</span>
          </span>
        ) : (
          <span className="relative flex flex-col items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-xl border text-lg',
                dragging ? 'border-accent text-accent' : 'border-border text-muted-foreground',
              )}
            >
              ↓
            </span>
            <span className="text-sm font-medium text-fg">
              {dragging ? 'Solte o CSV aqui' : 'Arraste o arquivo ou clique para escolher'}
            </span>
            <span className="text-xs text-muted-foreground">CSV até 20 MB</span>
          </span>
        )}
      </button>

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={locked}
        onChange={(event) => {
          validateAndEmit(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {ready && onClear && !loading ? (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-fg hover:underline"
          onClick={onClear}
        >
          Remover arquivo
        </button>
      ) : null}

      {shownError ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
