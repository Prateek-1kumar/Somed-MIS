'use client';
import { useParams } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { getReport } from '@/reports';
import { Filters, renderSqlWithParams } from '@/lib/schema';
import { saveResult, loadResult, getDataVersion } from '@/lib/persistence';
import { fetchOverrides, saveOverride, deleteOverride } from '@/lib/overrides';
import { runReport, runRawSql } from '@/app/reports/actions';
import FilterBar from '@/components/FilterBar';
import ReportTable from '@/components/ReportTable';
import ReportChart from '@/components/ReportChart';
import SqlEditor from '@/components/SqlEditor';
import RefineWithAi from '@/components/RefineWithAi';
import StaleBanner from '@/components/StaleBanner';
import ExportMenu from '@/components/ExportMenu';

export default function ReportPage() {
  const params = useParams();
  const reportId = typeof params?.reportId === 'string' ? params.reportId : (params?.reportId?.[0] ?? '');
  const report = reportId ? getReport(reportId) : null;

  const [filters, setFilters] = useState<Filters>({ fy: '2025-2026' });
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [currentSql, setCurrentSql] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'table' | 'chart'>('table');
  const [overrideSql, setOverrideSql] = useState<string | null>(null);
  const [overridesLoaded, setOverridesLoaded] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; });

  // Inlines the parameterized factory output for display in the editor —
  // override SQL is already a free-form string.
  const displaySqlForFilters = (f: Filters): string => {
    if (!report) return '';
    if (overrideSql) return overrideSql;
    const q = report.sqlFactory(f);
    return renderSqlWithParams(q.text, q.params);
  };

  const runWithFilters = async (f: Filters) => {
    if (!report) return;
    setLoading(true);
    setError(null);
    try {
      const result = overrideSql
        ? await runRawSql(overrideSql)
        : await runReport(report.id, f);
      setRows(result);
      const display = overrideSql ?? renderSqlWithParams(
        report.sqlFactory(f).text,
        report.sqlFactory(f).params,
      );
      setCurrentSql(display);
      const now = new Date().toLocaleString('en-IN');
      setLastRun(now);
      setStale(false);
      await saveResult({
        key: report.id,
        rows: result,
        sql: display,
        filters: f as Record<string, string>,
        chartType: report.chartType,
        lastRun: now,
        dataVersion: getDataVersion(),
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const runCustomSql = async (sqlText: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await runRawSql(sqlText);
      setRows(result);
      setCurrentSql(sqlText);
      const now = new Date().toLocaleString('en-IN');
      setLastRun(now);
      setStale(false);
      if (report) {
        await saveResult({
          key: report.id,
          rows: result,
          sql: sqlText,
          filters: filters as Record<string, string>,
          chartType: report.chartType,
          lastRun: now,
          dataVersion: getDataVersion(),
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!report) return;
    let cancelled = false;
    Promise.all([loadResult(reportId), fetchOverrides()]).then(([cached, overrides]) => {
      if (cancelled) return;
      const override = overrides[reportId]?.sql ?? null;
      setOverrideSql(override);
      setOverridesLoaded(true);
      if (cached) {
        setRows(cached.rows);
        setCurrentSql(cached.sql);
        setLastRun(cached.lastRun);
        setStale(cached.dataVersion !== getDataVersion());
      } else if (override) {
        runCustomSql(override);
      } else {
        runWithFilters(filtersRef.current);
      }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const handleSaveOverride = async (sqlText: string) => {
    await saveOverride(reportId, sqlText);
    setOverrideSql(sqlText);
    await runCustomSql(sqlText);
  };

  const handleResetOverride = async () => {
    await deleteOverride(reportId);
    setOverrideSql(null);
    await runWithFilters(filters);
  };

  const handleRefineApply = async (sqlText: string) => {
    await runCustomSql(sqlText);
  };

  if (!report) return <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Report not found</p>;

  const saveQuery = async (sqlText: string) => {
    const name = prompt('Name this report:');
    if (!name) return;
    try {
      const res = await fetch('/api/blob/queries');
      const existing = (await res.json()) as unknown[];
      const updated = [...existing, { id: Date.now(), name, sql: sqlText, chartType: report.chartType, created: new Date().toISOString() }];
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
          <button onClick={() => runWithFilters(filters)} style={{
            padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            border: 'none', backgroundColor: 'var(--accent)', color: 'white',
          }}>
            ↺ Refresh
          </button>
          <ExportMenu rows={rows} chartRef={chartRef} filename={report.id} />
        </div>
      </div>

      {stale && <StaleBanner onRefresh={() => runWithFilters(filters)} onRefreshAll={() => runWithFilters(filters)} />}

      {error && <p style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--danger)' }}>{error}</p>}

      <FilterBar filters={filters} onChange={f => { setFilters(f); runWithFilters(f); }} />

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

      {overridesLoaded && currentSql && (
        <RefineWithAi
          currentSql={currentSql}
          reportTitle={report.name}
          onApply={handleRefineApply}
        />
      )}

      <SqlEditor
        sql={currentSql}
        onRun={runCustomSql}
        onReset={() => {
          const display = displaySqlForFilters(filters);
          setCurrentSql(display);
          runWithFilters(filters);
        }}
        onSave={saveQuery}
        onSaveOverride={handleSaveOverride}
        onResetOverride={handleResetOverride}
        isOverridden={!!overrideSql}
        powerBiMode
      />
    </div>
  );
}
