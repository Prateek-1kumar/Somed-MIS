# UI Redesign — Design

**Date:** 2026-04-30
**Project:** UI polish across the Shomed Remedies MIS app
**Predecessors:** `2026-04-29-data-migration-supabase-design.md` (Postgres migration), `2026-04-29-rag-design.md` (RAG layer) — both shipped.

## Why this exists

The current UI works but has three concrete problems:

1. **First-render flashes "0"** for every numeric KPI. State initializes to `useState<Record<string, number>>({})` and reads `Number(kpis[k] ?? 0)`, so the dashboard shows "₹0" / "0%" before data arrives. Users have read this as "no data" / "broken".
2. **No skeleton loaders.** The current `loading` flag triggers a small "Loading…" text — the rest of the UI still renders with empty state. Reads as broken on slow connections.
3. **Visual feels developer-tool, not product.** The Zinc-on-Zinc monochrome with hand-rolled SVG icons and inline `style={{}}` cards is functional but austere. The user has asked for "more user-friendly" and "way too much better".

This project redesigns the visual layer (palette, typography, spacing, component library, loading + empty states) across six page surfaces: Dashboard, Chat, Learned Patterns, My Reports, Upload, plus the global Sidebar.

## Goals

- Replace every `useState({})`-default-zero pattern with skeleton-first rendering. Never flash "0" on first load.
- Adopt a single brand accent (emerald) carried through CTAs, focus rings, active nav, "verified" pills, and chart highlights.
- Migrate every data-fetching tab to a `useDataFetch` hook that exposes `isFirstLoad`, `isRefetching`, and `error` separately — Loading Policy C (skeleton-first, dim-on-refilter).
- Honest empty states: when filters return zero rows, render `<EmptyState>` with a "Reset filters" action — not a blank screen.
- Honest error states: failed fetches render `<ErrorBanner>` with a "Retry" action — not a silent fallback to zero.
- Stay on existing tech (Next.js 16, Tailwind v4, Recharts, lucide-react). One new dep: `react-markdown`.
- Light + dark mode both supported.

## Non-goals (deferred)

- Syntax-highlighted SQL (Shiki, Prism). Plain monospace + copy button is sufficient.
- Animation library (Framer Motion). Tailwind transitions cover what we need.
- Custom `<Select>` component to replace native `<select>`. Native is accessible and styled enough.
- `/reports/[reportId]` legacy detail page. Per scoping question 4, the user prefers chat long-term and does not want polish here.
- Onboarding tour / tooltips. Out of scope.
- Mobile reflow of Recharts. Recharts handles this on its own.
- Visual-regression test suite (screenshot diffs). Manual smoke is the gate.

## Stack constraints (fixed)

- Next.js 16 App Router with Turbopack.
- Tailwind v4 (CSS variables for theme tokens).
- React 19.
- `lucide-react` already installed; use these icons exclusively.
- `recharts` already installed; only the color palette changes.
- `@testing-library/react` + Jest available for the new component tests.

## Decision summary (locked in via brainstorming on 2026-04-30)

| Question | Decision |
|---|---|
| Aesthetic direction | **B — color + personality.** Same monochrome base, single brand accent, softer surface, polished components. Reads "Stripe / Vercel" rather than "Linear / dev tool". |
| Brand accent | **Emerald** — `#059669` light, `#34d399` dark. Already in tokens as `--success`. |
| Loading policy | **C — skeleton-first, dim-on-refilter.** First load shows skeleton; refilters dim existing values to ~50% opacity + show a small spinner top-right. |
| Scope | All six surfaces in scope (Dashboard, Chat, Learned Patterns, My Reports, Upload, Sidebar). **Skip `/reports/[reportId]`.** Light + dark both supported. |
| Skeleton primitive | One reusable `<Skeleton>` (10 lines) plus per-shape composed skeletons. Tailwind `animate-pulse`, no JS. |
| Markdown rendering in chat | `react-markdown` (~5 KB gz) restricted to bold / italic / lists / inline-code. No HTML. |

## Visual language

### Palette additions (light + dark)

