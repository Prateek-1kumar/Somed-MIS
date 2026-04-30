interface Props {
  label: string;
  value: string;            // pre-formatted; '—' for missing data
  sub?: string;
  alert?: boolean;          // critical KPI (red) — e.g., achievement < 80%
  accent?: boolean;         // highlight in emerald
}

export default function KpiCard({ label, value, sub, alert, accent }: Props) {
  const valueClass = alert
    ? 'text-red-600 dark:text-red-400'
    : accent
      ? 'text-[var(--accent)]'
      : 'text-[var(--text-primary)]';
  const borderClass = alert ? 'border-red-300 dark:border-red-800' : 'border-[var(--border)]';
  return (
    <div className={`rounded-xl border ${borderClass} bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow min-h-[100px]`}>
      <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-bold leading-none tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-2">{sub}</p>}
    </div>
  );
}
