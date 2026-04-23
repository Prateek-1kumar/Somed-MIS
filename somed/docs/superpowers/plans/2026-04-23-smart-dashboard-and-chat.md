# Smart Dashboard & Chat-with-Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage with a 6-tab analytics dashboard (Overview, Brand, Segment, Expenses, Primary Bifurcation, Returning) and upgrade the AI chat page with a calculation-transparency confirmation step before executing any query.

**Architecture:** Dashboard is a single `src/app/page.tsx` with client-side tab state; each tab is a self-contained component that runs its own DuckDB query when filters change. All SQL is centralized in `src/reports/dashboard.ts`. Chat page adds an `explanation` step between AI response and SQL execution — the AI now returns `EXPLANATION: ...\nSQL: ...` and the UI shows a "Calculation Plan" card with Confirm / Refine buttons before running anything.

**Tech Stack:** Next.js 16 App Router, React 19, DuckDB-WASM (`useDuckDb` context), Recharts, TypeScript, Tailwind CSS 4.

---

## Confirmed Formulas (DO NOT DEVIATE)

| Metric | Formula |
|---|---|
| Primary | `SUM(net_sales_)` |
| Primary Target | `SUM(tgt_val_p)` |
| Primary Ach% | `ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1)` |
| Secondary | `SUM(sales_valu)` |
| Secondary Target | `SUM(tgt_val_s)` |
| Secondary Ach% | `ROUND(SUM(sales_valu)/NULLIF(SUM(tgt_val_s),0)*100,1)` |
| FOC Value | `SUM(foc_value)` ← NOT `foc_value_`, NOT `foc_val_n` |
| FOC Qty | `SUM(foc_qty__s + cn_qty)` |
| Net Secondary | `SUM(sales_valu) - SUM(foc_val_n)` |
| Total Secondary Sales | `SUM(sales_valu) - SUM(foc_val_n) + SUM(foc_value)` |
| Total Expenses | `SUM(foc_value) + SUM(sample_exp) + SUM(mrkt_exp) + SUM(camp_exp)` |
| Exp% of Secondary | `Total Expenses / Total Secondary Sales * 100` |
| Exp% of Net Secondary | `Total Expenses / Net Secondary * 100` |
| Sale Primary | `SUM(sale_sales)` |
| Returning Primary | `SUM(gri_sales)` |
| RDSI Primary | `SUM(rdsi_sales)` |
| Net Primary | `SUM(net_sales_)` |
| Total Returning | `SUM(return_amt)` |
| Expired | `SUM(expired)` |
| Near 3m | `SUM(near_3)` |
| Near 6m | `SUM(near_6)` |
| Near 9m | `SUM(near_9)` |
| Above 9m / Long Expiry | `SUM(return_amt)-SUM(expired)-SUM(near_3)-SUM(near_6)-SUM(near_9)` |
| Credit Notes | `SUM(cn_value)` (shown separately, positive value) |
| PAP Patients | `SUM(no_patient) * 1000` |
| DCPP Patients | `SUM(dc_patient) * 1000` |

---

## File Map

**Create:**
- `src/reports/dashboard.ts` — all SQL factory functions for dashboard tabs
- `src/components/dashboard/shared.ts` — `fmtL`, `fmtCr`, `fmtPct`, `fmtQty`, `fmtCount` formatters
- `src/components/dashboard/OverviewTab.tsx` — KPI cards + FY breakdown table + chart
- `src/components/dashboard/BrandTab.tsx` — most sold brand (Primary/Secondary/FOC/NetSec × Value/Qty toggle)
- `src/components/dashboard/SegmentTab.tsx` — most sold segment (same toggles)
- `src/components/dashboard/ExpensesTab.tsx` — 10-row labeled expense table
- `src/components/dashboard/PrimaryBifurcationTab.tsx` — 4 KPI cards + stacked bar
- `src/components/dashboard/ReturningTab.tsx` — expiry pie + breakdown table + cn_value card

**Modify:**
- `src/app/page.tsx` — complete rewrite as tabbed dashboard
- `src/components/Sidebar.tsx` — wrap 27 legacy reports in collapsible section
- `src/lib/ai.ts` — update SCHEMA_HINT, add `generateSqlWithExplanation()`
- `src/app/api/nl-to-sql/route.ts` — return `{ sql, explanation, clarify }`
- `src/app/chat/page.tsx` — add explanation card + Confirm/Refine step

---

## Task 1: SQL Factories

**Files:**
- Create: `src/reports/dashboard.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/reports/dashboard.ts
import { Filters, parseFilters } from '@/lib/schema';

// Strips the FY condition so FY-breakdown queries always show all years.
function parseFiltersNoFy(filters: Filters): string {
  const { fy: _ignored, ...rest } = filters;
  return parseFilters(rest);
}

// Adds an extra AND condition to an existing WHERE clause (or starts one).
function andCondition(where: string, condition: string): string {
  return where ? `${where} AND ${condition}` : `WHERE ${condition}`;
}

// ── OVERVIEW ─────────────────────────────────────────────────────────────────

export function dashOverviewKpis(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT
      SUM(net_sales_)                                                        AS primary_sales,
      SUM(tgt_val_p)                                                         AS primary_target,
      ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1)                 AS primary_ach_pct,
      SUM(sales_valu)                                                        AS secondary_sales,
      SUM(tgt_val_s)                                                         AS secondary_target,
      ROUND(SUM(sales_valu)/NULLIF(SUM(tgt_val_s),0)*100,1)                 AS secondary_ach_pct,
      SUM(foc_value)                                                         AS foc_value,
      SUM(foc_qty__s + cn_qty)                                               AS foc_qty,
      SUM(sales_valu) - SUM(foc_val_n)                                      AS net_secondary
    FROM data ${where}
  `.trim();
}

// FY breakdown always shows all FYs — only non-FY filters (ZBM/ABM/HQ/Seg) applied.
export function dashOverviewFy(filters: Filters): string {
  const where = parseFiltersNoFy(filters);
  return `
    SELECT
      fy,
      SUM(net_sales_)                                                        AS primary_sales,
      SUM(tgt_val_p)                                                         AS primary_target,
      ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1)                 AS primary_ach_pct,
      SUM(sales_valu)                                                        AS secondary_sales,
      SUM(tgt_val_s)                                                         AS secondary_target,
      ROUND(SUM(sales_valu)/NULLIF(SUM(tgt_val_s),0)*100,1)                 AS secondary_ach_pct,
      SUM(foc_value)                                                         AS foc_value,
      SUM(sales_valu) - SUM(foc_val_n)                                      AS net_secondary
    FROM data ${where}
    GROUP BY fy
    ORDER BY fy
  `.trim();
}

// ── BRAND ────────────────────────────────────────────────────────────────────

