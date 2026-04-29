// src/components/dashboard/PrimaryBifurcationTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { runDashboardQuery } from '@/app/reports/actions';
import { Filters } from '@/lib/schema';
import KpiCard from '@/components/KpiCard';
import ReportChart from '@/components/ReportChart';
import ReportTable from '@/components/ReportTable';
import { fmtL } from './shared';

interface Props { filters: Filters }

export default function PrimaryBifurcationTab({ filters }: Props) {
  const [kpis, setKpis] = useState<Record<string, number>>({});
  const [fyRows, setFyRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      runDashboardQuery('primaryBifurcation', filters),
      runDashboardQuery('primaryBifurcationFy', filters),
    ])
      .then(([kpiRes, fyRes]) => {
        setKpis((kpiRes[0] as Record<string, number>) ?? {});
        setFyRows(fyRes);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filters]);

  const n = (k: string) => Number(kpis[k] ?? 0);

  return (
    <div className="space-y-6">
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Sale Primary"      value={fmtL(n('sale_primary'))}      sub="Gross sales dispatched" />
        <KpiCard label="Returning Primary" value={fmtL(n('returning_primary'))} sub="GRI returns" alert={n('returning_primary') < -1000} />
        <KpiCard label="RDSI Primary"      value={fmtL(n('rdsi_primary'))}      sub="CN deduction" />
        <KpiCard label="Net Primary"       value={fmtL(n('net_primary'))}       sub="Sale − Return − RDSI" />
      </div>

      {/* Composition Note */}
      <p className="text-xs text-[var(--text-muted)]">
        Net Primary = Sale Primary + Returning Primary + RDSI Primary (returning and RDSI are negative values)
      </p>

      {/* FY stacked bar */}
      {fyRows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
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
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">FY Detail</h3>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <ReportTable rows={fyRows} />
          </div>
        </div>
      )}
    </div>
  );
}
