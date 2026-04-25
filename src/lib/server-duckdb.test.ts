/**
 * @jest-environment node
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  createDuckDB,
  ConsoleLogger,
  LogLevel,
  NODE_RUNTIME,
  type DuckDBConnection,
  type DuckDBBindingsBase,
  type DuckDBBundles,
} from '@duckdb/duckdb-wasm/blocking';
import {
  validateSelectSql,
  wrapWithLimit,
  loadCsvIntoDb,
  buildDataDictionary,
  runSafeQuery,
  getServerDb,
  resetServerDb,
  type CsvProvider,
} from './server-duckdb';
import { CSV_COLUMNS, CSV_COLUMN_TYPES } from './schema';

// Resolve from project root (works in jest CJS and Next.js Node.js runtime alike).
const _req = createRequire(path.join(process.cwd(), 'package.json'));
const _wasmDist = path.dirname(_req.resolve('@duckdb/duckdb-wasm'));

function wasmBundles(): DuckDBBundles {
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

async function openWasm(): Promise<{ wasm: DuckDBBindingsBase; conn: DuckDBConnection }> {
  const wasm = await createDuckDB(wasmBundles(), new ConsoleLogger(LogLevel.WARNING), NODE_RUNTIME);
  await wasm.instantiate();
  wasm.open({});
  const conn = wasm.connect();
  return { wasm, conn };
}

function buildFixtureCsv(rows: Partial<Record<string, string | number>>[]): string {
  const header = CSV_COLUMNS.join(',');
  const lines = rows.map(row =>
    CSV_COLUMNS.map(col => {
      const v = row[col];
      if (v === undefined || v === null) {
        return CSV_COLUMN_TYPES[col] === 'DOUBLE' ? '0' : '';
      }
      if (typeof v === 'number') return String(v);
      const s = String(v);
      if (s.includes(',') || s.includes('"')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }).join(','),
  );
  return [header, ...lines].join('\n');
}

const SHOVERT_FIXTURE_ROWS = [
  { fy: '2025-2026', yyyymm: '202504', seg: 'NEURO', zbm: 'ZBM MP', hq_new: 'HARDA', item_name: 'SHOVERT-8 TAB 10S', net_sales_: 1000, sales_valu: 800, tgt_val_p: 1500, dr_name: 'DR. A GUPTA' },
  { fy: '2025-2026', yyyymm: '202504', seg: 'NEURO', zbm: 'ZBM MP', hq_new: 'HARDA', item_name: 'SHOVERT-16 TAB 10S', net_sales_: 1200, sales_valu: 900, tgt_val_p: 1500, dr_name: 'DR. B SHARMA' },
  { fy: '2025-2026', yyyymm: '202505', seg: 'NEURO', zbm: 'ZBM MP', hq_new: 'HARDA', item_name: 'SHOVERT-30 TAB 10S', net_sales_: 1500, sales_valu: 1100, tgt_val_p: 1500, dr_name: 'DR. A GUPTA' },
  { fy: '2024-2025', yyyymm: '202404', seg: 'ORTHO', zbm: 'ZBM EAST', hq_new: 'AGRA', item_name: 'SHOCOX-T4 TAB', net_sales_: 500, sales_valu: 400, tgt_val_p: 600, dr_name: 'DR. C PATEL' },
  { fy: '2025-2026', yyyymm: '202506', seg: 'NEURO', zbm: 'ZBM MP', hq_new: 'HARDA', item_name: '(INACTIVE) OLDPROD-5', net_sales_: 0, sales_valu: 0, tgt_val_p: 0, dr_name: '' },
];

describe('validateSelectSql', () => {
  it('accepts a plain SELECT', () => {
    expect(validateSelectSql('SELECT * FROM data').ok).toBe(true);
  });

  it('accepts a WITH CTE query', () => {
    const r = validateSelectSql('WITH t AS (SELECT * FROM data) SELECT * FROM t');
    expect(r.ok).toBe(true);
  });

  it('rejects INSERT', () => {
    const r = validateSelectSql('INSERT INTO data VALUES (1)');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/only SELECT or WITH/);
  });

  it('rejects DROP hidden in a CTE', () => {
    const r = validateSelectSql('WITH x AS (DROP TABLE data) SELECT 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/drop/i);
  });

  it('rejects a reference to a table other than data', () => {
    const r = validateSelectSql('SELECT * FROM other_table');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unknown table/i);
  });

  it('allows a CTE defined inline', () => {
    const r = validateSelectSql(
      'WITH monthly AS (SELECT yyyymm, SUM(net_sales_) s FROM data GROUP BY 1) SELECT * FROM monthly',
    );
    expect(r.ok).toBe(true);
  });

  it('rejects multi-statement queries', () => {
    const r = validateSelectSql('SELECT 1; SELECT 2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/multi-statement/);
  });

  it('rejects empty SQL', () => {
    const r = validateSelectSql('   ');
    expect(r.ok).toBe(false);
  });

  it('ignores forbidden keywords inside string literals', () => {
    const r = validateSelectSql("SELECT 'delete me' AS label FROM data");
    expect(r.ok).toBe(true);
  });
});

describe('wrapWithLimit', () => {
  it('wraps a query without explicit LIMIT', () => {
    const wrapped = wrapWithLimit('SELECT * FROM data');
    expect(wrapped).toMatch(/LIMIT 100000/);
  });

  it('leaves a query with existing LIMIT alone', () => {
    const wrapped = wrapWithLimit('SELECT * FROM data LIMIT 5');
    expect(wrapped).toBe('SELECT * FROM data LIMIT 5');
  });

  it('respects custom cap', () => {
    const wrapped = wrapWithLimit('SELECT 1', 42);
    expect(wrapped).toMatch(/LIMIT 42/);
  });
});

describe('loadCsvIntoDb + buildDataDictionary', () => {
  let wasm: DuckDBBindingsBase;
  let connection: DuckDBConnection;

  beforeAll(async () => {
    ({ wasm, conn: connection } = await openWasm());
    loadCsvIntoDb(wasm, connection, buildFixtureCsv(SHOVERT_FIXTURE_ROWS));
  });

  afterAll(() => {
    try { connection.close(); } catch { /* ignore */ }
  });

  it('loads all fixture rows into the data table', () => {
    const table = connection.query('SELECT COUNT(*) FROM data');
    const count = Number(Object.values(table.toArray()[0]?.toJSON() ?? {})[0] ?? 0);
    expect(count).toBe(SHOVERT_FIXTURE_ROWS.length);
  });

  it('computes brand families grouping SHOVERT SKUs', async () => {
    const dict = await buildDataDictionary(connection);
    expect(Object.keys(dict.brand_families)).toContain('SHOVERT');
    expect(dict.brand_families.SHOVERT).toEqual(
      expect.arrayContaining([
        'SHOVERT-8 TAB 10S',
        'SHOVERT-16 TAB 10S',
        'SHOVERT-30 TAB 10S',
      ]),
    );
  });

  it('excludes inactive items from brand families', async () => {
    const dict = await buildDataDictionary(connection);
    const allItems = Object.values(dict.brand_families).flat();
    expect(allItems.some(i => i.startsWith('(INACTIVE)'))).toBe(false);
  });

  it('extracts fy, segments, zbms, hqs', async () => {
    const dict = await buildDataDictionary(connection);
    expect(dict.fy_range).toEqual(expect.arrayContaining(['2024-2025', '2025-2026']));
    expect(dict.segments).toEqual(expect.arrayContaining(['NEURO', 'ORTHO']));
    expect(dict.zbms).toEqual(expect.arrayContaining(['ZBM MP', 'ZBM EAST']));
    expect(dict.hqs).toEqual(expect.arrayContaining(['HARDA', 'AGRA']));
  });

  it('finds the latest period', async () => {
    const dict = await buildDataDictionary(connection);
    expect(dict.latest_period).toBe('202506');
  });

  it('counts rows correctly', async () => {
    const dict = await buildDataDictionary(connection);
    expect(dict.row_count).toBe(SHOVERT_FIXTURE_ROWS.length);
  });
});