```css
:root {
  /* Existing zinc neutrals stay. */
  --accent:        #059669;   /* emerald-600 */
  --accent-hover:  #047857;   /* emerald-700 */
  --accent-light:  #d1fae5;   /* emerald-100 */
  --accent-soft:   #ecfdf5;   /* emerald-50  */
}
.dark {
  --accent:        #34d399;   /* emerald-400 */
  --accent-hover:  #6ee7b7;
  --accent-light:  #064e3b;   /* emerald-900 */
  --accent-soft:   #022c22;
}
```

The current `--accent: #18181b` (almost-black) gets repurposed semantically as `--text-primary`, where it already belongs.

### Shadow tokens

```css
--shadow-card:        0 1px 2px rgb(0 0 0 / 0.04), 0 0 0 1px var(--border);
--shadow-card-hover:  0 4px 12px rgb(0 0 0 / 0.06), 0 0 0 1px var(--border-strong);
--shadow-popover:     0 8px 24px rgb(0 0 0 / 0.10);
```

Static cards (KPIs) use `--shadow-card`. Interactive cards (My Reports, Learned Patterns rows) lift to `--shadow-card-hover` on hover.

### Typography rhythm

| Token | Use |
|---|---|
| `text-3xl font-bold tracking-tight` | Page titles ("Dashboard", "Chat with your data") |
| `text-xl font-semibold` | Section headings ("FY-Wise Sales Trend") |
| `text-base` | Body |
| `text-sm` | Secondary info, table cells |
| `text-xs uppercase tracking-wider font-semibold text-muted` | KPI labels, table headers |
| `font-mono text-xs` | SQL, IDs |

Numbers get `font-feature-settings: 'tnum'` (tabular numbers) so column alignment is consistent.

### Spacing rhythm

Cards: `p-6`. Dashboard tab content gap: `gap-6`. KPI grid keeps 6-column on `lg`, 3 on `sm`, 2 on mobile, with `min-height: 100px` per card so values feel substantial.

## Loading + empty + error primitives

### `<Skeleton>` base (10 lines)

```tsx
// src/components/ui/Skeleton.tsx
export function Skeleton({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--bg-surface-raised)] ${className}`}
      aria-hidden
      {...props}
    />
  );
}
```

### Composed skeletons

```tsx
// src/components/ui/skeletons.tsx
export const KpiCardSkeleton = () => (
  <div className="rounded-xl border bg-[var(--bg-surface)] p-5 shadow-card space-y-3">
    <Skeleton className="h-3 w-24" />
    <Skeleton className="h-8 w-32" />
    <Skeleton className="h-3 w-20" />
  </div>
);

