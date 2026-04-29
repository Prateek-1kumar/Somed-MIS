// Smoke test for every dashboard query and every ReportDef against the live
// Postgres database. Run after applying 0001_init.sql and ingesting a CSV.
//
// Use as the gate before deleting src/lib/duckdb.ts and src/lib/server-duckdb.ts:
// any non-zero row count + no SQL errors means the queries port cleanly. Eyeball
// a few KPIs (primary_sales, achievement_pct) against the old dashboard's
// pre-cutover numbers to confirm semantics match.
//
// Usage:
//   SUPABASE_DB_URL="postgresql://..." npx tsx scripts/parity-check.ts
//   SUPABASE_DB_URL="postgresql://..." npx tsx scripts/parity-check.ts --filters fy=2025-2026

import postgres from 'postgres';
import { Filters } from '../src/lib/schema';
import { REPORTS } from '../src/reports';
import {
  dashOverviewKpis,
  dashOverviewFy,
  dashBrand,
  dashSegment,
  dashExpenses,
  dashPrimaryBifurcation,
  dashPrimaryBifurcationFy,
  dashReturning,
} from '../src/reports/dashboard';

interface Result {
  label: string;
  rowCount: number;
  durationMs: number;
  error?: string;
  sample?: Record<string, unknown>;
}

function parseFilterArg(): Filters {
  const idx = process.argv.indexOf('--filters');
  if (idx === -1) return { fy: '2025-2026' };
  const raw = process.argv[idx + 1] ?? '';
  const out: Filters = {};
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split('=');
    if (k && v) (out as Record<string, string>)[k.trim()] = v.trim();
  }
  return out;
}

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error('SUPABASE_DB_URL is not set');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, prepare: false });
  const filters = parseFilterArg();
  console.log(`Filters: ${JSON.stringify(filters)}`);
  console.log('');

  const cases: Array<{ label: string; query: { text: string; params: unknown[] } }> = [
    { label: 'dashOverviewKpis',         query: dashOverviewKpis(filters) },
    { label: 'dashOverviewFy',           query: dashOverviewFy(filters) },
    { label: 'dashBrand',                query: dashBrand(filters) },
    { label: 'dashSegment',              query: dashSegment(filters) },
    { label: 'dashExpenses',             query: dashExpenses(filters) },
    { label: 'dashPrimaryBifurcation',   query: dashPrimaryBifurcation(filters) },
    { label: 'dashPrimaryBifurcationFy', query: dashPrimaryBifurcationFy(filters) },
    { label: 'dashReturning',            query: dashReturning(filters) },
    ...REPORTS.map(def => ({
      label: `${def.id} (${def.name})`,
      query: def.sqlFactory(filters),
    })),
  ];

  const results: Result[] = [];
  for (const { label, query } of cases) {
    const t0 = Date.now();
    try {
      const rows = await sql.unsafe(query.text, query.params as never[]);
      const arr = Array.from(rows) as Record<string, unknown>[];
      results.push({
        label,
        rowCount: arr.length,
        durationMs: Date.now() - t0,
        sample: arr[0],
      });
    } catch (e) {
      results.push({
        label,
        rowCount: 0,
        durationMs: Date.now() - t0,
        error: String(e),
      });
    }
  }

  const errors = results.filter(r => r.error);
  const empty = results.filter(r => !r.error && r.rowCount === 0);
  const ok = results.filter(r => !r.error && r.rowCount > 0);

  console.log(`✓ ${ok.length} queries returned rows`);
  console.log(`∅ ${empty.length} queries returned 0 rows`);
  console.log(`✗ ${errors.length} queries failed`);
  console.log('');

  for (const r of results) {
    const tag = r.error ? '✗' : r.rowCount === 0 ? '∅' : '✓';
    const time = `${r.durationMs}ms`.padStart(7);
    console.log(`${tag} ${time}  ${r.label}  (${r.rowCount} rows)`);
    if (r.error) {
      console.log(`     ↳ ${r.error}`);
    } else if (r.sample) {
      const cols = Object.keys(r.sample).slice(0, 3).join(', ');
      console.log(`     ↳ first row cols: ${cols}…`);
    }
  }

  await sql.end();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
