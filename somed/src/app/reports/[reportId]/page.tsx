'use client';
import { useParams } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { getReport } from '@/reports';
import { useDuckDb } from '@/lib/DuckDbContext';
import { Filters } from '@/lib/schema';
import { saveResult, loadResult, getDataVersion } from '@/lib/persistence';
import FilterBar from '@/components/FilterBar';
import ReportTable from '@/components/ReportTable';
import ReportChart from '@/components/ReportChart';
import SqlEditor from '@/components/SqlEditor';
import StaleBanner from '@/components/StaleBanner';
import ExportMenu from '@/components/ExportMenu';

export default function ReportPage() {
  const params = useParams();
  const reportId = typeof params?.reportId === 'string' ? params.reportId : (params?.reportId?.[0] ?? '');
  const report = reportId ? getReport(reportId) : null;
  const { ready, query } = useDuckDb();

  const [filters, setFilters] = useState<Filters>({ fy: '2025-2026' });
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [currentSql, setCurrentSql] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'table' | 'chart'>('table');
  const chartRef = useRef<HTMLDivElement>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const buildSql = (f: Filters) => report?.sqlFactory(f) ?? '';

  const runQuery = async (sql: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await query(sql);
      setRows(result);
      setCurrentSql(sql);
      const now = new Date().toLocaleString('en-IN');
      setLastRun(now);
      setStale(false);
      await saveResult({
        key: reportId,
        rows: result,
        sql,
        filters: filters as Record<string, string>,
        chartType: report?.chartType ?? 'bar',
        lastRun: now,
        dataVersion: getDataVersion(),
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!report || !ready) return;
    let cancelled = false;
    loadResult(reportId).then(cached => {
      if (cancelled) return;
      if (cached) {
        setRows(cached.rows);
        setCurrentSql(cached.sql);
        setLastRun(cached.lastRun);
        setStale(cached.dataVersion !== getDataVersion());
      } else {
        const sql = buildSql(filtersRef.current);
        setCurrentSql(sql);
        runQuery(sql);
      }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, ready]);

  if (!report) return <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Report not found</p>;

  const saveQuery = async (sql: string) => {
    const name = prompt('Name this report:');
    if (!name) return;
    try {
      const res = await fetch('/api/blob/queries');
      const existing = (await res.json()) as unknown[];
      const updated = [...existing, { id: Date.now(), name, sql, chartType: report.chartType, created: new Date().toISOString() }];
      await fetch('/api/blob/queries', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queries: updated }) });
    } catch (e) {
      console.error('Failed to save query:', e);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>{report.name}</h1>
          {lastRun && <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Last run: {lastRun}</p>}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={() => runQuery(buildSql(filters))} style={{
            padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            border: 'none', backgroundColor: 'var(--accent)', color: 'white',
          }}>
            ↺ Refresh
          </button>
          <ExportMenu rows={rows} chartRef={chartRef} filename={report.id} />
        </div>
      </div>

      {stale && <StaleBanner onRefresh={() => runQuery(buildSql(filters))} onRefreshAll={() => runQuery(buildSql(filters))} />}

      {error && <p style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--danger)' }}>{error}</p>}

      <FilterBar filters={filters} onChange={f => { setFilters(f); runQuery(buildSql(f)); }} />

      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        {(['table', 'chart'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            padding: '5px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: activeTab === t ? 600 : 400, cursor: 'pointer',
            border: activeTab === t ? 'none' : '1px solid var(--border)',
            backgroundColor: activeTab === t ? 'var(--accent-light)' : 'transparent',
            color: activeTab === t ? 'var(--accent)' : 'var(--text-secondary)',
          }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading && <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>Running…</p>}

      {activeTab === 'table' && <ReportTable rows={rows} />}
      {activeTab === 'chart' && (
        <div ref={chartRef}>
          <ReportChart rows={rows} chartType={report.chartType} />
        </div>
      )}

      <SqlEditor
        sql={currentSql}
        onRun={runQuery}
        onReset={() => { const sql = buildSql(filters); setCurrentSql(sql); runQuery(sql); }}
        onSave={saveQuery}
        powerBiMode
      />
    </div>
  );
}
