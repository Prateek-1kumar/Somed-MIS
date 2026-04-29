// src/components/dashboard/SegmentTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { runDashboardQuery } from '@/app/reports/actions';
import { Filters } from '@/lib/schema';
import ReportChart from '@/components/ReportChart';
import ReportTable from '@/components/ReportTable';

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
  primary: 'primary_qty', secondary: 'secondary_qty', foc: 'foc_qty', net_secondary: 'secondary_qty',
};

export default function SegmentTab({ filters }: Props) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('primary');
  const [mode, setMode] = useState<Mode>('value');

  useEffect(() => {
    setLoading(true);
    setError(null);
    runDashboardQuery('segment', filters)
      .then(setRows)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filters]);

  const activeKey = mode === 'value' ? VALUE_KEYS[metric] : QTY_KEYS[metric];
  const btnBase = 'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border';
  const btnActive = 'bg-[var(--text-primary)] text-[var(--bg-surface)] border-[var(--text-primary)]';
  const btnInactive = 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-surface-raised)]';

  return (
    <div className="space-y-5">
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

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

      {/* Pie chart for segment share */}
      {rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
              Segment Share — {METRIC_LABELS[metric]} {mode === 'value' ? '(₹)' : '(Qty)'}
            </h3>
            <ReportChart rows={rows} chartType="pie" xKey="seg" valueKeys={[activeKey]} />
          </div>
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
              Segment Comparison
            </h3>
            <ReportChart rows={rows} chartType="bar" xKey="seg" valueKeys={[activeKey]} />
          </div>
        </div>
      )}

      {/* Full Table */}
      {rows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">Segment Detail</h3>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <ReportTable rows={rows} />
          </div>
        </div>
      )}
    </div>
  );
}
