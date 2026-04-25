// src/lib/duckdb.ts
import * as duckdb from '@duckdb/duckdb-wasm';
import { CSV_COLUMNS, CSV_COLUMN_TYPES } from './schema';

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let loaded = false;
let initPromise: Promise<void> | null = null;
// Serialises concurrent loadCsvData calls. Without this, the
// DROP/CREATE TABLE sequence races and DuckDB throws "Table already exists".
let loadChain: Promise<unknown> = Promise.resolve();
let fileCounter = 0;

export function initDuckDb(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
      if (!bundle.mainWorker) throw new Error('No DuckDB worker bundle available');
      // Cross-origin Worker scripts are blocked by the browser; wrap the CDN
      // worker URL in a same-origin Blob that importScripts() the real file.
      const workerBlobUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
      );
      const worker = new Worker(workerBlobUrl);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(workerBlobUrl);
      conn = await db.connect();
    })().catch((e) => {
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
}

export function loadCsvData(csvText: string): Promise<void> {
  const next = loadChain.then(async () => {
    if (!conn || !db) throw new Error('DuckDB not initialised');
    // Strip UTF-8 BOM if present — some CSV exports add one and it breaks
    // header parsing.
    const normalised = csvText.charCodeAt(0) === 0xFEFF ? csvText.slice(1) : csvText;
    // Unique virtual filename per load avoids stale registrations and
    // interference if the previous load left a file behind.
    const filename = `data_${++fileCounter}.csv`;
    await db.registerFileText(filename, normalised);
    try {
      await conn.query('DROP TABLE IF EXISTS data');
      // Explicit parser settings + TRY_CAST for numeric columns. Loading as
      // all_varchar sidesteps auto-detection quirks with unquoted tokens
      // (e.g. "/  /", "30/06/2023"); the outer projection then coerces
      // numeric columns, turning bad values into NULL rather than failing
      // the whole load.
      const projection = CSV_COLUMNS.map((col) =>
        CSV_COLUMN_TYPES[col] === 'DOUBLE'
          ? `TRY_CAST(raw."${col}" AS DOUBLE) AS "${col}"`
          : `raw."${col}" AS "${col}"`,
      ).join(', ');
      await conn.query(`
        CREATE TABLE data AS
        SELECT ${projection}
        FROM read_csv(
          '${filename}',
          delim = ',',
          quote = '"',
          escape = '"',
          header = true,
          all_varchar = true,
          strict_mode = false,
          null_padding = true
        ) AS raw
      `);
      loaded = true;
    } finally {
      // Free the registered file buffer regardless of success/failure.
      try { await db.dropFile(filename); } catch { /* ignore */ }
    }
  });
  // Keep the chain resilient: a failed load must not poison later loads.
  loadChain = next.catch(() => undefined);
  return next;
}

export async function runQuery(sql: string): Promise<Record<string, unknown>[]> {
  if (!conn) throw new Error('DuckDB not initialised');
  const result = await conn.query(sql);
  return result.toArray().map(row => row.toJSON());
}

export function isDataLoaded(): boolean { return loaded; }

// Creates an empty data table with the correct schema. Called when no CSV is
// available so that dashboard queries return empty results instead of throwing
// "Table with name data does not exist".
export async function createEmptyDataTable(): Promise<void> {
  if (!conn) throw new Error('DuckDB not initialised');
  const columns = CSV_COLUMNS.map(col =>
    CSV_COLUMN_TYPES[col] === 'DOUBLE' ? `"${col}" DOUBLE` : `"${col}" VARCHAR`
  ).join(', ');
  await conn.query('DROP TABLE IF EXISTS data');
  await conn.query(`CREATE TABLE data (${columns})`);
  loaded = true;
}