describe('runSafeQuery', () => {
  let wasm: DuckDBBindingsBase;
  let connection: DuckDBConnection;

  beforeAll(async () => {
    ({ wasm, conn: connection } = await openWasm());
    loadCsvIntoDb(wasm, connection, buildFixtureCsv(SHOVERT_FIXTURE_ROWS));
  });

  afterAll(() => {
    try { connection.close(); } catch { /* ignore */ }
  });

  it('returns rows for a valid SELECT', async () => {
    const r = await runSafeQuery(connection, 'SELECT COUNT(*) AS n FROM data');
    expect(r.error).toBeUndefined();
    expect(r.rowCount).toBe(1);
    // COUNT(*) returns a numeric value (BigInt converted to Number)
    expect(Number(r.rows[0]?.n)).toBe(SHOVERT_FIXTURE_ROWS.length);
  });

  it('rejects non-SELECT with a reason', async () => {
    const r = await runSafeQuery(connection, "UPDATE data SET fy='x'");
    expect(r.error).toBeDefined();
    expect(r.error).toMatch(/only SELECT/);
    expect(r.rowCount).toBe(0);
  });

  it('surfaces DuckDB errors as result.error without throwing', async () => {
    const r = await runSafeQuery(connection, 'SELECT nonexistent_col FROM data');
    expect(r.error).toBeDefined();
  });

  it('auto-wraps a missing LIMIT', async () => {
    const r = await runSafeQuery(connection, 'SELECT * FROM data');
    expect(r.error).toBeUndefined();
    expect(r.rowCount).toBe(SHOVERT_FIXTURE_ROWS.length);
  });
});

