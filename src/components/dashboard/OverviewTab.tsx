// src/components/dashboard/OverviewTab.tsx
'use client';
import { Loader2, Inbox } from 'lucide-react';
import { runDashboardQuery } from '@/app/reports/actions';
import { Filters } from '@/lib/schema';
import KpiCard from '@/components/KpiCard';
import ReportChart from '@/components/ReportChart';
import ReportTable from '@/components/ReportTable';
import { useDataFetch } from '@/lib/hooks/useDataFetch';
import { OverviewSkeleton } from '@/components/ui/skeletons';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtL, fmtPct, fmtQty } from './shared';

interface Props { filters: Filters }

interface OverviewData {
  kpis: Record<string, number | null>;
  fyRows: Record<string, unknown>[];
}

export default function OverviewTab({ filters }: Props) {
  const { data, isFirstLoad, isRefetching, error } = useDataFetch<OverviewData>(
    () => Promise.all([
      runDashboardQuery('overviewKpis', filters),
      runDashboardQuery('overviewFy', filters),
    ]).then(([kpiRes, fyRes]) => ({
      kpis: (kpiRes[0] as Record<string, number | null>) ?? {},
      fyRows: fyRes,
    })),
    [JSON.stringify(filters)],
  );

  if (error) return <ErrorBanner error={error} />;
  if (isFirstLoad || !data) return <OverviewSkeleton />;

  const { kpis, fyRows } = data;
  const get = (k: string): number | null => {
    const v = kpis[k];
    return v === null || v === undefined ? null : Number(v);
  };

  const primaryAch = get('primary_ach_pct');
  const secondaryAch = get('secondary_ach_pct');

  if (fyRows.length === 0 && Object.keys(kpis).length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="w-5 h-5" />}
        title="No data for this filter combination"
        description="Try removing a filter or selecting a different financial year."
      />
    );
  }

  return (
    <div className={`space-y-6 relative transition-opacity ${isRefetching ? 'opacity-60' : ''}`}>
      {isRefetching && (
        <Loader2 className="absolute top-2 right-2 w-4 h-4 animate-spin text-[var(--text-muted)]" />
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          label="Primary Sales"
          value={fmtL(get('primary_sales'), { whenMissing: '—' })}
          sub={`Target: ${fmtL(get('primary_target'), { whenMissing: '—' })}`}
        />
        <KpiCard
          label="Primary Ach%"
          value={fmtPct(primaryAch, { whenMissing: '—' })}
          alert={primaryAch !== null && primaryAch < 80}
        />
        <KpiCard
          label="Secondary Sales"
          value={fmtL(get('secondary_sales'), { whenMissing: '—' })}
          sub={`Target: ${fmtL(get('secondary_target'), { whenMissing: '—' })}`}
        />
        <KpiCard
          label="Secondary Ach%"
          value={fmtPct(secondaryAch, { whenMissing: '—' })}
          alert={secondaryAch !== null && secondaryAch < 80}
        />
        <KpiCard
          label="FOC Value"
          value={fmtL(get('foc_value'), { whenMissing: '—' })}
          sub={`Qty: ${fmtQty(get('foc_qty'), { whenMissing: '—' })}`}
        />
        <KpiCard
          label="Net Secondary"
          value={fmtL(get('net_secondary'), { whenMissing: '—' })}
        />
      </div>

      {/* FY Breakdown Chart */}
      {fyRows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[var(--shadow-card)]">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            FY-Wise Sales Trend
          </h3>
          <p className="text-[11px] text-[var(--text-muted)] mb-4">All financial years — hierarchy filters applied</p>
          <ReportChart
            rows={fyRows}
            chartType="bar"
            xKey="fy"
            valueKeys={['primary_sales', 'secondary_sales', 'net_secondary', 'foc_value']}
          />
        </div>
      )}

      {/* FY Achievement % chart */}
      {fyRows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[var(--shadow-card)]">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            FY-Wise Achievement %
          </h3>
          <ReportChart
            rows={fyRows}
            chartType="line"
            xKey="fy"
            valueKeys={['primary_ach_pct', 'secondary_ach_pct']}
          />
        </div>
      )}

      {/* FY Detail Table */}
      {fyRows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[var(--shadow-card)]">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">
            FY Detail Table
          </h3>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <ReportTable rows={fyRows} />
          </div>
        </div>
      )}
    </div>
  );
}
