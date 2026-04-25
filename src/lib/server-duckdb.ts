// Server-side DuckDB singleton. Powers the chat agent loop.
//
// Uses @duckdb/duckdb-wasm (blocking Node.js bundle) — pure WebAssembly,
// no native shared library (.so/.dylib) required. Works on Vercel Lambda.
//
// Design notes:
// - One DuckDB instance per warm Node function container. CSV is loaded once
//   on cold start, reused across requests.
// - Browser DuckDB (src/lib/duckdb.ts) still drives dashboard/reports/upload
//   pages. This module is chat-agent-only.
// - CSV provider is abstracted so tests can inject an in-memory fixture.

import {
  createDuckDB,
  ConsoleLogger,
  LogLevel,
  NODE_RUNTIME,
  type DuckDBConnection,
  type DuckDBBindingsBase,
  type DuckDBBundles,
} from '@duckdb/duckdb-wasm/blocking';
import { list } from '@vercel/blob';
import { createRequire } from 'node:module';
import path from 'node:path';
import { CSV_COLUMNS, CSV_COLUMN_TYPES, type CsvColumn } from './schema';

const MAX_ROWS_WRAP = 100_000;
const QUERY_TIMEOUT_MS = 10_000;

// Resolve the duckdb-wasm dist directory at module load time so we can pass
// absolute WASM binary paths to createDuckDB. Using process.cwd() as the base
// avoids import.meta.url (unavailable in jest CJS) and __filename (not typed
// in ESM TypeScript). The '.' Node export of the package resolves to
// duckdb-node.cjs inside the dist/ folder.
const _require = createRequire(path.join(process.cwd(), 'package.json'));
const _wasmDist = path.dirname(_require.resolve('@duckdb/duckdb-wasm'));

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
  /** Run SQL with safety checks applied. Use this for agent tool calls. */
  runSafe(sql: string): Promise<QueryResult>;
  /** Run SQL bypassing validator. Reserved for internal/trusted use only. */
  runTrusted(sql: string): Promise<QueryResult>;
  /** Pre-computed data dictionary for prompt grounding. */
  dictionary: DataDictionary;
  /** Blob version marker — used to decide whether to reload. */
  dataVersion: string;
}

export interface CsvProvider {
  /** Returns the CSV bytes (or null if blob doesn't exist yet) + version stamp. */
  fetch(): Promise<{ text: string; version: string } | null>;
}

// ── SQL validation ────────────────────────────────────────────────────────

const FORBIDDEN_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'attach',
  'detach', 'copy', 'export', 'import', 'pragma', 'install', 'load',
  'truncate', 'grant', 'revoke', 'vacuum',
];

/**
 * Reject any SQL that isn't SELECT / WITH. Runs a keyword scan on the
 * lowercased SQL with string-literals stripped. DuckDB's parser is the
 * deeper defense (it rejects multi-statement input), but this keyword
 * scan catches obvious issues before we even parse.
 */
export function validateSelectSql(sql: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (!trimmed) return { ok: false, reason: 'empty SQL' };

  // Strip single-quoted string literals so a keyword inside a string
  // (e.g., comment) doesn't trigger a false positive.
  const stripped = trimmed.replace(/'(?:[^']|'')*'/g, "''").toLowerCase();

  // First meaningful token must be select or with.
  const firstToken = stripped.match(/^\s*(\w+)/)?.[1];
  if (firstToken !== 'select' && firstToken !== 'with') {
    return { ok: false, reason: `only SELECT or WITH queries allowed (got ${firstToken})` };
  }

  // Multi-statement guard: no unescaped semicolons in the middle.
  if (/;.*\S/.test(stripped)) {
    return { ok: false, reason: 'multi-statement queries not allowed' };
  }

  // Keyword scan — catches sneaky CTE-wrapped writes like WITH x AS (DELETE ...).
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(stripped)) {
      return { ok: false, reason: `forbidden keyword: ${kw}` };
    }
  }

  // Reject reference to any table other than `data`. DuckDB identifiers can be
  // quoted with double-quotes; strip those first.
  const noDoubleQuotes = stripped.replace(/"[^"]*"/g, '""');
  const fromMatches = [...noDoubleQuotes.matchAll(/\bfrom\s+([a-z_][a-z0-9_]*)/gi)];
  const joinMatches = [...noDoubleQuotes.matchAll(/\bjoin\s+([a-z_][a-z0-9_]*)/gi)];
  for (const m of [...fromMatches, ...joinMatches]) {
    const table = m[1].toLowerCase();
    if (table !== 'data' && !isKnownCte(stripped, table)) {
      return { ok: false, reason: `unknown table: ${table} (only 'data' is allowed)` };
    }
  }

  return { ok: true };
}

