'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GoldenExample, GoldenStatus } from '@/lib/golden-examples';

type SortKey = 'recent' | 'most_used';
type StatusFilter = 'all' | GoldenStatus;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function LearnedPatternsPage() {
  const [examples, setExamples] = useState<GoldenExample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/golden-examples');
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json() as GoldenExample[];
      setExamples(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(String(e));
      setExamples([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const lower = search.trim().toLowerCase();
    const filtered = examples.filter(e => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (!lower) return true;
      if (e.question.toLowerCase().includes(lower)) return true;
      if (e.question_tags.some(t => t.toLowerCase().includes(lower))) return true;
      if (e.sql.toLowerCase().includes(lower)) return true;
      return false;
    });
    return filtered.sort((a, b) => {
      if (sortBy === 'most_used') return b.use_count - a.use_count;
      return new Date(b.verified_at).getTime() - new Date(a.verified_at).getTime();
    });
  }, [examples, search, sortBy, statusFilter]);

  const unVerify = useCallback(async (id: string) => {
    try {
      await fetch('/api/golden-examples/un-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setExamples(xs => xs.filter(x => x.id !== id));
    } catch (e) {
      alert('Un-verify failed: ' + String(e));
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    if (!confirm('Delete this learned pattern permanently?')) return;
    try {
      await fetch(`/api/golden-examples?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setExamples(xs => xs.filter(x => x.id !== id));
    } catch (e) {
      alert('Delete failed: ' + String(e));
    }
  }, []);

  const verifiedCount = examples.filter(e => e.status === 'verified').length;
  const correctedCount = examples.filter(e => e.status === 'corrected').length;

  return (
    <div className="max-w-5xl mx-auto w-full p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] pb-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Learned Patterns</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {verifiedCount} verified · {correctedCount} corrected · these shape every future answer.
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)] transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search question, tags, SQL…"
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-muted)]"
        />
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortKey)}
          className="px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
        >
          <option value="recent">Sort: recent</option>
          <option value="most_used">Sort: most used</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
        >
          <option value="all">All statuses</option>
          <option value="verified">Verified only</option>
          <option value="corrected">Corrected only</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-sm text-[var(--text-muted)]">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-sm text-[var(--text-muted)]">
          {examples.length === 0
            ? 'No learned patterns yet. Verify or correct answers in the chat to build this library.'
            : 'No matches for your search/filter.'}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(e => {
            const expanded = expandedId === e.id;
            return (
              <div
                key={e.id}
                className={`rounded-xl border bg-[var(--bg-surface)] overflow-hidden transition-colors ${
                  e.status === 'corrected'
                    ? 'border-blue-300 dark:border-blue-800'
                    : 'border-[var(--border)]'
                }`}
              >
                <div className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug">
                      {e.question}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                        e.status === 'corrected'
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                          : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                      }`}>
                        {e.status}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {formatDate(e.verified_at)} · used {e.use_count}×
                      </span>
                      {e.question_tags.slice(0, 4).map(t => (
                        <span
                          key={t}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-surface-raised)] text-[var(--text-muted)] border border-[var(--border)]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    {e.correction_note && (
                      <p className="text-xs text-blue-700 dark:text-blue-300 mt-2 leading-relaxed">
                        <span className="font-semibold">Lesson:</span> {e.correction_note}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => setExpandedId(expanded ? null : e.id)}
                      className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)]"
                    >
                      {expanded ? 'Hide SQL' : 'Show SQL'}
                    </button>
                    <button
                      onClick={() => unVerify(e.id)}
                      className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:text-amber-700 hover:border-amber-400"
                    >
                      Un-verify
                    </button>
                    <button
                      onClick={() => remove(e.id)}
                      className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:text-red-700 hover:border-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-[var(--border)] px-4 py-3 bg-[var(--bg-surface-raised)]">
                    <pre className="text-[12px] font-mono whitespace-pre-wrap text-[var(--text-secondary)] leading-relaxed">
{e.sql}
                    </pre>
                    {e.narrative && (
                      <p className="mt-3 text-xs text-[var(--text-muted)] italic">{e.narrative}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
