import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Column<T> = {
  key: string;
  header: string;
  /** Alinha à direita (números). */
  numeric?: boolean;
  render: (row: T) => ReactNode;
};

export type DataTableProps<T> = {
  /** Obrigatório: descreve a tabela para leitor de tela (pode ficar visível). */
  caption: string;
  captionVisible?: boolean;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyLabel?: string;
  className?: string;
};

/**
 * Tabela mínima e acessível: caption obrigatório, `th scope="col"` e container
 * focável para permitir scroll horizontal por teclado.
 */
export function DataTable<T>({
  caption,
  captionVisible = false,
  columns,
  rows,
  rowKey,
  emptyLabel = 'Nenhum registro.',
  className,
}: DataTableProps<T>) {
  return (
    <div
      tabIndex={0}
      className={cn(
        'overflow-x-auto rounded-xl border border-border focus-visible:outline-2',
        className,
      )}
    >
      <table className="w-full border-collapse text-sm">
        <caption
          className={cn(
            captionVisible ? 'px-4 py-3 text-left text-sm text-muted' : 'sr-only',
          )}
        >
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-border bg-card">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted',
                  column.numeric ? 'text-right' : 'text-left',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-muted">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border/60 last:border-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-4 py-3 align-top',
                      column.numeric && 'tabular text-right',
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
