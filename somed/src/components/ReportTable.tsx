// No 'use client' needed (no hooks)
interface Props {
  rows: Record<string, unknown>[];
}

function cellColor(key: string, val: unknown): string {
  if (key === 'achievement_pct' && typeof val === 'number') {
    if (val < 80) return 'text-red-600 font-semibold';
    if (val < 95) return 'text-amber-600 font-semibold';
    return 'text-green-600 font-semibold';
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
  if (!rows.length) return <p className="text-sm text-zinc-400">No data</p>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded border border-zinc-200">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-100 text-zinc-600 uppercase text-xs">
          <tr>
            {cols.map(c => <th key={c} className="px-3 py-2 text-left whitespace-nowrap">{c.replace(/_/g,' ')}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-zinc-50">
              {cols.map(c => (
                <td key={c} className={`px-3 py-1.5 whitespace-nowrap ${cellColor(c, row[c])}`}>
                  {fmt(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