export function dashBrand(filters: Filters): string {
  const base = parseFilters(filters);
  const where = andCondition(base, "item_name NOT LIKE '(INACTIVE)%'");
  return `
    SELECT
      item_name,
      seg,
      SUM(net_sales_)                AS primary_value,
      SUM(sales_qty_)                AS primary_qty,
      SUM(sales_valu)                AS secondary_value,
      SUM(sales_qty2)                AS secondary_qty,
      SUM(foc_value)                 AS foc_value,
      SUM(foc_qty__s + cn_qty)       AS foc_qty,
      SUM(sales_valu)-SUM(foc_val_n) AS net_secondary_value
    FROM data ${where}
    GROUP BY item_name, seg
    ORDER BY primary_value DESC
  `.trim();
}

// ── SEGMENT ──────────────────────────────────────────────────────────────────

export function dashSegment(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT
      seg,
      SUM(net_sales_)                AS primary_value,
      SUM(sales_qty_)                AS primary_qty,
      SUM(sales_valu)                AS secondary_value,
      SUM(sales_qty2)                AS secondary_qty,
      SUM(foc_value)                 AS foc_value,
      SUM(foc_qty__s + cn_qty)       AS foc_qty,
      SUM(sales_valu)-SUM(foc_val_n) AS net_secondary_value
    FROM data ${where}
    GROUP BY seg
    ORDER BY primary_value DESC
  `.trim();
}

// ── EXPENSES ─────────────────────────────────────────────────────────────────

export function dashExpenses(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT
      SUM(foc_value)                                                                  AS foc_value,
      SUM(sample_exp) + SUM(mrkt_exp)                                                 AS sample_mrkt_exp,
      SUM(no_patient) * 1000                                                          AS pap_patients,
      SUM(dc_patient) * 1000                                                          AS dcpp_patients,
      SUM(camp_exp)                                                                   AS camp_exp,
      SUM(foc_value) + SUM(sample_exp) + SUM(mrkt_exp) + SUM(camp_exp)               AS total_expenses,
      SUM(sales_valu) - SUM(foc_val_n) + SUM(foc_value)                              AS total_secondary_sales,
      ROUND(
        (SUM(foc_value)+SUM(sample_exp)+SUM(mrkt_exp)+SUM(camp_exp))
        / NULLIF(SUM(sales_valu)-SUM(foc_val_n)+SUM(foc_value),0)*100, 1)            AS exp_pct_secondary,
      SUM(sales_valu) - SUM(foc_val_n)                                               AS net_secondary_sales,
      ROUND(
        (SUM(foc_value)+SUM(sample_exp)+SUM(mrkt_exp)+SUM(camp_exp))
        / NULLIF(SUM(sales_valu)-SUM(foc_val_n),0)*100, 1)                           AS exp_pct_net_secondary
    FROM data ${where}
  `.trim();
}

// ── PRIMARY BIFURCATION ───────────────────────────────────────────────────────

