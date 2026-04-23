'use client';
import { useState, useEffect, useRef } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import { ChartType } from '@/reports';
import ReportTable from '@/components/ReportTable';
import ReportChart from '@/components/ReportChart';
import SqlEditor from '@/components/SqlEditor';
import ExportMenu from '@/components/ExportMenu';

interface SavedQuery {
  id: number;
  name: string;
  sql: string;
  chartType: ChartType;
  created: string;
}

export default function MyReportsPage() {
  const { query } = useDuckDb();
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [active, setActive] = useState<SavedQuery | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    const loadQueries = async () => {
      try {
        const res = await fetch('/api/blob/queries');
        const data = (await res.json()) as SavedQuery[];
        if (mounted) {
          setQueries(data);
          setFetchError(null);
        }
      } catch (e) {
        if (mounted) {
          setQueries([]);
          setFetchError(String(e));
        }
      }
    };
    // We intentionally invoke the async load logic here.
    loadQueries();
    return () => { mounted = false; };
  }, []);

  const run = async (q: SavedQuery) => {
    setActive(q);
    setRunError(null);
    try {
      const result = await query(q.sql);
      setRows(result);
    } catch (e) {
      setRunError(String(e));
      setRows([]);
    }
  };

  const del = async (id: number) => {
    const updated = queries.filter(q => q.id !== id);
    try {
      await fetch('/api/blob/queries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: updated }),
      });
      setQueries(updated);
      if (active?.id === id) { setActive(null); setRows([]); setRunError(null); }
    } catch (e) {
      console.error('Failed to delete query:', e);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
      <div className="border-b border-[var(--border)] pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">My Reports</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-2">Manage and view your saved custom reports and queries.</p>
      </div>

      {fetchError && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm font-medium border border-red-100 flex items-center gap-3">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <p>{fetchError}</p>
        </div>
      )}

      {queries.length === 0 && !fetchError && (
        <div className="text-center py-16 px-6 border-2 border-dashed border-[var(--border)] rounded-xl bg-[var(--bg-surface-raised)]/50">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)] shadow-sm mb-4 ring-1 ring-[var(--border)]">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          </div>
          <h3 className="text-sm font-medium text-[var(--text-primary)]">No saved reports</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Run a query in the Chat with Data tool and save it to see it back here.</p>
        </div>
      )}

      {queries.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {queries.map(q => (
            <div key={q.id} className="group bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--text-muted)] rounded-xl p-5 transition-all duration-200 shadow-sm hover:shadow-md flex flex-col justify-between h-40 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-gray-200 to-gray-400 dark:from-gray-700 dark:to-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              
              <div>
                <div className="flex items-start justify-between mb-2 gap-4">
                  <h3 className="font-semibold text-[var(--text-primary)] text-base truncate" title={q.name}>{q.name}</h3>
                  <div className="flex bg-[var(--bg-surface-raised)] border border-[var(--border)] p-1 rounded-md text-[var(--text-muted)]">
                    {q.chartType === 'bar' && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>}
                    {q.chartType === 'table-only' && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>}
                  </div>
                </div>
                <p className="text-[12px] text-[var(--text-muted)] font-medium tracking-wide flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  {new Date(q.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>

              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[var(--border)]">
                <button 
                  onClick={() => run(q)} 
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-md transition-colors ${active?.id === q.id ? 'bg-[var(--text-primary)] text-[var(--bg-surface)]' : 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)] hover:bg-[var(--border)]'}`}
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4l12 6-12 6z"/></svg>
                  Run Report
                </button>
                <button 
                  onClick={() => { if(confirm('Are you sure you want to delete this report?')) del(q.id) }} 
                  className="px-3 py-2 text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition-colors"
                  title="Delete report"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {runError && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm font-medium border border-red-100 flex items-start gap-3 mt-6">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <div className="flex-1 break-words overflow-hidden">{runError}</div>
        </div>
      )}

      {active && !runError && (
        <div className="mt-10 space-y-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">{active.name}</h2>
              <p className="text-xs text-[var(--text-muted)] mt-1 font-mono bg-[var(--bg-surface-raised)] px-2 py-0.5 rounded inline-block truncate max-w-md">Query: {active.sql}</p>
            </div>
            <ExportMenu rows={rows} chartRef={chartRef} filename={active.name} />
          </div>
          
          {rows.length === 0 ? (
            <div className="py-12 text-center text-[var(--text-muted)]">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
              <p className="text-sm font-medium">No data returned for this query segment.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <ReportTable rows={rows} />
              <div ref={chartRef} className="bg-[var(--bg-surface)] p-2 rounded-xl">
                <ReportChart rows={rows} chartType={active.chartType} />
              </div>
            </div>
          )}
          <SqlEditor
            sql={active.sql}
            onRun={async (sql) => {
              setRunError(null);
              try { setRows(await query(sql)); } catch (e) { setRunError(String(e)); }
            }}
          />
        </div>
      )}
    </div>
  );
}
