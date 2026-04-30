'use client';
import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Loader2, FolderKanban, Play, Trash2, Calendar } from 'lucide-react';
import { runRawSql } from '@/app/reports/actions';
import { ChartType } from '@/reports';
import ReportTable from '@/components/ReportTable';
import ReportChart from '@/components/ReportChart';
import SqlEditor from '@/components/SqlEditor';
import ExportMenu from '@/components/ExportMenu';
import { useDataFetch } from '@/lib/hooks/useDataFetch';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';

interface SavedQuery {
  id: number;
  name: string;
  sql: string;
  chartType: ChartType;
  created: string;
}

function ReportCardSkeleton() {
  return (
    <div className="rounded-xl border bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)] space-y-3 h-40 flex flex-col justify-between">
      <div className="space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="flex items-center gap-2 pt-3 border-t border-[var(--border)]">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 w-8" />
      </div>
    </div>
  );
}

export default function MyReportsPage() {
  const [active, setActive] = useState<SavedQuery | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const chartRef = useRef<HTMLDivElement>(null);

  const bumpVersion = useCallback(() => setVersion(v => v + 1), []);

  const { data: queries, isFirstLoad, isRefetching, error: fetchError } = useDataFetch<SavedQuery[]>(
    () =>
      fetch('/api/blob/queries').then(async r => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        const json = (await r.json()) as SavedQuery[];
        return Array.isArray(json) ? json : [];
      }),
    [`saved-queries-${version}`],
  );

  const run = async (q: SavedQuery) => {
    setActive(q);
    setRunError(null);
    try {
      const result = await runRawSql(q.sql);
      setRows(result);
    } catch (e) {
      setRunError(String(e));
      setRows([]);
    }
  };

  const del = async (id: number) => {
    if (!queries) return;
    const updated = queries.filter(q => q.id !== id);
    try {
      await fetch('/api/blob/queries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: updated }),
      });
      if (active?.id === id) {
        setActive(null);
        setRows([]);
        setRunError(null);
      }
      bumpVersion();
    } catch (e) {
      console.error('Failed to delete query:', e);
    }
  };

  const list = queries ?? [];

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
      <div className="mb-2">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">My Reports</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Saved chat answers you can revisit and re-run.
        </p>
      </div>

      {fetchError && <ErrorBanner error={fetchError} onRetry={bumpVersion} />}

      {isFirstLoad ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map(i => (
            <ReportCardSkeleton key={i} />
          ))}
        </div>
      ) : list.length === 0 && !fetchError ? (
        <EmptyState
          icon={<FolderKanban className="w-5 h-5" />}
          title="No saved reports yet"
          description="Save a chat answer as a report to revisit it later."
          action={
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors"
            >
              Open Chat
            </Link>
          }
        />
      ) : (
        <div className={`relative transition-opacity ${isRefetching ? 'opacity-60' : ''}`}>
          {isRefetching && (
            <Loader2 className="absolute top-2 right-2 w-4 h-4 animate-spin text-[var(--text-muted)]" />
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {list.map(q => (
              <div
                key={q.id}
                className="group rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow flex flex-col justify-between h-40"
              >
                <div>
                  <h3
                    className="font-semibold text-[var(--text-primary)] text-base truncate"
                    title={q.name}
                  >
                    {q.name}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    {new Date(q.created).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                    <span className="text-[var(--border-strong)]">·</span>
                    <span className="uppercase tracking-wide text-[10px] font-semibold">
                      {q.chartType}
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[var(--border)]">
                  <button
                    onClick={() => run(q)}
                    className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                      active?.id === q.id
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)]'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5" />
                    Run report
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this report?')) del(q.id);
                    }}
                    className="px-2.5 py-2 text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                    title="Delete report"
                    aria-label="Delete report"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {runError && <ErrorBanner error={runError} onRetry={() => active && run(active)} />}

      {active && !runError && (
        <div className="mt-10 space-y-6 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-6 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-4 gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-[var(--text-primary)]">{active.name}</h2>
              <p className="text-xs text-[var(--text-muted)] mt-1 font-mono bg-[var(--bg-surface-raised)] px-2 py-0.5 rounded inline-block truncate max-w-md">
                Query: {active.sql}
              </p>
            </div>
            <ExportMenu rows={rows} chartRef={chartRef} filename={active.name} />
          </div>

          {rows.length === 0 ? (
            <div className="py-12 text-center text-[var(--text-muted)]">
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
            onRun={async sqlText => {
              setRunError(null);
              try {
                setRows(await runRawSql(sqlText));
              } catch (e) {
                setRunError(String(e));
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
