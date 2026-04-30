// src/components/dashboard/PrimaryBifurcationTab.tsx
'use client';
import { Loader2, Inbox } from 'lucide-react';
import { runDashboardQuery } from '@/app/reports/actions';
import { Filters } from '@/lib/schema';
import KpiCard from '@/components/KpiCard';
import ReportChart from '@/components/ReportChart';
import ReportTable from '@/components/ReportTable';
import { useDataFetch } from '@/lib/hooks/useDataFetch';
import { KpiCardSkeleton, ChartSkeleton, TableSkeleton } from '@/components/ui/skeletons';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtL } from './shared';

interface Props { filters: Filters }

interface PrimaryData {
  kpis: Record<string, number | null>;
  fyRows: Record<string, unknown>[];
}

export default function PrimaryBifurcationTab({ filters }: Props) {
  const { data, isFirstLoad, isRefetching, error } = useDataFetch<PrimaryData>(
    () => Promise.all([
      runDashboardQuery('primaryBifurcation', filters),
      runDashboardQuery('primaryBifurcationFy', filters),
    ]).then(([kpiRes, fyRes]) => ({
      kpis: (kpiRes[0] as Record<string, number | null>) ?? {},
      fyRows: fyRes,
    })),
    [JSON.stringify(filters)],
  );

  if (error) return <ErrorBanner error={error} />;
  if (isFirstLoad || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)}
        </div>
        <ChartSkeleton />
        <TableSkeleton />
      </div>
    );
  }

  const { kpis, fyRows } = data;
  const get = (k: string): number | null => {
    const v = kpis[k];
    return v === null || v === undefined ? null : Number(v);
  };

  if (fyRows.length === 0 && Object.keys(kpis).length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="w-5 h-5" />}
        title="No data for this filter combination"
        description="Try removing a filter or selecting a different financial year."
      />
    );
  }

  const returningPrimary = get('returning_primary');

  return (
    <div className={`space-y-6 relative transition-opacity ${isRefetching ? 'opacity-60' : ''}`}>
      {isRefetching && (
        <Loader2 className="absolute top-2 right-2 w-4 h-4 animate-spin text-[var(--text-muted)]" />
      )}

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Sale Primary"      value={fmtL(get('sale_primary'),      { whenMissing: '—' })} sub="Gross sales dispatched" />
        <KpiCard
          label="Returning Primary"
          value={fmtL(returningPrimary, { whenMissing: '—' })}
          sub="GRI returns"
          alert={returningPrimary !== null && returningPrimary < -1000}
        />
        <KpiCard label="RDSI Primary"      value={fmtL(get('rdsi_primary'),      { whenMissing: '—' })} sub="CN deduction" />
        <KpiCard label="Net Primary"       value={fmtL(get('net_primary'),       { whenMissing: '—' })} sub="Sale − Return − RDSI" />
      </div>

      {/* Composition Note */}
      <p className="text-xs text-[var(--text-muted)]">
        Net Primary = Sale Primary + Returning Primary + RDSI Primary (returning and RDSI are negative values)
      </p>

      {/* FY stacked bar */}
      {fyRows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[var(--shadow-card)]">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            Primary Bifurcation — FY Trend
          </h3>
          <ReportChart
            rows={fyRows}
            chartType="stacked-bar"
            xKey="fy"
            valueKeys={['sale_primary', 'returning_primary', 'rdsi_primary']}
          />
        </div>
      )}

      {fyRows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[var(--shadow-card)]">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">FY Detail</h3>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <ReportTable rows={fyRows} />
          </div>
        </div>
      )}
    </div>
  );
}
