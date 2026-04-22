'use client';
import { useState, useEffect } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import KpiCard from '@/components/KpiCard';
import ReportChart from '@/components/ReportChart';

const FYS = ['2022-2023','2023-2024','2024-2025','2025-2026','2026-2027'];

function fmt(n: number): string {
  if (n >= 100000) return `₹${(n/100000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function Home() {
  const { ready, query } = useDuckDb();
  const [fy, setFy] = useState('2025-2026');
  const [kpis, setKpis] = useState<Record<string, number>>({});
  const [hqRows, setHqRows] = useState<Record<string, unknown>[]>([]);
  const [segRows, setSegRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    setError(null);
    Promise.all([
      query(`SELECT SUM(net_sales_) AS net_primary, SUM(tgt_val_p) AS target, ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) AS ach_pct, SUM(coll) AS collection, SUM(sales_valu)-SUM(foc_val_n) AS secondary_net, SUM(closing_va) AS closing_value, SUM(foc_value) AS foc_value FROM data WHERE fy='${fy}'`),
      query(`SELECT hq_new, ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) AS ach_pct, SUM(net_sales_) AS net_primary FROM data WHERE fy='${fy}' GROUP BY hq_new ORDER BY ach_pct ASC NULLS LAST`),
      query(`SELECT seg, SUM(net_sales_) AS net_primary FROM data WHERE fy='${fy}' GROUP BY seg ORDER BY net_primary DESC`),
    ]).then(([kpiRes, hqRes, segRes]) => {
      setKpis((kpiRes[0] as Record<string, number>) ?? {});
      setHqRows(hqRes);
      setSegRows(segRes);
    }).catch(e => setError(String(e)));
  }, [ready, fy]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-800">Shomed Remedies MIS</h1>
        <select value={fy} onChange={e => setFy(e.target.value)}
          className="border border-zinc-300 rounded px-3 py-1.5 text-sm">
          {FYS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {!ready && <p className="text-zinc-400 text-sm mb-4">Initialising DuckDB…</p>}
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Net Primary" value={fmt(Number(kpis.net_primary ?? 0))} />
        <KpiCard label="Target" value={fmt(Number(kpis.target ?? 0))} />
        <KpiCard label="Achievement" value={`${kpis.ach_pct ?? 0}%`} alert={Number(kpis.ach_pct ?? 0) < 80} />
        <KpiCard label="Collection" value={fmt(Number(kpis.collection ?? 0))} />
        <KpiCard label="Secondary Net" value={fmt(Number(kpis.secondary_net ?? 0))} />
        <KpiCard label="Closing Stock" value={fmt(Number(kpis.closing_value ?? 0))} />
        <KpiCard label="FOC Value" value={fmt(Number(kpis.foc_value ?? 0))} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">HQ Achievement %</h2>
          <ReportChart rows={hqRows} chartType="bar" xKey="hq_new" valueKeys={['ach_pct']} />
        </div>
        <div className="bg-white rounded-lg border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">Segment Mix</h2>
          <ReportChart rows={segRows} chartType="pie" xKey="seg" valueKeys={['net_primary']} />
        </div>
      </div>
    </div>
  );
}
