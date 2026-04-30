// Composed skeleton layouts — one per shape that appears in the app.
// Used by per-page loading states (KPIs, charts, tables, chat messages,
// sidebar nav, full dashboard overview).

import { Skeleton } from './Skeleton';

export const KpiCardSkeleton = () => (
  <div className="rounded-xl border bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)] space-y-3">
    <Skeleton className="h-3 w-24" />
    <Skeleton className="h-8 w-32" />
    <Skeleton className="h-3 w-20" />
  </div>
);

export const ChartSkeleton = ({ height = 280 }: { height?: number }) => (
  <div className="rounded-xl border bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)]">
    <Skeleton className="h-3 w-40 mb-4" />
    <Skeleton className="w-full" style={{ height }} />
  </div>
);

export const TableSkeleton = ({ rows = 8 }: { rows?: number }) => (
  <div className="rounded-xl border bg-[var(--bg-surface)] divide-y divide-[var(--border)]">
    <div className="grid grid-cols-5 gap-4 p-3">
      {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-3" />)}
    </div>
    {Array.from({ length: rows }, (_, r) => (
      <div key={r} className="grid grid-cols-5 gap-4 p-3">
        {[0, 1, 2, 3, 4].map(c => (
          <Skeleton key={c} className="h-3" style={{ opacity: 1 - r * 0.07 }} />
        ))}
      </div>
    ))}
  </div>
);

export const MessageSkeleton = () => (
  <div className="flex items-start gap-3">
    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
    <div className="flex-1 space-y-2">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  </div>
);

export const SidebarSkeleton = () => (
  <div className="space-y-2 p-4">
    {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-9 rounded-lg" />)}
  </div>
);

export const OverviewSkeleton = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      {Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)}
    </div>
    <ChartSkeleton />
    <ChartSkeleton />
    <TableSkeleton />
  </div>
);