export function dashPrimaryBifurcation(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT
      SUM(sale_sales)  AS sale_primary,
      SUM(gri_sales)   AS returning_primary,
      SUM(rdsi_sales)  AS rdsi_primary,
      SUM(net_sales_)  AS net_primary
    FROM data ${where}
  `.trim();
}

// FY breakdown for primary bifurcation (no FY filter — always all years).
export function dashPrimaryBifurcationFy(filters: Filters): string {
  const where = parseFiltersNoFy(filters);
  return `
    SELECT
      fy,
      SUM(sale_sales)  AS sale_primary,
      SUM(gri_sales)   AS returning_primary,
      SUM(rdsi_sales)  AS rdsi_primary,
      SUM(net_sales_)  AS net_primary
    FROM data ${where}
    GROUP BY fy
    ORDER BY fy
  `.trim();
}

// ── RETURNING ─────────────────────────────────────────────────────────────────

export function dashReturning(filters: Filters): string {
  const where = parseFilters(filters);
  return `
    SELECT
      SUM(return_amt)                                                                          AS total_returning,
      SUM(expired)                                                                             AS expired_returning,
      SUM(near_3)                                                                              AS near_3m,
      SUM(near_6)                                                                              AS near_6m,
      SUM(near_9)                                                                              AS near_9m,
      SUM(return_amt) - SUM(expired) - SUM(near_3) - SUM(near_6) - SUM(near_9)               AS above_9m,
      SUM(cn_value)                                                                            AS credit_notes
    FROM data ${where}
  `.trim();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/reports/dashboard.ts
git commit -m "feat: add dashboard SQL factories for all 6 tabs"
```

---

## Task 2: Shared Formatters

**Files:**
- Create: `src/components/dashboard/shared.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/components/dashboard/shared.ts

// ₹ in Lakhs: 100000 → ₹1.00L
export function fmtL(n: number): string {
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

export function fmtPct(n: number): string {
  return `${n ?? 0}%`;
}

export function fmtQty(n: number): string {
  if (!n) return '0';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function fmtCount(n: number): string {
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/shared.ts
git commit -m "feat: add shared dashboard formatters"
```

---

## Task 3: Overview Tab

**Files:**
- Create: `src/components/dashboard/OverviewTab.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/dashboard/OverviewTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import { Filters } from '@/lib/schema';
import { dashOverviewKpis, dashOverviewFy } from '@/reports/dashboard';
import KpiCard from '@/components/KpiCard';
import ReportChart from '@/components/ReportChart';
import ReportTable from '@/components/ReportTable';
import { fmtL, fmtPct, fmtQty } from './shared';

interface Props { filters: Filters }

export default function OverviewTab({ filters }: Props) {
  const { query } = useDuckDb();
  const [kpis, setKpis] = useState<Record<string, number>>({});
  const [fyRows, setFyRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([query(dashOverviewKpis(filters)), query(dashOverviewFy(filters))])
      .then(([kpiRes, fyRes]) => {
        setKpis((kpiRes[0] as Record<string, number>) ?? {});
        setFyRows(fyRes);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filters, query]);

  const n = (k: string) => Number(kpis[k] ?? 0);

  return (
    <div className="space-y-6">
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="Primary Sales"    value={fmtL(n('primary_sales'))}    sub={`Target: ${fmtL(n('primary_target'))}`} />
        <KpiCard label="Primary Ach%"     value={fmtPct(n('primary_ach_pct'))} alert={n('primary_ach_pct') < 80} />
        <KpiCard label="Secondary Sales"  value={fmtL(n('secondary_sales'))}  sub={`Target: ${fmtL(n('secondary_target'))}`} />
        <KpiCard label="Secondary Ach%"   value={fmtPct(n('secondary_ach_pct'))} alert={n('secondary_ach_pct') < 80} />
        <KpiCard label="FOC Value"        value={fmtL(n('foc_value'))}        sub={`Qty: ${fmtQty(n('foc_qty'))}`} />
        <KpiCard label="Net Secondary"    value={fmtL(n('net_secondary'))} />
      </div>

      {/* FY Breakdown Chart */}
      {fyRows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            FY-Wise Sales Trend
          </h3>
          <p className="text-[11px] text-[var(--text-muted)] mb-4">All financial years — hierarchy filters applied</p>
          <ReportChart
            rows={fyRows}
            chartType="bar"
            xKey="fy"
            valueKeys={['primary_sales', 'secondary_sales', 'net_secondary', 'foc_value']}
          />
        </div>
      )}

      {/* FY Achievement % chart */}
      {fyRows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            FY-Wise Achievement %
          </h3>
          <ReportChart
            rows={fyRows}
            chartType="line"
            xKey="fy"
            valueKeys={['primary_ach_pct', 'secondary_ach_pct']}
          />
        </div>
      )}

      {/* FY Detail Table */}
      {fyRows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">
            FY Detail Table
          </h3>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <ReportTable rows={fyRows} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/OverviewTab.tsx
git commit -m "feat: add OverviewTab with KPIs and FY breakdown"
```

---

## Task 4: Brand Tab

**Files:**
- Create: `src/components/dashboard/BrandTab.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/dashboard/BrandTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import { Filters } from '@/lib/schema';
import { dashBrand } from '@/reports/dashboard';
import ReportChart from '@/components/ReportChart';
import ReportTable from '@/components/ReportTable';

interface Props { filters: Filters }

type Metric = 'primary' | 'secondary' | 'foc' | 'net_secondary';
type Mode = 'value' | 'qty';

const METRIC_LABELS: Record<Metric, string> = {
  primary: 'Primary', secondary: 'Secondary', foc: 'FOC', net_secondary: 'Net Secondary',
};

const VALUE_KEYS: Record<Metric, string> = {
  primary: 'primary_value', secondary: 'secondary_value', foc: 'foc_value', net_secondary: 'net_secondary_value',
};

const QTY_KEYS: Record<Metric, string> = {
  primary: 'primary_qty', secondary: 'secondary_qty', foc: 'foc_qty', net_secondary: 'primary_qty',
};

export default function BrandTab({ filters }: Props) {
  const { query } = useDuckDb();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('primary');
  const [mode, setMode] = useState<Mode>('value');

  useEffect(() => {
    setLoading(true);
    setError(null);
    query(dashBrand(filters))
      .then(setRows)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filters, query]);

  const activeKey = mode === 'value' ? VALUE_KEYS[metric] : QTY_KEYS[metric];
  const top15 = [...rows].sort((a, b) => Number(b[activeKey] ?? 0) - Number(a[activeKey] ?? 0)).slice(0, 15);

  const btnBase = 'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border';
  const btnActive = 'bg-[var(--text-primary)] text-[var(--bg-surface)] border-[var(--text-primary)]';
  const btnInactive = 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-surface-raised)]';

  return (
    <div className="space-y-5">
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Toggles */}
      <div className="flex flex-wrap gap-4">
        <div className="flex gap-1.5">
          {(['primary','secondary','foc','net_secondary'] as Metric[]).map(m => (
            <button key={m} onClick={() => setMetric(m)} className={`${btnBase} ${metric === m ? btnActive : btnInactive}`}>
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(['value','qty'] as Mode[]).map(mo => (
            <button key={mo} onClick={() => setMode(mo)} className={`${btnBase} ${mode === mo ? btnActive : btnInactive}`}>
              {mo === 'value' ? 'Value' : 'Quantity'}
            </button>
          ))}
        </div>
      </div>

      {/* Top 15 Chart */}
      {top15.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            Top 15 Brands — {METRIC_LABELS[metric]} ({mode === 'value' ? '₹' : 'Qty'})
          </h3>
          <ReportChart rows={top15} chartType="bar" xKey="item_name" valueKeys={[activeKey]} />
        </div>
      )}

      {/* Full Table */}
      {rows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">All Brands</h3>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <ReportTable rows={rows} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/BrandTab.tsx
git commit -m "feat: add BrandTab with Primary/Secondary/FOC/NetSec × Value/Qty toggles"
```

---

## Task 5: Segment Tab

**Files:**
- Create: `src/components/dashboard/SegmentTab.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/dashboard/SegmentTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import { Filters } from '@/lib/schema';
import { dashSegment } from '@/reports/dashboard';
import ReportChart from '@/components/ReportChart';
import ReportTable from '@/components/ReportTable';

interface Props { filters: Filters }

type Metric = 'primary' | 'secondary' | 'foc' | 'net_secondary';
type Mode = 'value' | 'qty';

const METRIC_LABELS: Record<Metric, string> = {
  primary: 'Primary', secondary: 'Secondary', foc: 'FOC', net_secondary: 'Net Secondary',
};
const VALUE_KEYS: Record<Metric, string> = {
  primary: 'primary_value', secondary: 'secondary_value', foc: 'foc_value', net_secondary: 'net_secondary_value',
};
const QTY_KEYS: Record<Metric, string> = {
  primary: 'primary_qty', secondary: 'secondary_qty', foc: 'foc_qty', net_secondary: 'primary_qty',
};

export default function SegmentTab({ filters }: Props) {
  const { query } = useDuckDb();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('primary');
  const [mode, setMode] = useState<Mode>('value');

  useEffect(() => {
    setLoading(true);
    setError(null);
    query(dashSegment(filters))
      .then(setRows)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filters, query]);

  const activeKey = mode === 'value' ? VALUE_KEYS[metric] : QTY_KEYS[metric];
  const btnBase = 'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border';
  const btnActive = 'bg-[var(--text-primary)] text-[var(--bg-surface)] border-[var(--text-primary)]';
  const btnInactive = 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-surface-raised)]';

  return (
    <div className="space-y-5">
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Toggles */}
      <div className="flex flex-wrap gap-4">
        <div className="flex gap-1.5">
          {(['primary','secondary','foc','net_secondary'] as Metric[]).map(m => (
            <button key={m} onClick={() => setMetric(m)} className={`${btnBase} ${metric === m ? btnActive : btnInactive}`}>
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(['value','qty'] as Mode[]).map(mo => (
            <button key={mo} onClick={() => setMode(mo)} className={`${btnBase} ${mode === mo ? btnActive : btnInactive}`}>
              {mo === 'value' ? 'Value' : 'Quantity'}
            </button>
          ))}
        </div>
      </div>

      {/* Pie chart for segment share */}
      {rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
              Segment Share — {METRIC_LABELS[metric]} {mode === 'value' ? '(₹)' : '(Qty)'}
            </h3>
            <ReportChart rows={rows} chartType="pie" xKey="seg" valueKeys={[activeKey]} />
          </div>
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
              Segment Comparison
            </h3>
            <ReportChart rows={rows} chartType="bar" xKey="seg" valueKeys={[activeKey]} />
          </div>
        </div>
      )}

      {/* Full Table */}
      {rows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">Segment Detail</h3>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <ReportTable rows={rows} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/SegmentTab.tsx
git commit -m "feat: add SegmentTab with pie + bar charts and metric toggles"
```

---

## Task 6: Expenses Tab

**Files:**
- Create: `src/components/dashboard/ExpensesTab.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/dashboard/ExpensesTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import { Filters } from '@/lib/schema';
import { dashExpenses } from '@/reports/dashboard';
import { fmtL, fmtPct, fmtCount } from './shared';

interface Props { filters: Filters }

export default function ExpensesTab({ filters }: Props) {
  const { query } = useDuckDb();
  const [data, setData] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    query(dashExpenses(filters))
      .then(rows => setData((rows[0] as Record<string, number>) ?? {}))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filters, query]);

  const n = (k: string) => Number(data[k] ?? 0);

  const rows: { num: number; label: string; value: string; note?: string; bold?: boolean; divider?: boolean }[] = [
    { num: 1,  label: 'FOC Value',                             value: fmtL(n('foc_value')),              note: 'foc_value' },
    { num: 2,  label: 'Sample & Marketing Expenses',           value: fmtL(n('sample_mrkt_exp')),        note: 'sample_exp + mrkt_exp' },
    { num: 3,  label: 'No. of Patients (PAP)',                 value: fmtCount(n('pap_patients')),       note: 'no_patient × 1000' },
    { num: 4,  label: 'No. of Patients (DCPP)',                value: fmtCount(n('dcpp_patients')),      note: 'dc_patient × 1000' },
    { num: 5,  label: 'Camp Expenses',                         value: fmtL(n('camp_exp')),               note: 'camp_exp' },
    { num: 6,  label: 'Total Expenses',                        value: fmtL(n('total_expenses')),         note: 'FOC + Sample+Mrkt + Camp', bold: true },
    { num: 7,  label: 'Total Secondary Sales',                 value: fmtL(n('total_secondary_sales')),  note: 'sales_valu − foc_val_n + foc_value', bold: true, divider: true },
    { num: 8,  label: 'Expenses % of Secondary Sales',        value: fmtPct(n('exp_pct_secondary')),    bold: true },
    { num: 9,  label: 'Net Secondary Sales',                   value: fmtL(n('net_secondary_sales')),    note: 'sales_valu − foc_val_n', divider: true },
    { num: 10, label: 'Expenses % of Net Secondary Sales',    value: fmtPct(n('exp_pct_net_secondary')), bold: true },
  ];

  return (
    <div className="space-y-5">
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Expense Details</h3>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {rows.map(row => (
              <tr
                key={row.num}
                className={`border-b border-[var(--border)] last:border-0 ${row.divider ? 'border-t-2 border-t-[var(--border-strong)]' : ''}`}
              >
                <td className="px-5 py-3 text-[var(--text-muted)] w-8 text-right">{row.num}.</td>
                <td className="px-3 py-3 text-[var(--text-primary)] flex-1">
                  <span className={row.bold ? 'font-semibold' : ''}>{row.label}</span>
                  {row.note && (
                    <span className="ml-2 text-[11px] text-[var(--text-muted)] font-normal">({row.note})</span>
                  )}
                </td>
                <td className={`px-5 py-3 text-right tabular-nums ${row.bold ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                  {loading ? '—' : row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/ExpensesTab.tsx
git commit -m "feat: add ExpensesTab with 10-row labeled expense table"
```

---

## Task 7: Primary Bifurcation Tab

**Files:**
- Create: `src/components/dashboard/PrimaryBifurcationTab.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/dashboard/PrimaryBifurcationTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import { Filters } from '@/lib/schema';
import { dashPrimaryBifurcation, dashPrimaryBifurcationFy } from '@/reports/dashboard';
import KpiCard from '@/components/KpiCard';
import ReportChart from '@/components/ReportChart';
import ReportTable from '@/components/ReportTable';
import { fmtL } from './shared';

interface Props { filters: Filters }

export default function PrimaryBifurcationTab({ filters }: Props) {
  const { query } = useDuckDb();
  const [kpis, setKpis] = useState<Record<string, number>>({});
  const [fyRows, setFyRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([query(dashPrimaryBifurcation(filters)), query(dashPrimaryBifurcationFy(filters))])
      .then(([kpiRes, fyRes]) => {
        setKpis((kpiRes[0] as Record<string, number>) ?? {});
        setFyRows(fyRes);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filters, query]);

  const n = (k: string) => Number(kpis[k] ?? 0);

  return (
    <div className="space-y-6">
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Sale Primary"      value={fmtL(n('sale_primary'))}      sub="Gross sales dispatched" />
        <KpiCard label="Returning Primary" value={fmtL(n('returning_primary'))} sub="GRI returns" alert={n('returning_primary') < -1000} />
        <KpiCard label="RDSI Primary"      value={fmtL(n('rdsi_primary'))}      sub="CN deduction" />
        <KpiCard label="Net Primary"       value={fmtL(n('net_primary'))}       sub="Sale − Return − RDSI" />
      </div>

      {/* Composition Note */}
      <p className="text-xs text-[var(--text-muted)]">
        Net Primary = Sale Primary + Returning Primary + RDSI Primary (returning and RDSI are negative values)
      </p>

      {/* FY stacked bar */}
      {fyRows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            Primary Bifurcation — FY Trend
          </h3>
          <ReportChart
            rows={fyRows}
            chartType="stacked-bar"
            xKey="fy"
            valueKeys={['sale_primary', 'returning_primary', 'rdsi_primary']}
          />
        </div>
      )}

      {fyRows.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">FY Detail</h3>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <ReportTable rows={fyRows} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/PrimaryBifurcationTab.tsx
git commit -m "feat: add PrimaryBifurcationTab with 4 KPI cards and FY stacked bar"
```

---

## Task 8: Returning Tab

**Files:**
- Create: `src/components/dashboard/ReturningTab.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/dashboard/ReturningTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import { Filters } from '@/lib/schema';
import { dashReturning } from '@/reports/dashboard';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import KpiCard from '@/components/KpiCard';
import { fmtL, fmtLakhs } from './shared';

interface Props { filters: Filters }

const SLICE_COLORS = ['#f43f5e', '#f59e0b', '#8b5cf6', '#0ea5e9', '#10b981'];

export default function ReturningTab({ filters }: Props) {
  const { query } = useDuckDb();
  const [data, setData] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    query(dashReturning(filters))
      .then(rows => setData((rows[0] as Record<string, number>) ?? {}))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filters, query]);

  const n = (k: string) => Number(data[k] ?? 0);
  const abs = (k: string) => Math.abs(n(k));

  const total = abs('total_returning');

  const slices = [
    { name: 'Expired',        key: 'expired_returning', color: SLICE_COLORS[0] },
    { name: 'Near 3 Months',  key: 'near_3m',           color: SLICE_COLORS[1] },
    { name: 'Near 6 Months',  key: 'near_6m',           color: SLICE_COLORS[2] },
    { name: 'Near 9 Months',  key: 'near_9m',           color: SLICE_COLORS[3] },
    { name: 'Long Expiry (>9m)', key: 'above_9m',        color: SLICE_COLORS[4] },
  ];

  const pieData = slices.map(s => ({
    name: s.name,
    value: abs(s.key),
    color: s.color,
  })).filter(d => d.value > 0);

  const pct = (k: string) => total > 0 ? ((abs(k) / total) * 100).toFixed(1) : '0.0';

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { name: string; value: number }[] }) => {
    if (!active || !payload?.length) return null;
    const item = payload[0];
    return (
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-3 shadow-md text-sm">
        <p className="font-semibold text-[var(--text-primary)] mb-1">{item.name}</p>
        <p className="text-[var(--text-secondary)]">{fmtLakhs(item.value)}</p>
        <p className="text-[var(--text-muted)] text-xs">{((item.value / total) * 100).toFixed(1)}% of total</p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard label="Total Returning (GRI)" value={fmtL(abs('total_returning'))} sub="return_amt" alert />
        <KpiCard label="Credit Notes"          value={fmtL(n('credit_notes'))}       sub="cn_value — issued vs free goods" />
      </div>

      {/* Pie + Breakdown Table */}
      {total > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Pie Chart */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
              Return Breakdown by Expiry
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] mb-2">Values in ₹ Lakhs, % of total GRI return</p>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} className="stroke-[var(--bg-surface)] stroke-2" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: '12px', color: 'var(--text-secondary)', paddingTop: '12px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Breakdown Table */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-sm overflow-hidden self-start">
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Expiry Breakdown</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-surface-raised)]">
                  <th className="px-5 py-2.5 text-left text-xs font-semibold text-[var(--text-muted)]">Category</th>
                  <th className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--text-muted)]">Value (₹L)</th>
                  <th className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--text-muted)]">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {slices.map(s => (
                  <tr key={s.key} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-surface-raised)] transition-colors">
                    <td className="px-5 py-3 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="text-[var(--text-primary)]">{s.name}</span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                      {fmtLakhs(abs(s.key))}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-[var(--text-primary)]">
                      {pct(s.key)}%
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[var(--border-strong)] bg-[var(--bg-surface-raised)]">
                  <td className="px-5 py-3 font-bold text-[var(--text-primary)]">Total GRI Return</td>
                  <td className="px-5 py-3 text-right tabular-nums font-bold text-[var(--text-primary)]">{fmtLakhs(total)}</td>
                  <td className="px-5 py-3 text-right font-bold text-[var(--text-primary)]">100%</td>
                </tr>
              </tbody>
            </table>

            {/* Credit notes row */}
            <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg-surface-raised)]/50">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-muted)]">Credit Notes (issued vs free goods)</span>
                <span className="font-semibold text-[var(--text-primary)]">{fmtLakhs(n('credit_notes'))}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/ReturningTab.tsx
