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
    <div className="relative h-0 w-0 overflow-hidden">
      <table className="sr-only whitespace-normal">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{labelHeader}</th>
            <th scope="col">{valueHeader}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
