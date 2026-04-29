# Data Migration to Supabase Postgres — Design

**Date:** 2026-04-29
**Project:** 1 of 2 (this spec) — Data layer migration
**Companion project (later):** Project 2 — Proper RAG layer over Supabase + pgvector

## Why this exists

The chat agent's accuracy ceiling is bounded by the foundation it sits on. Today the data backend is a 58 MB CSV in Vercel Blob, loaded into DuckDB-WASM both client-side (dashboard, reports, upload) and server-side (chat agent). That model has three concrete problems that a "proper RAG" layer cannot fix:

1. The append flow re-uploads the entire concatenated CSV on every new upload — known to 500 at the current size and only gets worse.
2. Every chat cold start re-loads the full 58 MB CSV into a fresh WASM DuckDB instance (~1–2 s per cold Lambda).
3. The browser ships the 58 MB CSV to every dashboard visitor; there's no path to incremental, indexed retrieval.

Migrating to **Supabase Postgres** as the single source of truth fixes all three and unblocks Project 2 (pgvector-backed RAG over the same database).

## Goals

- Replace browser DuckDB-WASM and the `accumulated.csv` blob with a Supabase Postgres `data` table as the canonical store.
- Preserve every dashboard, report, and KPI exactly as they render today.
- Stay on Supabase free tier, accepting the 7-day auto-pause and mitigating it with one Vercel Cron.
- Deliver a clean foundation that Project 2 can layer pgvector on top of without re-architecting.

## Non-goals (deferred to Project 2)

- Enabling pgvector or building any RAG corpus (golden examples, ReportDefs, column descriptions, entity index).
- Replacing the existing tag-based golden-examples retrieval logic in `src/lib/golden-examples.ts`.
- Migrating `golden_examples.json` from Vercel Blob into Postgres.
- Cross-session chat memory.

## Architecture

```
Browser (Next.js client)
  │
  ▼  HTTPS — Server Actions (reports/dashboard) | API Route (chat SSE, upload)
Vercel Lambda (Node.js)
  │
  ▼  postgres-js, Supabase transaction pooler (port 6543), prepare:false
Supabase Postgres
  • table  data_raw (75 text cols, staging only — TRUNCATE'd after each ingest)
  • table  data     (75 typed cols, canonical, indexed)
  • extension pg_trgm (enabled day 1; used in Project 2)
```

Browser DuckDB-WASM (`src/lib/duckdb.ts`, `DuckDbContext.tsx`), the server DuckDB singleton (`src/lib/server-duckdb.ts`), and the `accumulated.csv` blob plumbing are deleted at the end of the migration.

## Schema

### `0001_init.sql`

Two tables. `data_raw` is the COPY landing zone, all 75 columns as `text` to tolerate malformed rows. `data` is the canonical typed table that every query reads from. A bigserial `id` PK is added for ergonomics (no natural key exists in the CSV).

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE data_raw (
  pts text, pp text, co text, fy text, zbm text, ...  -- all 75 cols as text
);

CREATE TABLE data (
  id bigserial PRIMARY KEY,
  pts numeric(14,2), pp numeric(14,2), co text, fy text, ...  -- typed per CSV_COLUMN_TYPES
);

CREATE INDEX idx_data_fy_period ON data (fy, yyyymm);
CREATE INDEX idx_data_hq        ON data (hq_new);
CREATE INDEX idx_data_seg       ON data (seg);
CREATE INDEX idx_data_item      ON data (item_name);
CREATE INDEX idx_data_zbm_abm   ON data (zbm, abm);
```

The five indexes cover the hot filter combos in `src/reports/group-*.ts` and `src/lib/schema.ts::parseFilters`. No primary-key constraint on raw rows beyond the synthetic `id`. No `NOT NULL` or `CHECK` constraints — CSV ingestion is fundamentally messy and we want appends to never fail mid-batch.

Numeric columns use `numeric(14,2)` to match the existing DuckDB `DOUBLE` choices without floating-point drift on currency values. Text columns include `yyyymm` (preserves leading zeros), all date-like columns (the CSV uses `/  /` as a sentinel), and all categoricals.

## Data access layer

New file `src/lib/db.ts`:

```ts
import postgres from 'postgres';
const sql = postgres(process.env.SUPABASE_DB_URL!, {
  max: 1,
  idle_timeout: 20,
  prepare: false,
});
export default sql;
```

- Driver: **`postgres` (postgres-js by Porsager)** — ~12 KB, no ORM, native COPY, tagged-template parameterization.
- `prepare: false` is mandatory because Supabase's transaction-mode pooler does not preserve session state between queries.
- `max: 1` is correct for serverless: one connection per warm Lambda. The pooler handles the rest.

### Transport split

| Surface | Transport | Why |
|---|---|---|
| Dashboard, reports, my-reports | **Server Actions** | type-safe, ergonomic `await runReport(...)` from client components |
| Chat agent | **API Route** (`/api/chat`) | SSE streaming, already exists |
| Upload ingest | **API Route** (`/api/data/ingest`) | streams a large body from Vercel Blob into Postgres COPY |
| Health check | **API Route** (`/api/health`) | Vercel Cron target, runs `SELECT 1` |

### Env vars

Added:
```
SUPABASE_DB_URL=postgresql://postgres.<project_ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