git commit -m "feat: add ReturningTab with expiry pie chart, breakdown table, and credit notes"
```

---

## Task 9: Main Dashboard Page

**Files:**
- Modify: `src/app/page.tsx` (complete rewrite)

- [ ] **Step 1: Rewrite the dashboard page**

```tsx
// src/app/page.tsx
'use client';
import { useState } from 'react';
import { Filters } from '@/lib/schema';
import OverviewTab from '@/components/dashboard/OverviewTab';
import BrandTab from '@/components/dashboard/BrandTab';
import SegmentTab from '@/components/dashboard/SegmentTab';
import ExpensesTab from '@/components/dashboard/ExpensesTab';
import PrimaryBifurcationTab from '@/components/dashboard/PrimaryBifurcationTab';
import ReturningTab from '@/components/dashboard/ReturningTab';

const FYS = ['2022-2023', '2023-2024', '2024-2025', '2025-2026', '2026-2027'];
const ZBMs = ['', 'RBM WEST', 'ZBM EAST', 'ZBM MP'];
const SEGS = ['', 'ABX', 'GASTRO', 'GYNAE', 'NEURO', 'ORTHO', 'WELLNESS'];

type TabId = 'overview' | 'brand' | 'segment' | 'expenses' | 'primary' | 'returning';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview',   label: 'Overview' },
  { id: 'brand',      label: 'Brand Analysis' },
  { id: 'segment',    label: 'Segment Analysis' },
  { id: 'expenses',   label: 'Expenses' },
  { id: 'primary',    label: 'Primary Bifurcation' },
  { id: 'returning',  label: 'Returning' },
];

