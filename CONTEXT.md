# Shomed Remedies MIS — Context for Next Agent

## What this is
Pharma analytics dashboard for Shomed Remedies. Single user (founder), no auth, hosted on Vercel free tier.

- **Next.js 16 App Router** with Turbopack (`turbopack: {}` in next.config.ts, NO webpack config)
- **DuckDB-WASM** runs entirely in browser — all SQL queries run client-side
- **Vercel Blob** stores `accumulated.csv` (the full dataset, append model) and `saved_queries.json`
- **IndexedDB** (via `idb`) caches report results locally, invalidated on new upload

## Data model
- CSV file, 75 columns, table always named `data` in DuckDB
- Key columns: `net_sales_` (net primary sales, trailing underscore), `gri_sales` (return value — NOT `return_amt`), `tgt_val_p` (primary target), `hq_new` (HQ name), `fy` (financial year e.g. `'2025-2026'`), `yyyymm` (period)
- Achievement % = `SUM(net_sales_) / NULLIF(SUM(tgt_val_p), 0) * 100`

## Key files
```
src/
  app/
    layout.tsx              — Server component, wraps in AppShell
    page.tsx                — Dashboard (KPIs + 2 charts)
    upload/page.tsx         — CSV upload + append flow
    chat/page.tsx           — NL → SQL → human verify → run
    my-reports/page.tsx     — Saved named queries
    reports/[reportId]/page.tsx — Individual report with filters, chart, SQL editor
    api/blob/read/route.ts  — GET: reads accumulated.csv from Vercel Blob via ACCUMULATED_CSV_URL env var
    api/blob/append/route.ts — POST: writes full accumulated CSV back to Vercel Blob (put, addRandomSuffix: false)
    api/blob/queries/route.ts — GET/PUT saved queries JSON
    api/nl-to-sql/route.ts  — POST: Gemini → Groq fallback, returns {sql} or {clarify}
    api/powerbi-to-sql/route.ts — POST: converts MSSQL/PowerBI SQL to DuckDB SQL
  components/
    AppShell.tsx            — Fetches /api/blob/read on load, passes CSV to DuckDbProvider; dark mode init
    Sidebar.tsx             — Nav + dark mode toggle (◑ button, toggles .dark class on <html>)
    Layout.tsx              — flex h-screen: Sidebar + main
    FilterBar.tsx           — FY/ZBM/ABM/TBM/HQ/Segment dropdowns
    ReportTable.tsx         — Sticky header, zebra rows, row count footer
    ReportChart.tsx         — Recharts: bar/line/pie/stacked-bar (returns null for table-only)
    SqlEditor.tsx           — Collapsible SQL textarea + PowerBI converter
    ExportMenu.tsx          — Excel/PDF/PNG export
    UploadZone.tsx          — Drag-drop CSV, validates columns, calls Papa.parse
    StaleBanner.tsx, KpiCard.tsx
  lib/
    duckdb.ts               — Singleton: initDuckDb, loadCsvData, runQuery
    DuckDbContext.tsx        — React context wrapping duckdb.ts; provides ready/query/reload
    persistence.ts          — IndexedDB: saveResult/loadResult + dataVersion in localStorage
    schema.ts               — 75 CSV_COLUMNS, Filters interface, parseFilters, validateCsvRow
    ai.ts                   — generateSql + convertPowerBiSql (Gemini 1.5 Flash → Groq fallback)
  reports/
    index.ts                — 27 ReportDef entries, REPORT_GROUPS (7 groups), getReport()
    group-a.ts … group-g.ts — SQL factory functions per report group
```

## Upload / append flow (HOW IT WORKS)
1. User drops CSV → `UploadZone` parses with PapaParse, validates columns
2. User clicks "Confirm & Append" in `upload/page.tsx`
3. Page fetches `GET /api/blob/read` → gets existing accumulated CSV text
4. Strips header from new CSV if existing data present, concatenates strings
5. POSTs full concatenated string to `POST /api/blob/append` as `{ accumulatedCsv: string }`
6. API calls `put('accumulated.csv', ..., { addRandomSuffix: false })` — overwrites the blob
7. `reload(accumulated)` re-loads DuckDB in browser with full dataset
8. `incrementDataVersion()` marks cached IndexedDB results stale

## Known bug — 500 on append
`POST /api/blob/append` returns 500. The `/api/blob/read` route reads from `process.env.ACCUMULATED_CSV_URL` (a hardcoded env var pointing to the blob URL). But `@vercel/blob`'s `put()` with `addRandomSuffix: false` may return a different URL each deploy or the env var may not be set locally.

**Root cause to investigate:**
- `ACCUMULATED_CSV_URL` env var is likely not set in `.env.local` — the read route returns empty string (200), upload page sees `hasExisting = false`, sends full CSV, but `put()` call itself throws because `BLOB_READ_WRITE_TOKEN` is missing or invalid locally
- OR the blob `put()` throws because the token isn't configured
- Check `.env.local` has `BLOB_READ_WRITE_TOKEN` set
- Better fix: use `@vercel/blob`'s `list()` to find the existing blob by filename instead of relying on a hardcoded URL env var

## Dark mode
- Tailwind v4: `@variant dark (&:where(.dark, .dark *))` in globals.css
- Toggle adds/removes `.dark` class on `<html>`, persists to `localStorage` key `'theme'`
- All components use CSS custom properties (`var(--accent)`, `var(--bg-surface)` etc.) via inline styles — dark mode works automatically

## Env vars needed
```
GEMINI_API_KEY=
GROQ_API_KEY=
BLOB_READ_WRITE_TOKEN=     # from Vercel Blob store
ACCUMULATED_CSV_URL=       # public URL of accumulated.csv blob (set after first upload)
QUERIES_JSON_URL=          # public URL of saved_queries.json blob (set after first save)
```

## No commits policy
User does not want git commits made by the agent.
