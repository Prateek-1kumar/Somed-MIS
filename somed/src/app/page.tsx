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

const selectStyle: React.CSSProperties = {
  padding: '5px 28px 5px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
  border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)',
  cursor: 'pointer', outline: 'none',
};

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>Shomed Remedies MIS</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Executive Dashboard</p>
        </div>
        <select value={fy} onChange={e => setFy(e.target.value)} style={selectStyle}>
          {FYS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {!ready && <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>Initialising DuckDB…</p>}
      {error && <p style={{ fontSize: '13px', color: 'var(--danger)', marginBottom: '16px' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <KpiCard label="Net Primary" value={fmt(Number(kpis.net_primary ?? 0))} />
        <KpiCard label="Target" value={fmt(Number(kpis.target ?? 0))} />
        <KpiCard label="Achievement" value={`${kpis.ach_pct ?? 0}%`} alert={Number(kpis.ach_pct ?? 0) < 80} />
        <KpiCard label="Collection" value={fmt(Number(kpis.collection ?? 0))} />
        <KpiCard label="Secondary Net" value={fmt(Number(kpis.secondary_net ?? 0))} />
        <KpiCard label="Closing Stock" value={fmt(Number(kpis.closing_value ?? 0))} />
        <KpiCard label="FOC Value" value={fmt(Number(kpis.foc_value ?? 0))} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
        <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '10px', border: '1px solid var(--border)', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>HQ Achievement %</h2>
          <ReportChart rows={hqRows} chartType="bar" xKey="hq_new" valueKeys={['ach_pct']} />
        </div>
        <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '10px', border: '1px solid var(--border)', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Segment Mix</h2>
          <ReportChart rows={segRows} chartType="pie" xKey="seg" valueKeys={['net_primary']} />
        </div>
      </div>
    </div>
  );
}