const selectCls = 'px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-muted)] cursor-pointer';

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [filters, setFilters] = useState<Filters>({ fy: '2025-2026' });

  const setFilter = (key: keyof Filters, val: string) =>
    setFilters(prev => ({ ...prev, [key]: val || undefined }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Shomed Remedies MIS</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Executive Dashboard</p>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <select value={filters.fy ?? ''} onChange={e => setFilter('fy', e.target.value)} className={selectCls}>
            <option value="">All FYs</option>
            {FYS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={filters.zbm ?? ''} onChange={e => setFilter('zbm', e.target.value)} className={selectCls}>
            {ZBMs.map(z => <option key={z} value={z}>{z || 'All ZBMs'}</option>)}
          </select>
          <select value={filters.seg ?? ''} onChange={e => setFilter('seg', e.target.value)} className={selectCls}>
            {SEGS.map(s => <option key={s} value={s}>{s || 'All Segments'}</option>)}
          </select>
          <button
            onClick={() => setFilters({ fy: '2025-2026' })}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)] transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all -mb-px ${
              activeTab === tab.id
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview'   && <OverviewTab filters={filters} />}
        {activeTab === 'brand'      && <BrandTab filters={filters} />}
        {activeTab === 'segment'    && <SegmentTab filters={filters} />}
        {activeTab === 'expenses'   && <ExpensesTab filters={filters} />}
        {activeTab === 'primary'    && <PrimaryBifurcationTab filters={filters} />}
        {activeTab === 'returning'  && <ReturningTab filters={filters} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: replace homepage with 6-tab analytics dashboard"
```

---

## Task 10: Sidebar — Legacy Reports

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add collapsible Legacy Reports section**

In `src/components/Sidebar.tsx`, replace the `{REPORT_GROUPS.map(group => { ... })}` block (lines 87–108) with:

```tsx
{/* Legacy Reports — collapsible */}
<LegacyReportsSection activeId={activeId} />
```

And add this component above the `export default function Sidebar()` declaration:

```tsx
function LegacyReportsSection({ activeId }: { activeId: string | undefined }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider hover:text-[var(--text-primary)] transition-colors rounded-lg hover:bg-[var(--bg-surface-raised)]"
      >
        <span>Legacy Reports</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m9 18 6-6-6-6" />
        </svg>
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5">
          {REPORT_GROUPS.map(group => {
            const groupReports = REPORTS.filter(r => r.group === group);
            if (groupReports.length === 0) return null;
            return (
              <div key={group} className="space-y-1">
                <h3 className="px-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mt-2">
                  {group}
                </h3>
                {groupReports.map(report => (
                  <NavLink
                    key={report.id}
                    href={`/reports/${report.id}`}
                    active={activeId === report.id}
                    icon={<ChartIcon />}
                  >
                    {report.name}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

Also add `useState` to the import at the top of Sidebar.tsx — it already imports from `react` via `ReactNode`, so update:

```tsx
import { ReactNode, useState } from 'react';
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: move 27 legacy reports into collapsible sidebar section"
```

---

## Task 11: AI — Add Explanation to SQL Generation

**Files:**
- Modify: `src/lib/ai.ts`

- [ ] **Step 1: Update SCHEMA_HINT and add explanation prompt + parser**

Replace the entire content of `src/lib/ai.ts` with:

```typescript
// src/lib/ai.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { CSV_COLUMNS } from './schema';

const SCHEMA_HINT = `
Table name: data (single table, no joins needed)
Columns: ${CSV_COLUMNS.join(', ')}

KEY FORMULAS — use these exactly:
- Primary Sales       = SUM(net_sales_)
- Primary Target      = SUM(tgt_val_p)
- Primary Ach%        = ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1)
- Secondary Sales     = SUM(sales_valu)
- Secondary Target    = SUM(tgt_val_s)
- Secondary Ach%      = ROUND(SUM(sales_valu)/NULLIF(SUM(tgt_val_s),0)*100,1)
- FOC Value           = SUM(foc_value)   ← NOT foc_value_, NOT foc_val_n
- FOC Qty             = SUM(foc_qty__s + cn_qty)
- Net Secondary       = SUM(sales_valu) - SUM(foc_val_n)
- Total Secondary     = SUM(sales_valu) - SUM(foc_val_n) + SUM(foc_value)
- Total Expenses      = SUM(foc_value) + SUM(sample_exp) + SUM(mrkt_exp) + SUM(camp_exp)
- Sale Primary        = SUM(sale_sales)
- Returning Primary   = SUM(gri_sales)   ← negative values
- RDSI Primary        = SUM(rdsi_sales)  ← negative values
- Net Primary         = SUM(net_sales_)
- Total Returning     = SUM(return_amt)  ← negative values
- Expired Returning   = SUM(expired)
- Near 3m expiry      = SUM(near_3)
- Near 6m expiry      = SUM(near_6)
- Near 9m expiry      = SUM(near_9)
- Long Expiry (>9m)   = SUM(return_amt)-SUM(expired)-SUM(near_3)-SUM(near_6)-SUM(near_9)
- PAP Patients        = SUM(no_patient) * 1000
- DCPP Patients       = SUM(dc_patient) * 1000
- Exclude inactive    = WHERE item_name NOT LIKE '(INACTIVE)%'

FY values: '2022-2023','2023-2024','2024-2025','2025-2026','2026-2027'
Segments (seg): ABX, GASTRO, GYNAE, NEURO, ORTHO, WELLNESS
ZBMs: 'RBM WEST', 'ZBM EAST', 'ZBM MP'
HQs (hq_new): AGRA, ALIGARH, BAREILLY, BIJNOR, CHANDAUSI, DEHRADUN, DEORIA, GHAZIABAD, GONDA, GORAKHPUR, HALDWANI, HARDA, JHANSI, MEERUT, MORADABAD
`.trim();

const NL_EXPLAIN_PROMPT = (question: string) => `
You are a data analyst for Shomed Remedies (pharma company). Generate a DuckDB SQL query to answer the user's question.

${SCHEMA_HINT}

Respond in EXACTLY this format — two parts separated by a blank line:
EXPLANATION: [1-3 sentences explaining in plain English what data you are fetching and which columns/formulas you are using]

SQL:
[valid DuckDB SQL — no markdown, no backticks, no semicolon at end]

If the question is ambiguous, respond with: CLARIFY: [one question to resolve ambiguity]

User question: ${question}
`.trim();

const PB_PROMPT = (sql: string) => `
Convert this PowerBI/MSSQL query to DuckDB SQL. Output ONLY the converted SQL, no explanation.
Rules: TOP n → LIMIT n, [bracket names] → plain names, ISNULL → COALESCE, [dbo].[anything] → data, GETDATE() → CURRENT_DATE, remove NOLOCK hints, remove WITH(NOLOCK).

${SCHEMA_HINT}

PowerBI SQL:
${sql}
`.trim();

const REFINE_PROMPT = (currentSql: string, instruction: string, reportTitle: string) => `
You are a DuckDB SQL editor for Shomed Remedies MIS.
Modify the query below according to the user's instruction.

${SCHEMA_HINT}

Respond in EXACTLY this format:
EXPLANATION: [1-2 sentences describing what you changed and why]

SQL:
[complete modified SQL — no markdown, no backticks]

If the instruction is ambiguous, respond with: CLARIFY: [one question]

Report: ${reportTitle}

Current SQL:
${currentSql}

User instruction: ${instruction}
`.trim();

async function callGemini(prompt: string): Promise<string> {
  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

async function callGroq(prompt: string): Promise<string> {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 768,
  });
  return completion.choices[0].message.content?.trim() ?? '';
}

function parseExplanationAndSql(response: string): { sql?: string; explanation?: string; clarify?: string } {
  if (response.startsWith('CLARIFY:')) {
    return { clarify: response.replace('CLARIFY:', '').trim() };
  }
  // Strip any accidental markdown fences
  const clean = response.replace(/^```(?:sql)?\s*/im, '').replace(/\s*```$/im, '').trim();
  const explMatch = clean.match(/^EXPLANATION:\s*([\s\S]*?)\n\nSQL:\s*\n([\s\S]+)$/i);
  if (explMatch) {
    return { explanation: explMatch[1].trim(), sql: explMatch[2].trim() };
  }
  // Fallback: no explanation, treat whole response as SQL
  return { sql: clean };
}

export async function generateSqlWithExplanation(question: string): Promise<{ sql?: string; explanation?: string; clarify?: string }> {
  const prompt = NL_EXPLAIN_PROMPT(question);
  let response: string;
  try {
    response = await callGemini(prompt);
  } catch (e) {
    console.error('Gemini failed, falling back to Groq:', e);
    response = await callGroq(prompt);
  }
  return parseExplanationAndSql(response);
}

// Keep original for backward compat with existing reports page
export async function generateSql(question: string): Promise<{ sql?: string; clarify?: string }> {
  const result = await generateSqlWithExplanation(question);
  return { sql: result.sql, clarify: result.clarify };
}

export async function refineSql(
  currentSql: string,
  instruction: string,
  reportTitle: string,
): Promise<{ sql?: string; explanation?: string; clarify?: string }> {
  const prompt = REFINE_PROMPT(currentSql, instruction, reportTitle);
  let response: string;
  try {
    response = await callGemini(prompt);
  } catch (e) {
    console.error('Gemini failed, falling back to Groq:', e);
    response = await callGroq(prompt);
  }
  return parseExplanationAndSql(response);
}

export async function convertPowerBiSql(sql: string): Promise<string> {
  const prompt = PB_PROMPT(sql);
  try {
    return await callGemini(prompt);
  } catch (e) {
    console.error('Gemini failed, falling back to Groq:', e);
    return await callGroq(prompt);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ai.ts
git commit -m "feat: add generateSqlWithExplanation and update schema hint with correct formulas"
```

---

## Task 12: NL-to-SQL API Route

**Files:**
- Modify: `src/app/api/nl-to-sql/route.ts`

- [ ] **Step 1: Update route to use new function**

Replace the entire file:

```typescript
// src/app/api/nl-to-sql/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { generateSqlWithExplanation } from '@/lib/ai';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { question?: string };
    if (!body.question?.trim()) {
      return NextResponse.json({ error: 'question required' }, { status: 400 });
    }
    const result = await generateSqlWithExplanation(body.question);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: 'AI unavailable — write SQL manually', detail: String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/nl-to-sql/route.ts
git commit -m "feat: nl-to-sql route now returns explanation alongside sql"
```

---

## Task 13: Chat Page — Confirmation Step

**Files:**
- Modify: `src/app/chat/page.tsx`

- [ ] **Step 1: Add `explanation` and `confirmed` fields to Message type and update the AI response block**

The key changes are:
1. Add `explanation?: string` and `confirmed?: boolean` to the `Message` interface.
2. Add a `refineInput` state per message for the refine flow.
3. Replace the SQL card's "Run Query" button with "Confirm & Run" that only appears after the explanation is acknowledged. Show a "Refine" text input below.

Replace the file with:

```tsx
// src/app/chat/page.tsx
'use client';
import { useState, useRef, useEffect } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import ReportTable from '@/components/ReportTable';
import ReportChart from '@/components/ReportChart';
import ExportMenu from '@/components/ExportMenu';

function ResultBlock({ rows }: { rows: Record<string, unknown>[] }) {
  const chartRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex flex-col gap-4 mt-2 p-4 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-sm">
      <div className="flex justify-between items-center mb-2 pb-2 border-b border-[var(--border)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Results</h3>
        <ExportMenu rows={rows} chartRef={chartRef} filename="chat-result" />
      </div>
      <div className="max-h-[320px] overflow-auto rounded-lg border border-[var(--border)]">
        <ReportTable rows={rows} />
      </div>
      <div ref={chartRef} className="pt-2">
        <ReportChart rows={rows} chartType="bar" />
      </div>
    </div>
  );
}

interface Message {
  id: number;
  role: 'user' | 'ai';
  text?: string;
  sql?: string;
  explanation?: string;
  clarify?: string;
  confirmed?: boolean;
  rows?: Record<string, unknown>[];
  ran?: boolean;
  error?: string;
}

const SUGGESTIONS = [
  'Top 5 brands by secondary sales for FY 2025-26',
  'Segment-wise expense % for FY 2024-25',
  'Monthly primary sales trend for NEURO segment',
  'HQ-wise achievement % this year',
];

export default function ChatPage() {
  const { query } = useDuckDb();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [refineInputs, setRefineInputs] = useState<Record<number, string>>({});
  const [showRefine, setShowRefine] = useState<Record<number, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async (question?: string) => {
    const q = (question ?? input).trim();
    if (!q || loading) return;
    setInput('');
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', text: q }]);
    setLoading(true);
    try {
      const res = await fetch('/api/nl-to-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json() as { sql?: string; explanation?: string; clarify?: string; error?: string };
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'ai',
        sql: data.sql,
        explanation: data.explanation,
        clarify: data.clarify,
        error: data.error,
        confirmed: false,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ai', error: String(e) }]);
    } finally {
      setLoading(false);
    }
  };

  const confirm = async (msgId: number) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg?.sql) return;
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, confirmed: true } : m));
    try {
      const rows = await query(msg.sql);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rows, ran: true, error: undefined } : m));
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, error: String(e) } : m));
    }
  };

  const refine = async (msgId: number) => {
    const instruction = refineInputs[msgId]?.trim();
    const msg = messages.find(m => m.id === msgId);
    if (!instruction || !msg?.sql) return;
    setRefineInputs(prev => ({ ...prev, [msgId]: '' }));
    setShowRefine(prev => ({ ...prev, [msgId]: false }));
    setLoading(true);
    try {
      const res = await fetch('/api/refine-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentSql: msg.sql, instruction, reportTitle: 'Chat' }),
      });
      const data = await res.json() as { sql?: string; explanation?: string; clarify?: string };
      setMessages(prev => prev.map(m =>
        m.id === msgId
          ? { ...m, sql: data.sql ?? m.sql, explanation: data.explanation ?? m.explanation, clarify: data.clarify, confirmed: false, rows: undefined, ran: false }
          : m
      ));
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, error: String(e) } : m));
    } finally {
      setLoading(false);
    }
  };

  const saveSql = async (sql: string) => {
    const name = prompt('Name this report:');
    if (!name) return;
    try {
      const res = await fetch('/api/blob/queries');
      const existing = (await res.json()) as unknown[];
      const updated = [...existing, { id: Date.now(), name, sql, chartType: 'bar', created: new Date().toISOString() }];
      await fetch('/api/blob/queries', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queries: updated }) });
    } catch (e) {
      alert('Failed to save: ' + String(e));
    }
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full p-4 sm:p-6 pb-0">
      {/* Header */}
      <div className="border-b border-[var(--border)] pb-4 mb-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Chat with your data</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Ask anything — I'll show my calculation plan before fetching results.</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-6 pb-6 pr-2 scrollbar-thin scrollbar-thumb-[var(--border-strong)]">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 mt-8 opacity-70">
            <div className="w-16 h-16 rounded-2xl bg-[var(--bg-surface-raised)] flex items-center justify-center mb-6 shadow-sm border border-[var(--border)]">
              <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <h3 className="text-lg font-medium text-[var(--text-primary)]">Ask anything about your sales data</h3>
            <p className="text-sm text-[var(--text-muted)] mt-2 max-w-sm">I'll explain my calculation approach and wait for your confirmation before fetching results.</p>
            <div className="flex flex-wrap gap-2 justify-center mt-6 max-w-lg">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* User message */}
            {msg.role === 'user' && (
              <div className="flex justify-end w-full">
                <div className="bg-[var(--text-primary)] text-[var(--bg-surface)] rounded-2xl rounded-tr-sm px-4 py-2.5 text-[15px] max-w-[85%] sm:max-w-[75%] shadow-sm leading-relaxed">
                  {msg.text}
                </div>
              </div>
            )}

            {/* AI message */}
            {msg.role === 'ai' && (
              <div className="flex items-start gap-3 w-full max-w-[95%] sm:max-w-[90%]">
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-[var(--bg-surface-raised)] border border-[var(--border)] flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <svg className="w-4 h-4 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                </div>

                <div className="flex-1 space-y-3 min-w-0">
                  {/* Error */}
                  {msg.error && (
                    <div className="bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl p-3.5 text-sm">
                      {msg.error}
                    </div>
                  )}

                  {/* Clarify */}
                  {msg.clarify && (
                    <div className="bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-xl p-3.5 text-sm">
                      <span className="font-semibold">Need clarification: </span>{msg.clarify}
                    </div>
                  )}

                  {/* Calculation Plan Card (shown before confirmation) */}
                  {msg.sql && msg.explanation && !msg.confirmed && (
                    <div className="bg-[var(--bg-surface)] border border-[var(--accent)] rounded-xl shadow-sm overflow-hidden">
                      {/* Plan Header */}
                      <div className="bg-[var(--bg-surface-raised)] border-b border-[var(--border)] px-4 py-3 flex items-center gap-2">
                        <svg className="w-4 h-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                        </svg>
                        <span className="text-sm font-semibold text-[var(--text-primary)]">Calculation Plan</span>
                        <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Awaiting confirmation</span>
                      </div>

                      {/* Explanation */}
                      <div className="px-4 py-3.5">
                        <p className="text-sm text-[var(--text-primary)] leading-relaxed">{msg.explanation}</p>
                      </div>

                      {/* SQL preview (collapsed/expandable optional) */}
                      <details className="border-t border-[var(--border)]">
                        <summary className="px-4 py-2 text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] select-none">
                          View generated SQL
                        </summary>
                        <pre className="px-4 pb-3 text-[12px] font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap leading-relaxed">
                          {msg.sql}
                        </pre>
                      </details>

                      {/* Actions */}
                      <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-surface-raised)]/40 flex flex-wrap gap-2 items-center">
                        <button
                          onClick={() => confirm(msg.id)}
                          className="flex items-center gap-1.5 px-4 py-2 bg-[var(--text-primary)] text-[var(--bg-surface)] rounded-lg text-[13px] font-semibold shadow-sm hover:opacity-90 transition-opacity"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/>
                          </svg>
                          Confirm & Fetch Data
                        </button>
                        <button
                          onClick={() => setShowRefine(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                          className="flex items-center gap-1.5 px-4 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[13px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                          </svg>
                          Refine
                        </button>
                      </div>

                      {/* Refine Input */}
                      {showRefine[msg.id] && (
                        <div className="px-4 pb-3 border-t border-[var(--border)] pt-3 flex gap-2">
                          <input
                            type="text"
                            value={refineInputs[msg.id] ?? ''}
                            onChange={e => setRefineInputs(prev => ({ ...prev, [msg.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') refine(msg.id); }}
                            placeholder="e.g. use net secondary instead of gross, filter to NEURO segment..."
                            className="flex-1 text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-muted)]"
                          />
                          <button
                            onClick={() => refine(msg.id)}
                            className="px-3 py-2 bg-[var(--text-primary)] text-[var(--bg-surface)] rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
                          >
                            Apply
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* After confirmation — show SQL header + results */}
                  {msg.sql && msg.confirmed && (
                    <div className="space-y-3">
                      {msg.explanation && (
                        <div className="px-3 py-2 bg-[var(--bg-surface-raised)] rounded-lg text-xs text-[var(--text-muted)] border border-[var(--border)]">
                          {msg.explanation}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => confirm(msg.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                          </svg>
                          Re-run
                        </button>
                        {msg.ran && (
                          <button
                            onClick={() => saveSql(msg.sql!)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            Save Report
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Results */}
                  {msg.ran && msg.rows && (
                    <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                      <ResultBlock rows={msg.rows} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start w-full mt-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-surface-raised)] border border-[var(--border)] flex items-center justify-center shrink-0 shadow-sm">
                <svg className="w-4 h-4 text-[var(--text-muted)] animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <div className="bg-[var(--bg-surface-raised)] text-[var(--text-secondary)] px-4 py-2.5 rounded-2xl rounded-tl-sm text-[14px] flex gap-2 items-center font-medium">
                Thinking
                <span className="flex gap-0.5 ml-1">
                  <span className="w-1 h-1 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-1 h-1 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-1 h-1 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} className="h-4 shrink-0" />
      </div>

      {/* Input Bar */}
      <div className="shrink-0 border-t border-[var(--border)] pt-4 pb-6 bg-gradient-to-t from-[var(--bg-base)] via-[var(--bg-base)] to-transparent sticky bottom-0 z-10">
        <div className="relative shadow-sm rounded-xl">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask anything about your data… (Enter to send)"
            rows={1}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl pl-4 pr-14 py-3.5 text-[15px] focus:outline-none focus:border-[var(--text-muted)] focus:ring-1 focus:ring-[var(--text-muted)] resize-none overflow-hidden max-h-[150px] shadow-sm transition-all"
            style={{ minHeight: '52px', height: input ? `${Math.min(150, Math.max(52, input.split('\n').length * 24 + 28))}px` : '52px' }}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="absolute right-2.5 bottom-[11px] p-1.5 rounded-lg bg-[var(--text-primary)] text-[var(--bg-surface)] enabled:hover:opacity-90 disabled:opacity-30 transition-all cursor-pointer shadow-sm"
          >
            <svg className="w-5 h-5 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19V5m0 0l-6 6m6-6l6 6"/>
            </svg>
          </button>
        </div>
        <p className="text-center text-[11px] text-[var(--text-muted)] mt-3">
          AI will show its calculation plan — you confirm before data is fetched.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/chat/page.tsx
git commit -m "feat: add explanation confirmation step to chat — AI shows plan before executing"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| Overall Primary/Secondary/FOC/Net Secondary + Ach% | Task 3 (OverviewTab) |
| FY-wise breakdown | Task 3 (dashOverviewFy) |
| Most sold brand (Qty + Value, 4 metrics) | Task 4 (BrandTab) |
| Most sold segment (Qty + Value, 4 metrics) | Task 5 (SegmentTab) |
| Expenses 10-row table (all 10 items) | Task 6 (ExpensesTab) |
| Primary Bifurcation (4 items) | Task 7 (PrimaryBifurcationTab) |
| Returning + expiry breakdown (5 categories) | Task 8 (ReturningTab) |
| Credit Notes shown separately | Task 8 (ReturningTab footer row) |
| Pie chart in ₹ Lakhs + % | Task 8 (custom PieChart) |
| Long Expiry = derived `above_9m` | Task 1 (SQL formula confirmed) |
| Legacy reports preserved | Task 10 (collapsible sidebar) |
| AI chat with calc transparency | Tasks 11–13 |
| Confirm / Refine flow | Task 13 (ChatPage) |

### Placeholder Scan — Clean ✅

All steps contain complete code. No "implement later" or "TBD" entries.

### Type Consistency ✅

- `Filters` imported from `@/lib/schema` in all tab components
- `useDuckDb()` returns `{ query }` — used correctly in all tabs
- `dashXxx(filters)` functions all accept `Filters` — matches usage in components
- `fmtL`, `fmtLakhs`, `fmtPct`, `fmtQty`, `fmtCount` all defined in `shared.ts` and used correctly
- `generateSqlWithExplanation` returns `{ sql?, explanation?, clarify? }` — matches Message interface

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-23-smart-dashboard-and-chat.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
