'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Brain,
  Loader2,
  ChevronDown,
  ChevronRight,
  Trash2,
  Check,
  AlertTriangle,
} from 'lucide-react';
import type { GoldenExample, GoldenStatus } from '@/lib/golden-examples';
import { useDataFetch } from '@/lib/hooks/useDataFetch';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';

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

function PatternListSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="rounded-xl border bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)] space-y-2"
        >
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function PatternCard({
  example,
  onUnVerify,
}: {
  example: GoldenExample;
  onUnVerify: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const isCorrected = example.status === 'corrected';

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex-1">
          {example.question}
        </h3>
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
            isCorrected
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
              : 'bg-[var(--accent-light)] text-[var(--accent)]'
          }`}
        >
          {isCorrected ? <AlertTriangle className="w-3 h-3" /> : <Check className="w-3 h-3" />}
          {example.status}
        </span>
      </div>

      {example.correction_note && (
        <p className="text-xs text-amber-700 dark:text-amber-300 italic mb-2">
          Lesson: {example.correction_note}
        </p>
      )}

      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {expanded ? 'Hide SQL' : 'Show SQL'}
      </button>

      {expanded && (
        <pre className="mt-2 font-mono text-[11px] bg-[var(--bg-base)] border border-[var(--border)] rounded p-2 overflow-x-auto">
          <code>{example.sql}</code>
        </pre>
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border)]">
        <span className="text-[11px] text-[var(--text-muted)]">
          Used {example.use_count}× · {formatDate(example.verified_at)}
        </span>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)]">Are you sure?</span>
            <button
              onClick={() => {
                onUnVerify(example.id);
                setConfirming(false);
              }}
              className="px-2 py-1 rounded-md bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700 transition-colors"
            >
              Un-verify
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-2 py-1 rounded-md border border-[var(--border)] text-[var(--text-secondary)] text-[11px] hover:bg-[var(--bg-surface-raised)] transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            title="Un-verify"
            aria-label="Un-verify"
          >
            <Trash2 className="w-3 h-3" />
            Un-verify
          </button>
        )}
      </div>
    </div>
  );
}

export default function LearnedPatternsPage() {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [version, setVersion] = useState(0);

  const bumpVersion = useCallback(() => setVersion(v => v + 1), []);

  const { data: examples, isFirstLoad, isRefetching, error } = useDataFetch<GoldenExample[]>(
    () =>
      fetch('/api/golden-examples').then(async r => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        const json = (await r.json()) as GoldenExample[];
        return Array.isArray(json) ? json : [];
      }),
    [`golden-examples-${version}`],
  );

  const handleUnVerify = useCallback(
    async (id: string) => {
      try {
        await fetch('/api/golden-examples/un-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        bumpVersion();
      } catch (e) {
        alert('Un-verify failed: ' + String(e));
      }
    },
    [bumpVersion],
  );

  const visible = useMemo(() => {
    if (!examples) return [];
    const lower = search.trim().toLowerCase();
    const filtered = examples.filter(e => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (!lower) return true;
      if (e.question.toLowerCase().includes(lower)) return true;
      if (e.sql.toLowerCase().includes(lower)) return true;
      return false;
    });
    return filtered.sort((a, b) => {
      if (sortBy === 'most_used') return b.use_count - a.use_count;
      return new Date(b.verified_at).getTime() - new Date(a.verified_at).getTime();
    });
  }, [examples, search, sortBy, statusFilter]);

  return (
    <div className="max-w-5xl mx-auto w-full p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
          Learned Patterns
        </h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Verified Q&rarr;SQL pairs the chat agent has learned from your team.
        </p>
      </div>

      <div className="sticky top-0 z-10 -mx-6 px-6 bg-[var(--bg-base)] py-3 border-b border-[var(--border)] flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search question or SQL…"
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
        />
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-0.5">
          {(['all', 'verified', 'corrected'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                statusFilter === s
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortKey)}
          className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
        >
          <option value="recent">Most recent</option>
          <option value="most_used">Most used</option>
        </select>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner error={error} onRetry={bumpVersion} />
        </div>
      )}

      {isFirstLoad ? (
        <PatternListSkeleton />
      ) : examples && examples.length === 0 ? (
        <EmptyState
          icon={<Brain className="w-5 h-5" />}
          title="No learned patterns yet"
          description="Verify a chat answer to start teaching the system. Each verified pattern improves future SQL accuracy."
          action={
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors"
            >
              Open Chat
            </Link>
          }
        />
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-sm text-[var(--text-muted)]">
          No matches for your search/filter.
        </div>
      ) : (
        <div className={`relative transition-opacity ${isRefetching ? 'opacity-60' : ''}`}>
          {isRefetching && (
            <Loader2 className="absolute top-2 right-2 w-4 h-4 animate-spin text-[var(--text-muted)]" />
          )}
          <div className="space-y-3">
            {visible.map(e => (
              <PatternCard key={e.id} example={e} onUnVerify={handleUnVerify} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
