// src/components/dashboard/OverviewTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import { Filters } from '@/lib/schema';
import { dashOverviewKpis, dashOverviewFy } from '@/reports/dashboard';
import KpiCard from '@/components/KpiCard';
import ReportChart from '@/components/ReportChart';
import ReportTable from '@/components/ReportTable';
import { fmtL, fmtPct, fmtQty } from './shared';

interface Props { filters: Filters }

export default function OverviewTab({ filters }: Props) {
  const { query } = useDuckDb();
  const [kpis, setKpis] = useState<Record<string, number>>({});
  const [fyRows, setFyRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([query(dashOverviewKpis(filters)), query(dashOverviewFy(filters))])
      .then(([kpiRes, fyRes]) => {
        setKpis((kpiRes[0] as Record<string, number>) ?? {});
        setFyRows(fyRes);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filters, query]);

  const n = (k: string) => Number(kpis[k] ?? 0);

  return (
    <div className="space-y-6">
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="Primary Sales"    value={fmtL(n('primary_sales'))}    sub={`Target: ${fmtL(n('primary_target'))}`} />
        <KpiCard label="Primary Ach%"     value={fmtPct(n('primary_ach_pct'))} alert={n('primary_ach_pct') < 80} />
        <KpiCard label="Secondary Sales"  value={fmtL(n('secondary_sales'))}  sub={`Target: ${fmtL(n('secondary_target'))}`} />
        <KpiCard label="Secondary Ach%"   value={fmtPct(n('secondary_ach_pct'))} alert={n('secondary_ach_pct') < 80} />
        <KpiCard label="FOC Value"        value={fmtL(n('foc_value'))}        sub={`Qty: ${fmtQty(n('foc_qty'))}`} />
        <KpiCard label="Net Secondary"    value={fmtL(n('net_secondary'))} />
      </div>

      {/* FY Breakdown Chart */}
      {fyRows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
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
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
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
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
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
