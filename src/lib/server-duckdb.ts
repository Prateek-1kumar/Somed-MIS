// Server-side DuckDB singleton. Powers the chat agent loop.
//
// Design notes:
// - One DuckDB instance per warm Node function container. CSV is loaded once
//   on cold start, reused across requests.
// - Browser DuckDB (src/lib/duckdb.ts) still drives dashboard/reports/upload
//   pages. This module is chat-agent-only.
// - CSV provider is abstracted so tests can inject an in-memory fixture.

import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { list } from '@vercel/blob';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CSV_COLUMNS, CSV_COLUMN_TYPES, type CsvColumn } from './schema';

const MAX_ROWS_WRAP = 100_000;
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

// ── Core: load CSV into DuckDB ────────────────────────────────────────────

/**
 * Read the CSV from disk into a DuckDB `data` table with the schema from
 * lib/schema.ts. TRY_CAST is used so malformed numeric cells become NULL
 * instead of failing the whole load (same forgiving behavior as the
 * browser-side DuckDB).
 */
export async function loadCsvIntoDb(
  connection: DuckDBConnection,
  csvPath: string,
): Promise<void> {
  const columns = CSV_COLUMNS.map((col: CsvColumn) => {
    const type = CSV_COLUMN_TYPES[col];
    return `'${col}': '${type}'`;
  }).join(', ');

  // Drop any previous table first; idempotent for reload.
  await connection.run(`DROP TABLE IF EXISTS data`);
  await connection.run(`
    CREATE TABLE data AS
    SELECT * FROM read_csv(
      '${csvPath.replace(/'/g, "''")}',
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
  const distinctStr = async (col: string, limit: number): Promise<string[]> => {
    const r = await connection.runAndReadAll(
      `SELECT DISTINCT ${col} FROM data WHERE ${col} IS NOT NULL AND TRIM(${col}) <> '' ORDER BY ${col} LIMIT ${limit}`,
    );
    return r.getRowsJson().map(row => String(row[0]));
  };

  const [rowCountReader, fy, seg, zbm, hq, doctors, latest] = await Promise.all([
    connection.runAndReadAll(`SELECT COUNT(*) FROM data`),
    distinctStr('fy', 50),
    distinctStr('seg', 50),
    distinctStr('zbm', 50),
    distinctStr('hq_new', 200),
    distinctStr('dr_name', 200),
    connection.runAndReadAll(
      `SELECT MAX(yyyymm) FROM data WHERE yyyymm IS NOT NULL AND TRIM(yyyymm) <> ''`,
    ),
  ]);

  const rowCount = Number(rowCountReader.getRowsJson()[0]?.[0] ?? 0);
  const latestPeriod = (latest.getRowsJson()[0]?.[0] as string | null) ?? null;

  // Brand families: group item_name by prefix before first hyphen/space.
  // Example: "SHOVERT-8 TAB 10S" → family "SHOVERT".
  const brandFamiliesReader = await connection.runAndReadAll(`
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
  for (const row of brandFamiliesReader.getRowsJson()) {
    const family = String(row[0] ?? '');
    const item = String(row[1] ?? '');
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

async function runWithTimeout(
  connection: DuckDBConnection,
  sql: string,
  timeoutMs: number,
): Promise<QueryResult> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const execution = connection.runAndReadAll(sql);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`query timeout after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    const reader = await Promise.race([execution, timeout]);
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    const columns = reader.columnNames();
    return { rows, columns, rowCount: rows.length };
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
  connection: DuckDBConnection;
  csvPath: string;
}

let _cache: CachedDb | null = null;
let _loading: Promise<CachedDb> | null = null;

async function buildDb(provider: CsvProvider, csvDir: string): Promise<CachedDb> {
  const fetched = await provider.fetch();
  if (!fetched) {
    throw new Error('no CSV found in blob storage — upload one first');
  }
  await fs.mkdir(csvDir, { recursive: true });
  const csvPath = path.join(csvDir, `somed-${Date.now()}.csv`);
  await fs.writeFile(csvPath, fetched.text, 'utf-8');

  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();

  await loadCsvIntoDb(connection, csvPath);
  const dictionary = await buildDataDictionary(connection);

  const db: ServerDb = {
    runSafe: (sql: string) => runSafeQuery(connection, sql),
    runTrusted: (sql: string) => runWithTimeout(connection, sql, QUERY_TIMEOUT_MS),
    dictionary,
    dataVersion: fetched.version,
  };
  return { db, connection, csvPath };
}

/**
 * Get the server DuckDB singleton. Loads the CSV on cold start (~1-2s)
 * and reuses the instance on subsequent calls.
 *
 * Concurrent callers during cold start share one Promise — we never
 * load the CSV twice in parallel.
 */
export async function getServerDb(
  provider: CsvProvider = vercelBlobCsvProvider,
  csvDir: string = os.tmpdir(),
): Promise<ServerDb> {
  if (_cache) return _cache.db;
  if (!_loading) {
    _loading = buildDb(provider, csvDir)
      .then(result => { _cache = result; return result; })
      .finally(() => { _loading = null; });
  }
  const cached = await _loading;
  return cached.db;
}

/** Force next getServerDb() to reload. Used by upload flow + tests. */
export async function resetServerDb(): Promise<void> {
  if (_cache) {
    try { _cache.connection.closeSync(); } catch { /* ignore */ }
    try { await fs.unlink(_cache.csvPath); } catch { /* ignore */ }
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
