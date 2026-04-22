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
    loadResult(reportId).then(cached => {
      if (cached) {
        setRows(cached.rows);
        setCurrentSql(cached.sql);
        setLastRun(cached.lastRun);
        setStale(cached.dataVersion !== getDataVersion());
      } else {
        const sql = buildSql(filters);
        setCurrentSql(sql);
        runQuery(sql);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, ready]);

  if (!report) return <p className="text-zinc-500">Report not found</p>;

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
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-800">{report.name}</h1>
          {lastRun && <p className="text-xs text-zinc-400">Last run: {lastRun}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => runQuery(buildSql(filters))}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            ↺ Refresh
          </button>
          <ExportMenu rows={rows} chartRef={chartRef} filename={report.id} />
        </div>
      </div>

      {stale && <StaleBanner onRefresh={() => runQuery(buildSql(filters))} onRefreshAll={() => runQuery(buildSql(filters))} />}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <FilterBar filters={filters} onChange={f => { setFilters(f); runQuery(buildSql(f)); }} />

      <div className="flex gap-2 mb-3">
        {(['table', 'chart'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-3 py-1 text-sm rounded ${activeTab === t ? 'bg-blue-100 text-blue-700 font-medium' : 'text-zinc-500 hover:bg-zinc-100'}`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-zinc-400 mb-2">Running…</p>}

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
