import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type Column<T> = {
  key: string;
  header: string;
  numeric?: boolean;
  render: (row: T) => ReactNode;
};

export type DataTableProps<T> = {
  caption: string;
  captionVisible?: boolean;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyLabel?: string;
  className?: string;
};

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
      <Table>
        <caption className={cn(captionVisible ? 'px-4 py-3 text-left text-sm text-muted-foreground' : 'sr-only')}>
          {caption}
        </caption>
        <TableHeader>
          <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn(
                  'text-xs font-medium uppercase tracking-wide text-muted-foreground',
                  column.numeric ? 'text-right' : 'text-left',
                )}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-muted-foreground">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={rowKey(row)} className="border-border/60">
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn('align-top', column.numeric && 'tabular text-right')}
                  >
                    {column.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
