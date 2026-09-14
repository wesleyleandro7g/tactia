import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Column<T> = {
  key: string;
  header: string;
  numeric?: boolean;
  render: (row: T) => ReactNode;
};

export function DataTable<T>({
  caption,
  captionVisible = false,
  columns,
  rows,
  rowKey,
  emptyLabel = 'Nenhum registro.',
  className,
}: {
  caption: string;
  captionVisible?: boolean;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('overflow-x-auto rounded-md border border-border', className)}>
      <table className="w-full caption-bottom text-sm">
        <caption className={captionVisible ? 'px-3 py-2 text-left font-mono text-xs text-muted-foreground' : 'sr-only'}>
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  'px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground',
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
              <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border/70 last:border-0">
                {columns.map((column) => (
                  <td key={column.key} className={cn('px-3 py-2 align-top', column.numeric && 'tabular text-right')}>
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
