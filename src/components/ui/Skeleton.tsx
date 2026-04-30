// Reusable shimmer placeholder. Tailwind v4's animate-pulse handles the
// breathing animation. aria-hidden keeps screen readers from announcing the
// placeholder.

export function Skeleton({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--bg-surface-raised)] ${className}`}
      aria-hidden
      {...props}
    />
  );
}
