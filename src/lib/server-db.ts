// Postgres-backed ServerDb singleton. Powers the chat agent loop after
// migration. Mirrors the surface of the old src/lib/server-duckdb.ts so
// the agent loop didn't have to change shape.
//
// One ServerDb per warm Node.js container. Dictionary is computed once on
// first call and held in module scope. After a fresh CSV upload, the ingest
// route calls resetServerDb() so the next chat call rebuilds.

import sql from './db';
import { validateSelectSql, wrapWithLimit, MAX_ROWS_WRAP } from './sql-safety';

const QUERY_TIMEOUT_MS = 10_000;

export interface DataDictionary {
  generated_at: string;
  row_count: number;
  fy_range: string[];
  segments: string[];
  zbms: string[];
  hqs: string[];
  brand_families: Record<string, string[]>;
  doctors_top_200: string[];
  latest_period: string | null;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  truncated?: boolean;
  error?: string;
}

export interface ServerDb {
  runSafe(sql: string): Promise<QueryResult>;
  runTrusted(sql: string): Promise<QueryResult>;
  dictionary: DataDictionary;
  dataVersion: string;
}

// ── Query execution ───────────────────────────────────────────────────────

async function runWithTimeout(
  query: string,
  params: unknown[],
  timeoutMs: number,
): Promise<QueryResult> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const exec = (async () => {
      const rows = await sql.unsafe(query, params as never[]);
      const arr = Array.from(rows) as Record<string, unknown>[];
      const columns = arr.length > 0 ? Object.keys(arr[0]) : [];
      return { rows: arr, columns, rowCount: arr.length };
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`query timeout after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    return await Promise.race([exec, timeout]);
  } catch (e) {
    return { rows: [], columns: [], rowCount: 0, error: String(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Tool-facing query: validates + LIMIT-wraps + timeout. */
export async function runSafeQuery(query: string): Promise<QueryResult> {
  const gate = validateSelectSql(query);
  if (!gate.ok) {
    return { rows: [], columns: [], rowCount: 0, error: gate.reason };
  }
  const capped = wrapWithLimit(query);
  const result = await runWithTimeout(capped, [], QUERY_TIMEOUT_MS);
  if (result.rows.length === MAX_ROWS_WRAP) {
    result.truncated = true;
  }
  return result;
}

// ── Data dictionary computation ───────────────────────────────────────────

interface DistinctRow { value: string }

async function distinctStr(col: string, limit: number): Promise<string[]> {
  // We can't bind identifiers, only values, so the column name comes from
  // an internal allow-list (CSV_COLUMNS via the caller).
  const rows = await sql.unsafe<DistinctRow[]>(
    `SELECT DISTINCT ${col} AS value FROM data
     WHERE ${col} IS NOT NULL AND TRIM(${col}) <> ''
     ORDER BY ${col} LIMIT ${limit}`,
  );
  return rows.map(r => String(r.value));
}

interface BrandRow { family: string; item_name: string }
interface CountRow { n: string | number }
interface LatestRow { latest: string | null }

export async function buildDataDictionary(): Promise<DataDictionary> {
  const countRows = await sql.unsafe<CountRow[]>(`SELECT COUNT(*)::text AS n FROM data`);
  const rowCount = Number(countRows[0]?.n ?? 0);

  const [fy, seg, zbm, hq, doctors] = await Promise.all([
    distinctStr('fy', 50),
    distinctStr('seg', 50),
    distinctStr('zbm', 50),
    distinctStr('hq_new', 200),
    distinctStr('dr_name', 200),
  ]);

  const latestRows = await sql.unsafe<LatestRow[]>(
    `SELECT MAX(yyyymm) AS latest FROM data
     WHERE yyyymm IS NOT NULL AND TRIM(yyyymm) <> ''`,
  );
  const latestPeriod = latestRows[0]?.latest ?? null;

  // Brand-family extraction. Postgres' substring(s from regex) returns the
  // first match — equivalent to DuckDB's REGEXP_EXTRACT(..., 0).
  const brandRows = await sql.unsafe<BrandRow[]>(`
    SELECT
      UPPER(substring(item_name from '^[A-Za-z][A-Za-z0-9]*')) AS family,
      item_name
    FROM (
      SELECT DISTINCT item_name FROM data
      WHERE item_name IS NOT NULL
        AND item_name NOT LIKE '(INACTIVE)%'
        AND TRIM(item_name) <> ''
    ) s
    WHERE substring(item_name from '^[A-Za-z][A-Za-z0-9]*') <> ''
    ORDER BY family, item_name
  `);

  const brandFamilies: Record<string, string[]> = {};
  for (const row of brandRows) {
    const family = String(row.family ?? '');
    const item = String(row.item_name ?? '');
    if (!family || !item) continue;
    (brandFamilies[family] ??= []).push(item);
  }

  return {
    generated_at: new Date().toISOString(),
    row_count: rowCount,
    fy_range: fy,
    segments: seg,
    zbms: zbm,
    hqs: hq,
    brand_families: brandFamilies,
    doctors_top_200: doctors,
    latest_period: latestPeriod,
  };
}

// ── Data-version stamp ────────────────────────────────────────────────────

interface VersionRow { max_id: string | null; n: string | number }

async function fetchDataVersion(): Promise<string> {
  const rows = await sql.unsafe<VersionRow[]>(
    `SELECT COALESCE(MAX(id), 0)::text AS max_id, COUNT(*)::text AS n FROM data`,
  );
  const maxId = rows[0]?.max_id ?? '0';
  const n = rows[0]?.n ?? '0';
  return `${maxId}:${n}`;
}

// ── Singleton ─────────────────────────────────────────────────────────────

let _cache: ServerDb | null = null;
let _loading: Promise<ServerDb> | null = null;

async function buildDb(): Promise<ServerDb> {
  const dictionary = await buildDataDictionary();
  if (dictionary.row_count === 0) {
    throw new Error(
      'no rows in `data` table — upload a CSV from /upload first',
    );
  }
  const dataVersion = await fetchDataVersion();
  return {
    runSafe: runSafeQuery,
    runTrusted: (q: string) => runWithTimeout(q, [], QUERY_TIMEOUT_MS),
    dictionary,
    dataVersion,
  };
}

/**
 * Get the server Postgres-backed ServerDb singleton. Builds the data
 * dictionary on cold start (~50–200ms) and reuses on subsequent calls.
 *
 * Concurrent first-call invocations share a single load Promise — we never
 * build the dictionary twice in parallel.
 */
export async function getServerDb(): Promise<ServerDb> {
  if (_cache) return _cache;
  if (!_loading) {
    _loading = buildDb()
      .then(result => { _cache = result; return result; })
      .finally(() => { _loading = null; });
  }
  return _loading;
}

/** Force the next getServerDb() to rebuild the dictionary. Used by ingest + tests. */
export function resetServerDb(): void {
  _cache = null;
  _loading = null;
}