describe('getServerDb singleton', () => {
  const fixtureCsv = buildFixtureCsv(SHOVERT_FIXTURE_ROWS);

  afterEach(async () => {
    await resetServerDb();
  });

  it('loads once and returns the same instance on second call', async () => {
    let fetchCount = 0;
    const provider: CsvProvider = {
      async fetch() {
        fetchCount++;
        return { text: fixtureCsv, version: 'v1' };
      },
    };
    const a = await getServerDb(provider);
    const b = await getServerDb(provider);
    expect(a).toBe(b);
    expect(fetchCount).toBe(1);
  });

  it('populates dictionary + dataVersion from provider', async () => {
    const provider: CsvProvider = {
      async fetch() { return { text: fixtureCsv, version: '2026-04-24T00:00:00Z' }; },
    };
    const db = await getServerDb(provider);
    expect(db.dataVersion).toBe('2026-04-24T00:00:00Z');
    expect(db.dictionary.row_count).toBe(SHOVERT_FIXTURE_ROWS.length);
    expect(Object.keys(db.dictionary.brand_families)).toContain('SHOVERT');
  });

  it('runSafe executes tool-facing queries', async () => {
    const provider: CsvProvider = {
      async fetch() { return { text: fixtureCsv, version: 'v1' }; },
    };
    const db = await getServerDb(provider);
    const r = await db.runSafe("SELECT item_name FROM data WHERE item_name LIKE 'SHOVERT%'");
    expect(r.error).toBeUndefined();
    expect(r.rowCount).toBe(3);
  });

  it('throws a helpful error when no CSV exists', async () => {
    const provider: CsvProvider = { async fetch() { return null; } };
    await expect(getServerDb(provider)).rejects.toThrow(/no CSV/);
  });

  it('concurrent first-call invocations share a single load', async () => {
    let fetchCount = 0;
    const provider: CsvProvider = {
      async fetch() {
        fetchCount++;
        await new Promise(r => setTimeout(r, 20));
        return { text: fixtureCsv, version: 'v-concurrent' };
      },
    };
    const [a, b, c] = await Promise.all([
      getServerDb(provider),
      getServerDb(provider),
      getServerDb(provider),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(fetchCount).toBe(1);
  });
});
