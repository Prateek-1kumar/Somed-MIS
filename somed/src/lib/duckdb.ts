// src/lib/duckdb.ts
import * as duckdb from '@duckdb/duckdb-wasm';

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let loaded = false;

export async function initDuckDb(): Promise<void> {
  if (db) return;
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
  if (!bundle.mainWorker) throw new Error('No DuckDB worker bundle available');
  const worker = new Worker(bundle.mainWorker);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule);
  conn = await db.connect();
}

export async function loadCsvData(csvText: string): Promise<void> {
  if (!conn) throw new Error('DuckDB not initialised');
  await conn.query('DROP TABLE IF EXISTS data');
  await db!.registerFileText('data.csv', csvText);
  await conn.query(`
    CREATE TABLE data AS
    SELECT * FROM read_csv_auto('data.csv', header=true, sample_size=-1)
  `);
  loaded = true;
}

export async function runQuery(sql: string): Promise<Record<string, unknown>[]> {
  if (!conn) throw new Error('DuckDB not initialised');
  const result = await conn.query(sql);
  return result.toArray().map(row => row.toJSON());
}

export function isDataLoaded(): boolean { return loaded; }