// Quick-and-dirty CTE detection: look for `WITH name AS (` or `, name AS (`.
function isKnownCte(sql: string, name: string): boolean {
  const re = new RegExp(`(?:\\bwith\\b|,)\\s*${name}\\s+as\\s*\\(`, 'i');
  return re.test(sql);
}

/**
 * Wrap an unbounded query with LIMIT to protect against accidental huge
 * result sets. Doesn't touch queries that already have an explicit LIMIT.
 */
export function wrapWithLimit(sql: string, cap = MAX_ROWS_WRAP): string {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (/\blimit\s+\d+/i.test(trimmed)) return trimmed;
  return `SELECT * FROM (${trimmed}) __capped__ LIMIT ${cap}`;
}

// ── Arrow row conversion ──────────────────────────────────────────────────

// Convert BigInt values to Number so rows are JSON-serializable. DuckDB WASM
// returns 64-bit integer columns as BigInt in Apache Arrow.
function arrowRowToObject(row: { toJSON(): Record<string, unknown> }): Record<string, unknown> {
  const raw = row.toJSON();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return out;
}

// ── Core: load CSV into DuckDB ────────────────────────────────────────────

/**
 * Register the CSV text in DuckDB's virtual filesystem and create a `data`
 * table from it. Uses registerFileText so no disk I/O is needed.
 */
export function loadCsvIntoDb(
  db: DuckDBBindingsBase,
  connection: DuckDBConnection,
  csvText: string,
): void {
  const columns = CSV_COLUMNS.map((col: CsvColumn) => {
    const type = CSV_COLUMN_TYPES[col];
    return `'${col}': '${type}'`;
  }).join(', ');

  const virtualName = 'somed-data.csv';
  db.registerFileText(virtualName, csvText);
  connection.query(`DROP TABLE IF EXISTS data`);
  connection.query(`
    CREATE TABLE data AS
    SELECT * FROM read_csv(
      '${virtualName}',
      columns = {${columns}},
      header = true,
      null_padding = true,
      ignore_errors = true
    )
  `);
}

// ── Data dictionary computation ───────────────────────────────────────────

/**
 * Compute a compact data dictionary for prompt grounding. Expensive-ish
 * (runs several SELECT DISTINCT queries) but only called on cold start.
 */
