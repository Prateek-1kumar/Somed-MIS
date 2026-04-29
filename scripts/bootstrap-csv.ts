// One-shot CSV bootstrap. Mirrors the two-stage COPY pipeline that lives in
// src/app/api/data/ingest/route.ts but reads from a local file path instead
// of fetching a blob URL. Use this once during cutover to load the historical
// accumulated CSV into the new Postgres `data` table.
//
// Usage: SUPABASE_DB_URL=... npx tsx scripts/bootstrap-csv.ts /path/to/file.csv

import postgres from 'postgres';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { CSV_COLUMNS, CSV_COLUMN_TYPES } from '../src/lib/schema';

const NUMERIC_REGEX = String.raw`^-?[0-9]+(\.[0-9]+)?$`;

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: bootstrap-csv.ts <path-to-csv>');
    process.exit(1);
  }
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error('SUPABASE_DB_URL is not set');
    process.exit(1);
  }
  const stat = fs.statSync(path);
  console.log(`source: ${path} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

  const sql = postgres(url, { max: 1, prepare: false });

  const colList = CSV_COLUMNS.join(', ');
  const insertCols = CSV_COLUMNS.map(col => {
    const isNumeric = CSV_COLUMN_TYPES[col] === 'DOUBLE';
    return isNumeric
      ? `CASE WHEN ${col} ~ '${NUMERIC_REGEX}' THEN ${col}::numeric END`
      : col;
  }).join(', ');

  const beforeRows = await sql`SELECT COUNT(*)::text AS n FROM data`;
  const before = Number((beforeRows[0] as { n: string }).n);
  console.log(`rows in data before: ${before.toLocaleString()}`);

  const t0 = Date.now();
  await sql.begin(async (tx) => {
    console.log('TRUNCATE data_raw');
    await tx.unsafe('TRUNCATE data_raw');

    console.log('COPY data_raw FROM STDIN');
    const writable = await tx.unsafe(
      `COPY data_raw (${colList}) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')`,
    ).writable();
    await pipeline(
      fs.createReadStream(path),
      writable as unknown as NodeJS.WritableStream,
    );

    console.log('DELETE existing rows for periods being replaced');
    await tx.unsafe(`
      DELETE FROM data
      WHERE yyyymm IN (
        SELECT DISTINCT yyyymm FROM data_raw
        WHERE yyyymm IS NOT NULL AND TRIM(yyyymm) <> ''
      )
    `);

    console.log('INSERT INTO data SELECT (with CASE casts)');
    await tx.unsafe(
      `INSERT INTO data (${colList}) SELECT ${insertCols} FROM data_raw`,
    );

    console.log('TRUNCATE data_raw');
    await tx.unsafe('TRUNCATE data_raw');
  });

  const afterRows = await sql`SELECT COUNT(*)::text AS n FROM data`;
  const after = Number((afterRows[0] as { n: string }).n);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('');
  console.log(`✓ ingested in ${seconds}s`);
  console.log(`  rows added: ${(after - before).toLocaleString()}`);
  console.log(`  total rows: ${after.toLocaleString()}`);

  await sql.end();
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
