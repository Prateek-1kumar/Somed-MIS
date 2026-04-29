'use server';

// Server Actions for the report and dashboard data layer. Client components
// import these and `await` them; Next.js handles the RPC. All SQL goes
// through `sql.unsafe(text, params)` which uses parameterized binding —
// no string interpolation of filter values reaches the database.

import sql from '@/lib/db';
import type { Filters } from '@/lib/schema';
import { getReport } from '@/reports';
import { validateSelectSql, wrapWithLimit } from '@/lib/sql-safety';
import {
  dashOverviewKpis,
  dashOverviewFy,
  dashBrand,
  dashSegment,
  dashExpenses,
  dashPrimaryBifurcation,
  dashPrimaryBifurcationFy,
  dashReturning,
} from '@/reports/dashboard';

type Row = Record<string, unknown>;

async function execute(query: { text: string; params: unknown[] }): Promise<Row[]> {
  const rows = await sql.unsafe(query.text, query.params as never[]);
  return Array.from(rows) as Row[];
}

/** Run a named report by id (the 27 entries in the REPORTS registry). */
export async function runReport(id: string, filters: Filters): Promise<Row[]> {
  const def = getReport(id);
  if (!def) throw new Error(`unknown report: ${id}`);
  return execute(def.sqlFactory(filters));
}

const DASH_QUERIES = {
  overviewKpis:         dashOverviewKpis,
  overviewFy:           dashOverviewFy,
  brand:                dashBrand,
  segment:              dashSegment,
  expenses:             dashExpenses,
  primaryBifurcation:   dashPrimaryBifurcation,
  primaryBifurcationFy: dashPrimaryBifurcationFy,
  returning:            dashReturning,
} as const;

export type DashboardQueryKey = keyof typeof DASH_QUERIES;

/** Run a dashboard query by key. Keys correspond to the dashboard.ts factories. */
export async function runDashboardQuery(
  key: DashboardQueryKey,
  filters: Filters,
): Promise<Row[]> {
  const fn = DASH_QUERIES[key];
  if (!fn) throw new Error(`unknown dashboard query: ${key}`);
  return execute(fn(filters));
}