That is the only new variable needed. We talk to Postgres directly; PostgREST (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE`) is unused.

Removed eventually (after cutover): `ACCUMULATED_CSV_URL`. Kept: `BLOB_READ_WRITE_TOKEN` (still used by `golden_examples.json` and as upload staging).

## Upload flow

The 58 MB CSV is over Vercel's 4.5 MB function body limit, so Vercel Blob remains a staging surface and we add a Postgres ingest step:

1. Client `UploadZone` parses + validates columns with PapaParse (unchanged).
2. Client requests a signed token from `api/blob/upload-token` (unchanged).
3. Client uploads CSV directly to Vercel Blob (unchanged).
4. Client POSTs `{ blobUrl }` to a new `POST /api/data/ingest`.
5. Server fetches the blob URL as a stream and pipes it through the **two-stage ingest** (next section).
6. After successful ingest, server deletes the staging blob.
7. Server responds `{ rowsAdded, totalRows }`. Client clears IndexedDB cache via existing `incrementDataVersion()`.

The append model becomes truly incremental: COPY only the new file's rows. The current "fetch accumulated.csv → concat → re-upload" sequence disappears. Routes deleted: `api/blob/append`, `api/blob/read`, `api/blob/copy-public`. (Verify `api/blob/url` is unreferenced before deleting.)

Idempotency / dedup is out of scope; user remains responsible for not re-uploading the same file.

## Two-stage CSV ingest pipeline

Postgres `COPY` aborts the entire batch if any row fails to parse. DuckDB's `TRY_CAST + ignore_errors=true` silently NULLs bad cells. We replicate that semantic with a staging table:

```sql
-- inside one transaction in /api/data/ingest
TRUNCATE data_raw;

COPY data_raw (pts, pp, co, fy, ...)  -- explicit column list
FROM STDIN
WITH (FORMAT csv, HEADER true, NULL '');

INSERT INTO data (pts, pp, co, fy, ...)
SELECT
  CASE WHEN pts        ~ '^-?[0-9]+(\.[0-9]+)?$' THEN pts::numeric        END,
  CASE WHEN pp         ~ '^-?[0-9]+(\.[0-9]+)?$' THEN pp::numeric         END,
  co,
  fy,
  ...
FROM data_raw;

TRUNCATE data_raw;
```

The `CASE WHEN ... ~ regex THEN ::numeric END` returns NULL for non-numeric cells without aborting. Text columns pass through verbatim. The transaction wraps the three steps so a partial failure leaves no orphan staging rows.

Adds ~3 s to ingest beyond a single COPY. Total time for the 58 MB / 129K rows: ~10 s end-to-end.

## Reports/dashboard rewrite

The 27 ReportDef SQL strings in `src/reports/*.ts` use only `SUM`, `ROUND`, `NULLIF`, `GROUP BY`, `ORDER BY`, `WHERE` — every function and idiom is identical between DuckDB and Postgres. They ship to Postgres unchanged.

### `parseFilters` refactor (security upgrade)

`src/lib/schema.ts::parseFilters` currently composes `\`fy = '${filters.fy}'\`` via string concatenation. SQL injection is real today — only the single-trusted-user model masks it. The refactor:

```ts
// Before:  WHERE fy = '${filters.fy}' AND zbm = '${filters.zbm}'
// After:   { text: "WHERE fy = $1 AND zbm = $2", params: [filters.fy, filters.zbm] }
```

Each ReportDef switches from `(filters) => string` to `(filters) => { text: string, params: unknown[] }`. The server action calls `sql.unsafe(text, params)`. ~1 hour of mechanical edits, blocks all subsequent report ports.

### Server actions for reports/dashboard

New `src/app/reports/actions.ts`:

```ts
'use server';
import sql from '@/lib/db';
import { getReport } from '@/reports';
export async function runReport(id: string, filters: Filters) {
  const def = getReport(id);
  if (!def) throw new Error('unknown report');
  const { text, params } = def.sql(filters);
  return sql.unsafe(text, params);
}
```

Each report page swaps `useDuckDb().query(...)` for a `useEffect` that calls the server action. IndexedDB caching via `src/lib/persistence.ts` keeps working — only the data source behind it changes.

### Dashboard server-component conversion

`src/app/page.tsx` becomes a Server Component that awaits its data directly. The current "fetch CSV → load DuckDB → run KPIs" client-side dance disappears. Removes the loading banner on first paint. `AppShell.tsx` shrinks to a thin layout that doesn't pre-fetch anything.

### Chat agent migration

`src/lib/agent/loop.ts` and `src/app/api/chat/route.ts` swap `getServerDb()` for `import sql from '@/lib/db'`. The `ServerDb` interface (`runSafe`, `runTrusted`, `dictionary`, `dataVersion`) gets replaced by a thin wrapper around `sql` that exposes the same surface. `src/lib/server-duckdb.ts` is deleted.

Data dictionary computation (currently in `buildDataDictionary`) ports to a single Postgres query:

- `REGEXP_EXTRACT(item_name, '^[A-Za-z][A-Za-z0-9]*', 0)` → `substring(item_name from '^[A-Za-z][A-Za-z0-9]*')`.

Dictionary is computed once per warm Lambda on first chat call and cached in module scope (same lifecycle as today).

## SQL flavor gotchas (exhaustive list)

| DuckDB | Postgres | Where it appears |
|---|---|---|
| `REGEXP_EXTRACT(s, pat, 0)` | `substring(s from pat)` | `server-duckdb.ts::buildDataDictionary` (file deleted; logic ports into the new dictionary builder) |
| `TRY_CAST(x AS DOUBLE)` | `CASE WHEN x ~ '^-?[0-9]+(\.[0-9]+)?$' THEN x::numeric END` | CSV ingest only (two-stage pipeline) |
| `read_csv(...)` | `COPY data_raw FROM STDIN` | CSV ingest only |
| Implicit `numeric ⟵ text` cast | Explicit `::numeric` | None — every report aggregates already-typed columns |

That is the entire flavor delta.

## Bootstrap (one-time, day 1)

1. Take a screenshot of the live dashboard for parity verification.
2. Create the Supabase project at dashboard.supabase.com (free tier).
3. From a local shell: `psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_init.sql`. Creates tables, indexes, enables `pg_trgm`.
4. Add `SUPABASE_DB_URL` to `.env.local` and to Vercel Project Settings → Environment Variables.
5. Deploy the migrated branch.
6. Drag the existing `Finaldata_stru.csv` into `/upload`. Two-stage COPY ingests in ~10 s.
7. Compare the live dashboard against the screenshot from step 1.
8. Run the parity check (see verification gate below).

## Auto-pause mitigation

Vercel Hobby allows 2 free Cron Jobs. Add `vercel.json`:

```json
{ "crons": [{ "path": "/api/health", "schedule": "0 9 * * 1" }] }
```

Plus a tiny `/api/health` route that does `await sql\`SELECT 1\`` and returns `{ ok: true, ts }`. Mondays 9 AM keeps the project warm. If skipped (e.g. vacation), first request after a 7-day idle pause takes 30–60 s — no data loss.

## Testing strategy

| Layer | Today | After migration |
|---|---|---|
| `parseFilters` unit | DB-agnostic | unchanged signature; assert new `{ text, params }` shape |
| Report SQL (group-a..g, dashboard) | runs against in-memory DuckDB seeded from a fixture CSV | runs against **testcontainers** Postgres seeded from same fixture (one-line change in Jest globalSetup) |
| Chat agent loop (`loop.test.ts`) | mocks `db.runSafe` | mocks the `sql` tagged template — same shape, simpler |
| Upload ingest | n/a | new test: 50-row malformed fixture through the staging→typed pipeline; assert bad cells become NULL not failures, row count matches |

`testcontainers-node` spins up `postgres:16-alpine` per test suite (~2 s cold). Matches CI exactly. Existing `groups-b-g.test.ts` and `group-a.test.ts` swap their setup but body assertions stay identical.

## Verification gate

Before deleting `src/lib/duckdb.ts` and friends, run a parity check:

- New `scripts/parity-check.ts` runs every dashboard query and every ReportDef on both engines (browser DuckDB still works pre-deletion) against the current CSV.
- Sorts both result sets, diffs them.
- Tolerance: numeric values match to 2 decimals (existing `ROUND(...,2)` enforces this).
- Any non-trivial diff blocks deletion of the DuckDB code.

## Rollback plan

If Supabase has an outage or numbers diverge post-cutover:

1. `git revert` the cutover commit, redeploy → app talks to DuckDB-WASM again.
2. Pre-condition: in `/api/data/ingest`, do **not** delete the `accumulated.csv` blob until 30 days post-cutover. The staging blob is the rollback safety net during the verification window.

After the 30-day window, the ingest route deletes the staging blob immediately on success.

## Sizing budget (free-tier headroom)

- Current `data` table: 129K rows × 75 cols, ~80 MB raw + ~50 MB indexes ≈ **130 MB**.
- `data_raw` at rest: ~0 MB (TRUNCATE'd after each ingest).
- Free tier cap: 500 MB → roughly **2–3× growth runway** before paid tier ($25/mo Pro).
- At ~10–20% monthly growth → **12–18 months** runway.
- Monthly egress: aggregations are small (KPIs, charts), single-user traffic — well under the 5 GB/mo free cap.

Add a disk-usage probe to `/api/health` in Project 2 if a guardrail is wanted.

## Files touched

### New

- `src/lib/db.ts` — postgres-js singleton.
- `src/app/reports/actions.ts` — server actions wrapping ReportDefs.
- `src/app/api/data/ingest/route.ts` — two-stage CSV ingest.
- `src/app/api/health/route.ts` — Cron target.
- `supabase/migrations/0001_init.sql` — schema + indexes + extensions.
- `scripts/parity-check.ts` — DuckDB vs Postgres parity diff.
- `vercel.json` — Cron config.

### Modified

- `src/lib/schema.ts` — `parseFilters` returns `{ text, params }`; ReportDef contracts updated.
- `src/reports/*.ts` — ReportDef function signature updated; SQL strings unchanged.
- `src/app/page.tsx`, `src/app/reports/[reportId]/page.tsx`, `src/app/my-reports/page.tsx` — swap `useDuckDb` for server-action calls.
- `src/components/AppShell.tsx` — strip CSV pre-fetch; thin layout.
- `src/components/UploadZone.tsx` + `src/app/upload/page.tsx` — POST to `/api/data/ingest` instead of the old append flow.
- `src/lib/agent/loop.ts`, `src/app/api/chat/route.ts` — depend on `lib/db.ts` instead of `getServerDb()`.

### Deleted

- `src/lib/duckdb.ts`, `src/lib/DuckDbContext.tsx`, `src/lib/server-duckdb.ts`.
- `src/app/api/blob/append/route.ts`, `src/app/api/blob/read/route.ts`, `src/app/api/blob/copy-public/route.ts`.
- `src/app/api/blob/url/route.ts` (after verifying no references).
- The `accumulated.csv` blob (after the 30-day rollback window).

## Open questions

None at the time of writing. All design decisions (decomposition, Approach A, server actions vs API routes split, two-stage ingest) are locked in.

## What unblocks Project 2

After this ships:

- Postgres is live and indexed.
- `pg_trgm` is enabled.
- The chat agent already talks to Postgres via `sql`.
- A clean `lib/db.ts` is the single insertion point for adding pgvector queries.

Project 2 then layers `0002_pgvector_and_rag.sql`, an embedding pipeline, and hybrid retrieval with no further re-architecting.
