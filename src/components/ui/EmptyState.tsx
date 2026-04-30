import type { ReactNode } from 'react';

export function EmptyState({
  icon, title, description, action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-12 h-12 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mb-4 text-[var(--accent)]">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
