// src/components/dashboard/ExpensesTab.tsx
'use client';
import { Loader2, Inbox } from 'lucide-react';
import { runDashboardQuery } from '@/app/reports/actions';
import { Filters } from '@/lib/schema';
import { useDataFetch } from '@/lib/hooks/useDataFetch';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { fmtL, fmtPct, fmtCount } from './shared';

interface Props { filters: Filters }

const ExpensesSkeleton = () => (
  <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-[var(--shadow-card)] overflow-hidden">
    <div className="px-5 py-4 border-b border-[var(--border)]">
      <Skeleton className="h-3 w-32" />
    </div>
    <div className="divide-y divide-[var(--border)]">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="px-5 py-3 flex items-center gap-4">
          <Skeleton className="h-3 w-6" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  </div>
);

export default function ExpensesTab({ filters }: Props) {
  const { data, isFirstLoad, isRefetching, error } = useDataFetch(
    () => runDashboardQuery('expenses', filters)
      .then(rows => (rows[0] as Record<string, number | null>) ?? {}),
    [JSON.stringify(filters)],
  );

  if (error) return <ErrorBanner error={error} />;
  if (isFirstLoad || !data) return <ExpensesSkeleton />;

  if (Object.keys(data).length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="w-5 h-5" />}
        title="No data for this filter combination"
        description="Try removing a filter or selecting a different financial year."
      />
    );
  }

  const get = (k: string): number | null => {
    const v = data[k];
    return v === null || v === undefined ? null : Number(v);
  };

  const rows: { num: number; label: string; value: string; note?: string; bold?: boolean; divider?: boolean }[] = [
    { num: 1,  label: 'FOC Value',                             value: fmtL(get('foc_value'),                  { whenMissing: '—' }), note: 'foc_value' },
    { num: 2,  label: 'Sample & Marketing Expenses',           value: fmtL(get('sample_mrkt_exp'),            { whenMissing: '—' }), note: 'sample_exp + mrkt_exp' },
    { num: 3,  label: 'No. of Patients (PAP)',                 value: fmtCount(get('pap_patients') ?? 0),     note: 'no_patient × 1000' },
    { num: 4,  label: 'No. of Patients (DCPP)',                value: fmtCount(get('dcpp_patients') ?? 0),    note: 'dc_patient × 1000' },
    { num: 5,  label: 'Camp Expenses',                         value: fmtL(get('camp_exp'),                   { whenMissing: '—' }), note: 'camp_exp' },
    { num: 6,  label: 'Total Expenses',                        value: fmtL(get('total_expenses'),             { whenMissing: '—' }), note: 'FOC + Sample+Mrkt + Camp', bold: true },
    { num: 7,  label: 'Total Secondary Sales',                 value: fmtL(get('total_secondary_sales'),      { whenMissing: '—' }), note: 'sales_valu − foc_val_n + foc_value', bold: true, divider: true },
    { num: 8,  label: 'Expenses % of Secondary Sales',         value: fmtPct(get('exp_pct_secondary'),        { whenMissing: '—' }), bold: true },
    { num: 9,  label: 'Net Secondary Sales',                   value: fmtL(get('net_secondary_sales'),        { whenMissing: '—' }), note: 'sales_valu − foc_val_n', divider: true },
    { num: 10, label: 'Expenses % of Net Secondary Sales',     value: fmtPct(get('exp_pct_net_secondary'),    { whenMissing: '—' }), bold: true },
  ];

  return (
    <div className={`space-y-5 relative transition-opacity ${isRefetching ? 'opacity-60' : ''}`}>
      {isRefetching && (
        <Loader2 className="absolute top-2 right-2 w-4 h-4 animate-spin text-[var(--text-muted)]" />
      )}

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-[var(--shadow-card)] overflow-hidden">
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
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
