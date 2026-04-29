// src/components/dashboard/ExpensesTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { runDashboardQuery } from '@/app/reports/actions';
import { Filters } from '@/lib/schema';
import { fmtL, fmtPct, fmtCount } from './shared';

interface Props { filters: Filters }

export default function ExpensesTab({ filters }: Props) {
  const [data, setData] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    runDashboardQuery('expenses', filters)
      .then(rows => setData((rows[0] as Record<string, number>) ?? {}))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filters]);

  const n = (k: string) => Number(data[k] ?? 0);

  const rows: { num: number; label: string; value: string; note?: string; bold?: boolean; divider?: boolean }[] = [
    { num: 1,  label: 'FOC Value',                             value: fmtL(n('foc_value')),              note: 'foc_value' },
    { num: 2,  label: 'Sample & Marketing Expenses',           value: fmtL(n('sample_mrkt_exp')),        note: 'sample_exp + mrkt_exp' },
    { num: 3,  label: 'No. of Patients (PAP)',                 value: fmtCount(n('pap_patients')),       note: 'no_patient × 1000' },
    { num: 4,  label: 'No. of Patients (DCPP)',                value: fmtCount(n('dcpp_patients')),      note: 'dc_patient × 1000' },
    { num: 5,  label: 'Camp Expenses',                         value: fmtL(n('camp_exp')),               note: 'camp_exp' },
    { num: 6,  label: 'Total Expenses',                        value: fmtL(n('total_expenses')),         note: 'FOC + Sample+Mrkt + Camp', bold: true },
    { num: 7,  label: 'Total Secondary Sales',                 value: fmtL(n('total_secondary_sales')),  note: 'sales_valu − foc_val_n + foc_value', bold: true, divider: true },
    { num: 8,  label: 'Expenses % of Secondary Sales',        value: fmtPct(n('exp_pct_secondary')),    bold: true },
    { num: 9,  label: 'Net Secondary Sales',                   value: fmtL(n('net_secondary_sales')),    note: 'sales_valu − foc_val_n', divider: true },
    { num: 10, label: 'Expenses % of Net Secondary Sales',    value: fmtPct(n('exp_pct_net_secondary')), bold: true },
  ];

  return (
    <div className="space-y-5">
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Expense Details</h3>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {rows.map(row => (
              <tr
                key={row.num}
                className={`border-b border-[var(--border)] last:border-0 ${row.divider ? 'border-t-2 border-t-[var(--border-strong)]' : ''}`}
              >
                <td className="px-5 py-3 text-[var(--text-muted)] w-8 text-right">{row.num}.</td>
                <td className="px-3 py-3 text-[var(--text-primary)] flex-1">
                  <span className={row.bold ? 'font-semibold' : ''}>{row.label}</span>
                  {row.note && (
                    <span className="ml-2 text-[11px] text-[var(--text-muted)] font-normal">({row.note})</span>
                  )}
                </td>
                <td className={`px-5 py-3 text-right tabular-nums ${row.bold ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                  {loading ? '—' : row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
