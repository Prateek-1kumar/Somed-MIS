// src/components/dashboard/ReturningTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { runDashboardQuery } from '@/app/reports/actions';
import { Filters } from '@/lib/schema';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import KpiCard from '@/components/KpiCard';
import { fmtL, fmtLakhs } from './shared';

interface Props { filters: Filters }

const SLICE_COLORS = ['#f43f5e', '#f59e0b', '#8b5cf6', '#0ea5e9', '#10b981'];

export default function ReturningTab({ filters }: Props) {
  const [data, setData] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    runDashboardQuery('returning', filters)
      .then(rows => setData((rows[0] as Record<string, number>) ?? {}))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filters]);

  const n = (k: string) => Number(data[k] ?? 0);
  const abs = (k: string) => Math.abs(n(k));

  const total = abs('total_returning');

  const slices = [
    { name: 'Expired',        key: 'expired_returning', color: SLICE_COLORS[0] },
    { name: 'Near 3 Months',  key: 'near_3m',           color: SLICE_COLORS[1] },
    { name: 'Near 6 Months',  key: 'near_6m',           color: SLICE_COLORS[2] },
    { name: 'Near 9 Months',  key: 'near_9m',           color: SLICE_COLORS[3] },
    { name: 'Long Expiry (>9m)', key: 'above_9m',        color: SLICE_COLORS[4] },
  ];

  const pieData = slices.map(s => ({
    name: s.name,
    value: abs(s.key),
    color: s.color,
  })).filter(d => d.value > 0);

  const pct = (k: string) => total > 0 ? ((abs(k) / total) * 100).toFixed(1) : '0.0';

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { name: string; value: number }[] }) => {
    if (!active || !payload?.length) return null;
    const item = payload[0];
    return (
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-3 shadow-md text-sm">
        <p className="font-semibold text-[var(--text-primary)] mb-1">{item.name}</p>
        <p className="text-[var(--text-secondary)]">{fmtLakhs(item.value)}</p>
        <p className="text-[var(--text-muted)] text-xs">{((item.value / total) * 100).toFixed(1)}% of total</p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard label="Total Returning (GRI)" value={fmtL(abs('total_returning'))} sub="return_amt" alert />
        <KpiCard label="Credit Notes"          value={fmtL(n('credit_notes'))}       sub="cn_value — issued vs free goods" />
      </div>

      {/* Pie + Breakdown Table */}
      {total > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Pie Chart */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
              Return Breakdown by Expiry
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] mb-2">Values in ₹ Lakhs, % of total GRI return</p>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} className="stroke-[var(--bg-surface)] stroke-2" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: '12px', color: 'var(--text-secondary)', paddingTop: '12px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Breakdown Table */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-sm overflow-hidden self-start">
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Expiry Breakdown</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-surface-raised)]">
                  <th className="px-5 py-2.5 text-left text-xs font-semibold text-[var(--text-muted)]">Category</th>
                  <th className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--text-muted)]">Value (₹L)</th>
                  <th className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--text-muted)]">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {slices.map(s => (
                  <tr key={s.key} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-surface-raised)] transition-colors">
                    <td className="px-5 py-3 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="text-[var(--text-primary)]">{s.name}</span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                      {fmtLakhs(abs(s.key))}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-[var(--text-primary)]">
                      {pct(s.key)}%
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[var(--border-strong)] bg-[var(--bg-surface-raised)]">
                  <td className="px-5 py-3 font-bold text-[var(--text-primary)]">Total GRI Return</td>
                  <td className="px-5 py-3 text-right tabular-nums font-bold text-[var(--text-primary)]">{fmtLakhs(total)}</td>
                  <td className="px-5 py-3 text-right font-bold text-[var(--text-primary)]">100%</td>
                </tr>
              </tbody>
            </table>

            {/* Credit notes row */}
            <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg-surface-raised)]/50">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-muted)]">Credit Notes (issued vs free goods)</span>
                <span className="font-semibold text-[var(--text-primary)]">{fmtLakhs(n('credit_notes'))}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
