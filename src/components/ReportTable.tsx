interface Props {
  rows: Record<string, unknown>[];
}

function cellClass(key: string, val: unknown): string {
  if (key === 'achievement_pct' && typeof val === 'number') {
    if (val < 80) return 'text-red-600 dark:text-red-400 font-semibold';
    if (val < 95) return 'text-amber-600 dark:text-amber-400 font-semibold';
    return 'text-emerald-600 dark:text-emerald-400 font-semibold';
  }
  return '';
}

function fmt(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return val.toLocaleString('en-IN');
    return val.toFixed(2);
  }
  return String(val);
}

export default function ReportTable({ rows }: Props) {
  if (!rows.length) return (
    <div className="p-8 text-center text-sm text-[var(--text-muted)] bg-[var(--bg-surface)] rounded-lg border border-[var(--border)]">
      No data found for the selected filters.
    </div>
  );
  const cols = Object.keys(rows[0]);
  // Numeric columns are detected by checking the first row's value type.
  const numericCols = new Set(cols.filter(c => typeof rows[0][c] === 'number'));

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] shadow-[var(--shadow-card)]">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-[var(--bg-surface)] z-10">
          <tr>
            {cols.map(c => (
              <th
                key={c}
                className={`px-4 py-2.5 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap border-b border-[var(--border)] ${
                  numericCols.has(c) ? 'text-right' : 'text-left'
                }`}
              >
                {c.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="even:bg-[var(--bg-base)] hover:bg-[var(--bg-surface-raised)] transition-colors"
            >
              {cols.map(c => (
                <td
                  key={c}
                  className={`px-4 py-2.5 whitespace-nowrap text-[var(--text-primary)] border-b border-[var(--border)] ${
                    numericCols.has(c) ? 'tabular-nums text-right' : ''
                  } ${cellClass(c, row[c])}`}
                >
                  {fmt(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2 text-xs text-[var(--text-muted)] bg-[var(--bg-surface)] border-t border-[var(--border)]">
        {rows.length.toLocaleString('en-IN')} rows
      </div>
    </div>
  );
}
