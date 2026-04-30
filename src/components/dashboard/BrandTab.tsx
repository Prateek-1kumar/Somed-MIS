// src/components/dashboard/BrandTab.tsx
'use client';
import { useState } from 'react';
import { Loader2, Inbox } from 'lucide-react';
import { runDashboardQuery } from '@/app/reports/actions';
import { Filters } from '@/lib/schema';
import ReportChart from '@/components/ReportChart';
import ReportTable from '@/components/ReportTable';
import { useDataFetch } from '@/lib/hooks/useDataFetch';
import { ChartSkeleton, TableSkeleton } from '@/components/ui/skeletons';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { EmptyState } from '@/components/ui/EmptyState';

interface Props { filters: Filters }

type Metric = 'primary' | 'secondary' | 'foc' | 'net_secondary';
type Mode = 'value' | 'qty';

const METRIC_LABELS: Record<Metric, string> = {
  primary: 'Primary', secondary: 'Secondary', foc: 'FOC', net_secondary: 'Net Secondary',
};

const VALUE_KEYS: Record<Metric, string> = {
  primary: 'primary_value', secondary: 'secondary_value', foc: 'foc_value', net_secondary: 'net_secondary_value',
};

const QTY_KEYS: Record<Metric, string> = {
  primary: 'primary_qty', secondary: 'secondary_qty', foc: 'foc_qty', net_secondary: 'primary_qty',
};

const ToggleSkeletonRow = () => (
  <div className="flex flex-wrap gap-4">
    <div className="flex gap-1.5">
      {[0,1,2,3].map(i => <div key={i} className="w-20 h-7 rounded-lg bg-[var(--bg-surface-raised)] animate-pulse" />)}
    </div>
    <div className="flex gap-1.5">
      {[0,1].map(i => <div key={i} className="w-16 h-7 rounded-lg bg-[var(--bg-surface-raised)] animate-pulse" />)}
    </div>
  </div>
);

export default function BrandTab({ filters }: Props) {
  const [metric, setMetric] = useState<Metric>('primary');
  const [mode, setMode] = useState<Mode>('value');

  const { data: rows, isFirstLoad, isRefetching, error } = useDataFetch(
    () => runDashboardQuery('brand', filters),
    [JSON.stringify(filters)],
  );

  if (error) return <ErrorBanner error={error} />;
  if (isFirstLoad || !rows) {
    return (
      <div className="space-y-5">
        <ToggleSkeletonRow />
        <ChartSkeleton />
        <TableSkeleton />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="w-5 h-5" />}
        title="No data for this filter combination"
        description="Try removing a filter or selecting a different financial year."
      />
    );
  }

  const activeKey = mode === 'value' ? VALUE_KEYS[metric] : QTY_KEYS[metric];
  const top15 = [...rows].sort((a, b) => Number(b[activeKey] ?? 0) - Number(a[activeKey] ?? 0)).slice(0, 15);

  const btnBase = 'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border';
  const btnActive = 'bg-[var(--accent)] text-white border-[var(--accent)]';
  const btnInactive = 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-surface-raised)]';

  return (
    <div className={`space-y-5 relative transition-opacity ${isRefetching ? 'opacity-60' : ''}`}>
      {isRefetching && (
        <Loader2 className="absolute top-2 right-2 w-4 h-4 animate-spin text-[var(--text-muted)]" />
      )}

      {/* Toggles */}
      <div className="flex flex-wrap gap-4">
        <div className="flex gap-1.5">
          {(['primary','secondary','foc','net_secondary'] as Metric[]).map(m => (
            <button key={m} onClick={() => setMetric(m)} className={`${btnBase} ${metric === m ? btnActive : btnInactive}`}>
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(['value','qty'] as Mode[]).map(mo => (
            <button key={mo} onClick={() => setMode(mo)} className={`${btnBase} ${mode === mo ? btnActive : btnInactive}`}>
              {mo === 'value' ? 'Value' : 'Quantity'}
            </button>
          ))}
        </div>
      </div>

      {/* Top 15 Chart */}
      {top15.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[var(--shadow-card)]">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            Top 15 Brands — {METRIC_LABELS[metric]} ({mode === 'value' ? '₹' : 'Qty'})
          </h3>
          <ReportChart rows={top15} chartType="bar" xKey="item_name" valueKeys={[activeKey]} />
        </div>
      )}

      {/* Full Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[var(--shadow-card)]">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">All Brands</h3>
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <ReportTable rows={rows} />
        </div>
      </div>
    </div>
  );
}