export const ChartSkeleton = ({ height = 280 }: { height?: number }) => (
  <div className="rounded-xl border bg-[var(--bg-surface)] p-5 shadow-card">
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
        {[0, 1, 2, 3, 4].map(c => <Skeleton key={c} className="h-3" style={{ opacity: 1 - r * 0.07 }} />)}
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
```

### `useDataFetch` hook

```tsx
// src/lib/hooks/useDataFetch.ts
export function useDataFetch<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
): { data: T | null; isFirstLoad: boolean; isRefetching: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [isFirstLoad, setFirst] = useState(true);
  const [isRefetching, setRefetch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data === null) setFirst(true); else setRefetch(true);
    setError(null);
    fetcher()
      .then(d => setData(d))
      .catch(e => setError(String(e)))
      .finally(() => { setFirst(false); setRefetch(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, isFirstLoad, isRefetching, error };
}
```

Callsite pattern (from `OverviewTab.tsx` after migration):

```tsx
const { data, isFirstLoad, isRefetching, error } = useDataFetch(
  () => Promise.all([
    runDashboardQuery('overviewKpis', filters),
    runDashboardQuery('overviewFy', filters),
  ]),
  [JSON.stringify(filters)],
);

if (error)               return <ErrorBanner error={error} />;
if (isFirstLoad || !data) return <OverviewSkeleton />;

return (
  <div className={`relative transition-opacity ${isRefetching ? 'opacity-60' : ''}`}>
    {isRefetching && (
      <Loader2 className="absolute top-2 right-2 w-4 h-4 animate-spin text-[var(--text-muted)]" />
    )}
    {/* … real content using data … */}
  </div>
);
```

`Loader2` is a lucide icon; the spinner is just `<Loader2 className="animate-spin" />` — no separate component needed.

### Zero-handling rules

| State | Render |
|---|---|
| First load, no data yet | Skeleton |
| Data arrived, real value is 0 | Show `0` (or `₹0` / `0%`) — meaningful in sales context |
| Data arrived, value is missing | `—` (em dash) |
| Refilter in progress | Existing values dimmed to 60% opacity + spinner top-right |
| Error | `<ErrorBanner>` + retry |
| No rows for filter combination | `<EmptyState>` with "Reset filters" action |

`fmtL` / `fmtPct` / `fmtQty` gain a `whenMissing` option so callers can pass `'—'` for missing vs `'₹0'` for real-zero.

### `<ErrorBanner>` and `<EmptyState>`

```tsx
// src/components/ui/ErrorBanner.tsx
export const ErrorBanner = ({ error, onRetry }: { error: string; onRetry?: () => void }) => (
  <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
    <div className="flex-1">
      <p className="font-semibold text-red-700 dark:text-red-300">Something went wrong</p>
      <p className="text-sm text-red-600 dark:text-red-400 mt-1">{error}</p>
      {onRetry && <button onClick={onRetry} className="mt-2 text-sm font-medium underline">Retry</button>}
    </div>
  </div>
);

// src/components/ui/EmptyState.tsx
export const EmptyState = ({
  icon, title, description, action,
}: {
  icon: ReactNode; title: string; description: string; action?: ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
    <div className="w-12 h-12 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mb-4">
      {icon}
    </div>
    <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
    <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">{description}</p>
    {action && <div className="mt-6">{action}</div>}
  </div>
);
```

## Page-by-page changes

### Sidebar (`src/components/Sidebar.tsx`)

| Element | Today | After |
|---|---|---|
| Logo block | Black "S" tile + "Shomed Remedies MIS" two-liner | Emerald "S" tile + same text. Width fixed at 256 px (was 288). |
| Active link state | `bg-surface-raised` + `ring-1` | `bg-accent-light` + `text-accent` + 3 px left border in `--accent`. |
| Nav icons | Hand-rolled inline SVGs | Lucide icons (`LayoutDashboard`, `MessageCircle`, `BookOpen`, `Folder`, `Upload`). |
| Theme toggle | Always-on moon icon | Sun/Moon icon swap based on current theme; tooltip. |
| User profile footer | "User Profile" placeholder | Hide. It's fake; clutter. |
| Mobile | Doesn't collapse | Hamburger for `< 768px` slides sidebar over content (overlay). `aria-modal` + escape-key listener. |

### Dashboard (`src/app/page.tsx` + `src/components/dashboard/*Tab.tsx`)

| Change | Detail |
|---|---|
| Migrate to `useDataFetch` | Six tabs each replace `useState({})` + manual `setLoading` with the hook. `n('primary_sales')` defaulting to `0` is gone. |
| First load | Renders `OverviewSkeleton` / `BrandSkeleton` / etc. |
| Refilter | Existing data dims to 60% opacity + spinner top-right; values update in place when ready. |
| Page header | Replace "Shomed Remedies MIS / Executive Dashboard" with single-line `Dashboard` (h1) + filters as a sticky toolbar. |
| Filter bar | Keep native `<select>` for now (accessibility + zero-dep); polish styling. |
| KPI grid | Uses redesigned `KpiCard`. 6 cards on `lg`, 3 on `sm`, 2 on mobile. |
| Tabs | Horizontal tabs with new emerald active-underline. |
| Charts | Wrapped in card with header + small "ⓘ" tooltip explaining what's plotted. Uses new `ReportChart` palette. |
| Tables | Stripe alternation (`even:bg-bg-base`), hover row, sticky header, `tabular-nums`. |
| Empty filter result | If `data.fyRows.length === 0`, render `<EmptyState>` with "No data for this filter combination" + "Reset filters" action. |

### Chat (`src/app/chat/page.tsx`)

| Element | Change |
|---|---|
| Header | Smaller; one-line. Subtle "Press / to focus" hint. |
| Empty state | Replace bespoke icon + 4 chips with `<EmptyState>` + 2×2 grid of suggestions. |
| Streaming trace | Pre-streaming: `<MessageSkeleton />`. After streaming ends, trace collapses to "1 step / 2 steps · click to expand". |
| User bubble | `bg-accent` (emerald) for user bubble. |
| Agent avatar | Emerald-light tile with "S" mark. |
| HITL bar | Emoji glyphs (✓ ✎ 🚩) → Lucide (`Check`, `Edit3`, `Flag`). |
| Clarification card | Keep amber palette; new `shadow-card` lift. |
| AnswerCard SQL block | New `<CodeBlock>` (monospace + copy button). |
| Markdown narrative | Wrap in `<Markdown>` (react-markdown, restricted to bold/italic/lists/inline-code). |
| Input bar | `/` keyboard shortcut focuses textarea; "Enter to send · Shift+Enter for newline" hint. |
| Scroll-to-latest | Floating button bottom-right when scrolled up. |
| Stale-data banner | New emerald-light bg; clearer "Start fresh" emerald button. |

### Learned Patterns (`src/app/learned-patterns/page.tsx`)

| Element | Change |
|---|---|
| Page header | "Learned Patterns" h1 + subtitle "Verified Q→SQL pairs the chat agent has learned from your team." |
| Filter row | Search input + `verified / corrected / all` segmented control + sort dropdown. Sticky on scroll. |
| Empty state | If 0 examples, `<EmptyState>` with brain icon + "No learned patterns yet" + "Verify a chat answer to start teaching the system" CTA → `/chat`. |
| Loading state | List skeleton (5 row-shaped placeholders) on first load. |
| Each pattern | Card-per-row instead of dense table: question (bold), SQL collapsed by default, `verified ✓` / `corrected ⚠` pill in `--accent` / `--warning`, used count + date in muted footer, hover lifts. |
| Tag chips | Drop the chip rendering — `question_tags` is always `[]` after the RAG migration. Filter by question text + SQL only. |
| Un-verify button | Lucide `Trash2` icon; inline "Are you sure?" instead of `confirm()`. |

### My Reports (`src/app/my-reports/page.tsx`)

| Element | Change |
|---|---|
| Page header | "My Reports" h1 + subtitle |
| Empty state | If 0 saved reports, `<EmptyState>` "No saved reports yet" + "Create one from the chat" CTA → `/chat` |
| List | Card grid (2-column on `lg`, 1-column on mobile). Each card: title, last-run time, mini chart preview (re-render saved SQL). Click → opens the report. |
| Skeleton | 4 card-skeletons on first load. |

### Upload (`src/app/upload/page.tsx`)

| Element | Change |
|---|---|
| Page header | "Upload Data" h1 + "Append a CSV. Existing rows for the same yyyymm period will be replaced." |
| Drop zone | Increase dotted border thickness; emerald hover state when file is dragged over. |
| Validation feedback | Replace plain `<p>` errors with `<ErrorBanner>`. |
| Progress | Real progress + step indicator: "Validating columns…" → "Uploading to staging…" → "Ingesting into database…" → "Done · 12,453 rows added". |
| After success | Success card with "View dashboard" CTA. |

## Component library updates

### `KpiCard.tsx` (rewrite)

```tsx
interface Props {
  label: string;
  value: string;            // formatted; '—' for missing
  sub?: string;
  alert?: boolean;
  accent?: boolean;         // highlight critical KPI
}
export default function KpiCard({ label, value, sub, alert, accent }: Props) {
  const valueClass = alert
    ? 'text-red-600 dark:text-red-400'
    : accent
      ? 'text-[var(--accent)]'
      : 'text-[var(--text-primary)]';
  return (
    <div className="rounded-xl border bg-[var(--bg-surface)] p-5 shadow-card hover:shadow-card-hover transition-shadow">
      <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-bold leading-none tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-2">{sub}</p>}
    </div>
  );
}
```

### `ReportChart.tsx`

Replace existing palette with `[var(--accent), '#6366f1', '#f59e0b', '#ef4444']` (emerald + indigo + amber + red, in that order for multi-series). Tooltip + legend get the new typography. No structural changes.

### `ReportTable.tsx`

- Stripe alternation: `even:bg-[var(--bg-base)]`
- Row hover: `hover:bg-[var(--bg-surface-raised)]`
- Cell padding: `px-4 py-2.5`
- Numeric cells: `tabular-nums`
- Sticky header on scroll

### `AnswerCard.tsx` (chat)

- SQL block uses new `<CodeBlock>` (monospace + copy button)
- Narrative wraps in `<Markdown>` (react-markdown, restricted nodes)

### `<CodeBlock>` (new)

```tsx
// src/components/ui/CodeBlock.tsx
import { Copy } from 'lucide-react';
export function CodeBlock({ code, language = 'sql' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="font-mono text-xs bg-[var(--bg-base)] border rounded-lg p-3 overflow-x-auto">
        <code>{code}</code>
      </pre>
      <button
        onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--bg-surface)] border"
        title="Copy"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
      {copied && <span className="absolute top-2 right-10 text-xs text-[var(--accent)]">Copied</span>}
    </div>
  );
}
```

### `<Markdown>` (new, thin wrapper)

```tsx
// src/components/ui/Markdown.tsx
import ReactMarkdown from 'react-markdown';
const ALLOWED = ['p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'br'];
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      allowedElements={ALLOWED}
      unwrapDisallowed
      components={{
        p:    p => <p className="leading-relaxed">{p.children}</p>,
        code: c => <code className="font-mono text-xs px-1 py-0.5 rounded bg-[var(--bg-surface-raised)]">{c.children}</code>,
        ul:   u => <ul className="list-disc list-inside space-y-1">{u.children}</ul>,
        ol:   o => <ol className="list-decimal list-inside space-y-1">{o.children}</ol>,
      }}
    >{children}</ReactMarkdown>
  );
}
```

## Phasing

Each phase is independently mergeable + reversible.

| Phase | Scope |
|---|---|
| **1 — Tokens + primitives** | `globals.css` palette additions; `src/components/ui/*`; `useDataFetch` hook; `react-markdown` install; `format.ts` extension. **No visible page changes yet.** |
| **2 — Sidebar** | Lucide icons; emerald active state; mobile hamburger; drop user-profile footer. |
| **3 — Dashboard** | All 6 tabs migrate to `useDataFetch` + skeletons. New `KpiCard`, `ReportChart` palette, `ReportTable` polish. Empty state on zero rows. |
| **4 — Chat** | New empty state, streaming skeleton, markdown narrative, `<CodeBlock>` SQL, lucide HITL icons, `/` shortcut, scroll-to-latest. |
| **5 — Learned Patterns + My Reports + Upload** | Each gets header, empty state, skeleton, card list. Upload gets progress steps. |
| **6 — Manual smoke + light/dark pass** | Walk through each page in both themes; fix any token mismatch; confirm mobile. |

## Testing strategy

| Layer | What's covered |
|---|---|
| Existing test suite (139 tests) | Stays green after each phase. Acts as the regression guard for non-UI behavior. |
| Component unit tests | `Skeleton`, `EmptyState`, `ErrorBanner`, `useDataFetch`. Verify render shape; no behavior. Run via `@testing-library/react`. |
| Manual smoke (Phase 6) | The user, browsing the dev server, is the visual reviewer. No screenshot tests — too brittle for polish work. |

## File inventory

### New

| Path | Purpose |
|---|---|
| `src/components/ui/Skeleton.tsx` | Base 10-line primitive |
| `src/components/ui/skeletons.tsx` | KpiCard / Chart / Table / Message / Sidebar / Overview skeletons |
| `src/components/ui/ErrorBanner.tsx` | Error + retry primitive |
| `src/components/ui/EmptyState.tsx` | Centered empty-state primitive |
| `src/components/ui/CodeBlock.tsx` | Monospace + copy button |
| `src/components/ui/Markdown.tsx` | Thin react-markdown wrapper |
| `src/lib/hooks/useDataFetch.ts` | `firstLoad` / `refetching` hook |
| `src/components/ui/Skeleton.test.tsx` | Component unit test |
| `src/components/ui/EmptyState.test.tsx` | Component unit test |
| `src/lib/hooks/useDataFetch.test.ts` | Hook unit test |

### Modified

| Path | Change |
|---|---|
| `src/app/globals.css` | Emerald accent + shadow tokens (light + dark) |
| `src/components/Sidebar.tsx` | Lucide icons; emerald active; mobile hamburger; drop user-profile footer |
| `src/components/AppShell.tsx` | Mobile sidebar toggle wiring |
| `src/components/KpiCard.tsx` | Tailwind classes; tabular-nums; accent variant |
| `src/components/ReportChart.tsx` | New emerald-led color palette |
| `src/components/ReportTable.tsx` | Stripe; hover; tabular-nums; sticky header |
| `src/components/StaleBanner.tsx` | Emerald-light bg; new shadow |
| `src/lib/format.ts` | `whenMissing` option |
| `src/app/page.tsx` | Sticky filter toolbar; new header; emerald tabs |
| `src/components/dashboard/OverviewTab.tsx` | Migrate to `useDataFetch` + `OverviewSkeleton` |
| `src/components/dashboard/BrandTab.tsx` | Same |
| `src/components/dashboard/SegmentTab.tsx` | Same |
| `src/components/dashboard/ExpensesTab.tsx` | Same |
| `src/components/dashboard/PrimaryBifurcationTab.tsx` | Same |
| `src/components/dashboard/ReturningTab.tsx` | Same |
| `src/app/chat/page.tsx` | Empty state, streaming skeleton, markdown, code block, lucide HITL, `/` shortcut, scroll-to-latest |
| `src/components/chat/AnswerCard.tsx` | `<CodeBlock>` for SQL; `<Markdown>` for narrative |
| `src/components/chat/StreamingTrace.tsx` | Tighter typography; tool-name pill; collapsed-by-default |
| `src/app/learned-patterns/page.tsx` | Header; empty state; skeleton; card list; drop tag chips |
| `src/app/my-reports/page.tsx` | Header; empty state; card grid; skeleton |
| `src/app/upload/page.tsx` | Header; emerald drop-zone; ErrorBanner; progress steps; success card |
| `src/components/UploadZone.tsx` | Match new drop-zone aesthetic |
| `package.json` | `+ react-markdown` |

### Deleted

None. (Hand-rolled SVGs in `Sidebar.tsx` are replaced inline; no separate icon files exist.)

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Emerald accent clashes with red `--danger` in alerts | Tested on Linear / GitHub; emerald-600 + red-500 is a known-good pair. Verify in Phase 6. |
| `useDataFetch` stale-closure bugs | Use `JSON.stringify(filters)` as dep key in callsites. Hook tests cover the basic shape. |
| `react-markdown` renders something dangerous | Pin to `allowedElements` list; no HTML. Agent narrative is constrained anyway. |
| Mobile sidebar overlay traps focus | `aria-modal` + escape-key listener; ~12 lines. |
| Recharts color migration breaks readability for color-blind users | Emerald + indigo + amber + red is a tested palette. Add line-style differentiation if a chart has > 4 series (rare). |
| KpiCard rewrite changes alignment | Take screenshot before Phase 3; visual-diff after. User's manual eyeball is the gate. |
| Dark mode emerald (`#34d399`) feels too saturated | Tunable in Phase 1; revisit in Phase 6. |
| `react-markdown` adds bundle size | ~5 KB gz. Acceptable. |

## Sizing impact

- **Files touched:** 10 new, ~22 modified.
- **LoC delta:** ~+800 / −200 net.
- **Bundle:** +5 KB gz (`react-markdown`).
- **Test count:** ~10 new component tests; existing 139 stay green.
- **Dependencies added:** 1 (`react-markdown`).

## Open questions

None — all design decisions locked in via brainstorming on 2026-04-30. Implementation can proceed straight into the writing-plans phase once this spec is approved.
