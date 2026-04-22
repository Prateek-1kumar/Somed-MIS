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

  const fetchQueries = async () => {
    try {
      const res = await fetch('/api/blob/queries');
      const data = (await res.json()) as SavedQuery[];
      setQueries(data);
      setFetchError(null);
    } catch (e) {
      setQueries([]);
      setFetchError(String(e));
    }
  };

  useEffect(() => { fetchQueries(); }, []);

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
    <div>
      <h1 className="text-xl font-semibold text-zinc-800 mb-6">My Reports</h1>
      {fetchError && <p className="mb-3 text-sm text-red-600">{fetchError}</p>}
      {queries.length === 0 && !fetchError && (
        <p className="text-sm text-zinc-400">No saved reports yet. Run a query in Chat and save it.</p>
      )}
      <div className="space-y-3 mb-6">
        {queries.map(q => (
          <div key={q.id} className="bg-white border border-zinc-200 rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-zinc-800 text-sm">{q.name}</p>
              <p className="text-xs text-zinc-400">{new Date(q.created).toLocaleDateString('en-IN')}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => run(q)} className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Run</button>
              <button onClick={() => del(q.id)} className="px-3 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50">Delete</button>
            </div>
          </div>
        ))}
      </div>
      {runError && <p className="mb-3 text-sm text-red-600">{runError}</p>}
      {active && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">{active.name}</h2>
            <ExportMenu rows={rows} chartRef={chartRef} filename={active.name} />
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-zinc-400">No rows returned.</p>
          ) : (
            <>
              <ReportTable rows={rows} />
              <div ref={chartRef}>
                <ReportChart rows={rows} chartType={active.chartType} />
              </div>
            </>
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
