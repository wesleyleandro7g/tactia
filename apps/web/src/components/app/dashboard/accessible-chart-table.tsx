export function AccessibleChartTable({
  caption,
  labelHeader,
  valueHeader,
  rows,
}: {
  caption: string;
  labelHeader: string;
  valueHeader: string;
  rows: Array<{ key: string; label: string; value: string }>;
}) {
  return (
    <details className="border-t border-border pt-3 text-sm">
      <summary className="w-fit cursor-pointer text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Ver dados em tabela
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-4 font-medium">{labelHeader}</th>
              <th scope="col" className="py-2 font-medium">{valueHeader}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-border/60 last:border-0">
                <th scope="row" className="min-w-0 break-words py-2 pr-4 font-normal">{row.label}</th>
                <td className="min-w-0 break-words py-2 tabular-nums">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