export async function buildDataDictionary(
  connection: DuckDBConnection,
): Promise<DataDictionary> {
  const distinctStr = (col: string, limit: number): string[] => {
    const table = connection.query(
      `SELECT DISTINCT ${col} FROM data WHERE ${col} IS NOT NULL AND TRIM(${col}) <> '' ORDER BY ${col} LIMIT ${limit}`,
    );
    return table.toArray().map(row => {
      const vals = Object.values(row.toJSON());
      return String(vals[0] ?? '');
    });
  };

  const rowCountTable = connection.query(`SELECT COUNT(*) FROM data`);
  const rowCountVal = Object.values(rowCountTable.toArray()[0]?.toJSON() ?? {})[0];
  const rowCount = Number(rowCountVal ?? 0);

  const fy = distinctStr('fy', 50);
  const seg = distinctStr('seg', 50);
  const zbm = distinctStr('zbm', 50);
  const hq = distinctStr('hq_new', 200);
  const doctors = distinctStr('dr_name', 200);

  const latestTable = connection.query(
    `SELECT MAX(yyyymm) FROM data WHERE yyyymm IS NOT NULL AND TRIM(yyyymm) <> ''`,
  );
  const latestVal = Object.values(latestTable.toArray()[0]?.toJSON() ?? {})[0];
  const latestPeriod = (latestVal as string | null) ?? null;

  const brandFamiliesTable = connection.query(`
    SELECT
      UPPER(REGEXP_EXTRACT(item_name, '^[A-Za-z][A-Za-z0-9]*', 0)) AS family,
      item_name
    FROM (SELECT DISTINCT item_name FROM data
          WHERE item_name IS NOT NULL
            AND item_name NOT LIKE '(INACTIVE)%'
            AND TRIM(item_name) <> '')
    WHERE REGEXP_EXTRACT(item_name, '^[A-Za-z][A-Za-z0-9]*', 0) <> ''
    ORDER BY family, item_name
  `);
  const brandFamilies: Record<string, string[]> = {};
  for (const row of brandFamiliesTable.toArray()) {
    const json = row.toJSON() as { family?: unknown; item_name?: unknown };
    const family = String(json.family ?? '');
    const item = String(json.item_name ?? '');
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

// ── Query execution (safe + trusted variants) ─────────────────────────────

// The wasm blocking bundle executes queries synchronously. The timeout is a
// best-effort guard for the async setup path; it cannot interrupt a running
// synchronous query but does cap idle wait before execution.
async function runWithTimeout(
  connection: DuckDBConnection,
  sql: string,
  timeoutMs: number,
): Promise<QueryResult> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const execution = new Promise<QueryResult>((resolve) => {
      const table = connection.query(sql);
      const rows = table.toArray().map(arrowRowToObject);
      const columns = (table.schema.fields as Array<{ name: string }>).map(f => f.name);
      resolve({ rows, columns, rowCount: rows.length });
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`query timeout after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    return await Promise.race([execution, timeout]);
  } catch (e) {
    return { rows: [], columns: [], rowCount: 0, error: String(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Tool-facing query: validates + LIMIT-wraps + timeout. */
export async function runSafeQuery(
  connection: DuckDBConnection,
  sql: string,
): Promise<QueryResult> {
  const gate = validateSelectSql(sql);
  if (!gate.ok) {
    return { rows: [], columns: [], rowCount: 0, error: gate.reason };
  }
  const capped = wrapWithLimit(sql);
  const result = await runWithTimeout(connection, capped, QUERY_TIMEOUT_MS);
  if (result.rows.length === MAX_ROWS_WRAP) {
    result.truncated = true;
  }
  return result;
}

// ── Providers ─────────────────────────────────────────────────────────────

/** Vercel Blob provider. Used in production. */
export const vercelBlobCsvProvider: CsvProvider = {
  async fetch() {
    const { blobs } = await list({ prefix: 'accumulated.csv' });
    const blob = blobs.find(b => b.pathname === 'accumulated.csv');
    if (!blob) return null;
    const res = await fetch(blob.url, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) throw new Error(`blob fetch failed: ${res.status}`);
    const text = await res.text();
    const version = blob.uploadedAt instanceof Date
      ? blob.uploadedAt.toISOString()
      : String(blob.uploadedAt ?? Date.now());
    return { text, version };
  },
};

// ── Singleton ─────────────────────────────────────────────────────────────

interface CachedDb {
  db: ServerDb;
  wasm: DuckDBBindingsBase;
  connection: DuckDBConnection;
}

let _cache: CachedDb | null = null;
let _loading: Promise<CachedDb> | null = null;

function getWasmBundles(): DuckDBBundles {
  return {
    mvp: {
      mainModule: path.join(_wasmDist, 'duckdb-mvp.wasm'),
      mainWorker: path.join(_wasmDist, 'duckdb-node-mvp.worker.cjs'),
    },
    eh: {
      mainModule: path.join(_wasmDist, 'duckdb-eh.wasm'),
      mainWorker: path.join(_wasmDist, 'duckdb-node-eh.worker.cjs'),
    },
  };
}

async function buildDb(provider: CsvProvider): Promise<CachedDb> {
  const fetched = await provider.fetch();
  if (!fetched) {
    throw new Error('no CSV found in blob storage — upload one first');
  }

  const wasm = await createDuckDB(
    getWasmBundles(),
    new ConsoleLogger(LogLevel.WARNING),
    NODE_RUNTIME,
  );
  wasm.open({});
  const connection = wasm.connect();

  loadCsvIntoDb(wasm, connection, fetched.text);
  const dictionary = await buildDataDictionary(connection);

  const db: ServerDb = {
    runSafe: (sql: string) => runSafeQuery(connection, sql),
    runTrusted: (sql: string) => runWithTimeout(connection, sql, QUERY_TIMEOUT_MS),
    dictionary,
    dataVersion: fetched.version,
  };
  return { db, wasm, connection };
}

/**
 * Get the server DuckDB singleton. Loads the CSV on cold start (~1-2s)
 * and reuses the instance on subsequent calls.
 *
 * Concurrent callers during cold start share one Promise — we never
 * load the CSV twice in parallel.
 *
 * The csvDir parameter is accepted for backward-compatibility but unused;
 * CSV data is registered in DuckDB's in-memory virtual filesystem.
 */
export async function getServerDb(
  provider: CsvProvider = vercelBlobCsvProvider,
  csvDir?: string,
): Promise<ServerDb> {
  void csvDir;
  if (_cache) return _cache.db;
  if (!_loading) {
    _loading = buildDb(provider)
      .then(result => { _cache = result; return result; })
      .finally(() => { _loading = null; });
  }
  const cached = await _loading;
  return cached.db;
}

/** Force next getServerDb() to reload. Used by upload flow + tests. */
export async function resetServerDb(): Promise<void> {
  if (_cache) {
    try { _cache.connection.close(); } catch { /* ignore */ }
  }
  _cache = null;
  _loading = null;
}

/**
 * Check whether the current cached DB is still fresh versus the blob.
 * Cheap — only fetches blob HEAD metadata, not the full CSV.
 */
export async function isFresh(provider: CsvProvider = vercelBlobCsvProvider): Promise<boolean> {
  if (!_cache) return false;
  const fetched = await provider.fetch();
  return fetched?.version === _cache.db.dataVersion;
}
