// src/components/dashboard/shared.ts

/**
 * Formatter options. `whenMissing` is rendered when the input is null/undefined
 * so callers can distinguish "no data" (e.g. `'—'`) from a real zero.
 */
export interface FmtOpts {
  whenMissing?: string;
}

// ₹ in Lakhs: 100000 → ₹1.00L, or Crores if ≥ 1Cr
export function fmtL(n: number | null | undefined, opts?: FmtOpts): string {
  if (n === null || n === undefined) return opts?.whenMissing ?? '₹0';
  if (!n) return '₹0';
  const abs = Math.abs(n);
  if (abs >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`;
  if (abs >= 100_000)    return `₹${(n / 100_000).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// Always in Lakhs (for pie chart labels where we always want L)
export function fmtLakhs(n: number): string {
  return `₹${(Math.abs(n) / 100_000).toFixed(2)}L`;
}

export function fmtPct(n: number | null | undefined, opts?: FmtOpts): string {
  if (n === null || n === undefined) return opts?.whenMissing ?? '0%';
  return `${n}%`;
}

export function fmtQty(n: number | null | undefined, opts?: FmtOpts): string {
  if (n === null || n === undefined) return opts?.whenMissing ?? '0';
  if (!n) return '0';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function fmtCount(n: number): string {
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
