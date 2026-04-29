// POST /api/data/ingest — append a CSV (already uploaded to Vercel Blob)
// into the canonical Postgres `data` table via the two-stage pipeline:
//
//   1. TRUNCATE  data_raw                        (clear staging)
//   2. COPY      data_raw FROM STDIN             (tolerantly load all-text rows)
//   3. INSERT    INTO data SELECT (with casts)   (move to typed table)
//   4. TRUNCATE  data_raw                        (free staging space)
//
// Wrapped in one transaction. If any step fails the whole upload is rolled
// back. Bad numeric cells become NULL via the CASE-with-regex cast — same
// "ignore_errors" semantic the legacy DuckDB CSV loader had.
//
// Request body:  { blobUrl: string }
// Response:      { rowsAdded: number, totalRows: number }

import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { del } from '@vercel/blob';
import sql from '@/lib/db';
import { CSV_COLUMNS, CSV_COLUMN_TYPES } from '@/lib/schema';
import { resetServerDb } from '@/lib/server-db';
import { refreshEntityIndex } from '@/lib/entity-index';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const NUMERIC_REGEX = String.raw`^-?[0-9]+(\.[0-9]+)?$`;

export async function POST(req: NextRequest) {
  let body: { blobUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const blobUrl = body.blobUrl?.trim();
  if (!blobUrl) {
    return NextResponse.json({ error: 'blobUrl required' }, { status: 400 });
  }

  try {
    const beforeRows = await countRows();

    const res = await fetch(blobUrl, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) {
      throw new Error(`blob fetch failed: ${res.status} ${res.statusText}`);
    }
    if (!res.body) {
      throw new Error('blob fetch returned no body');
    }

    const colList = CSV_COLUMNS.join(', ');
    const insertCols = CSV_COLUMNS.map(col => {
      // Numeric columns: cast text → numeric only when value matches the
      // numeric regex; everything else (empty, garbage) becomes NULL.
      // Text columns pass through verbatim. yyyymm stays text intentionally.
      const isNumeric = CSV_COLUMN_TYPES[col] === 'DOUBLE';
      return isNumeric
        ? `CASE WHEN ${col} ~ '${NUMERIC_REGEX}' THEN ${col}::numeric END`
        : col;
    }).join(', ');

    await sql.begin(async (tx) => {
      await tx.unsafe('TRUNCATE data_raw');

      const writable = await tx.unsafe(
        `COPY data_raw (${colList}) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')`,
      ).writable();

      // Web ReadableStream → Node Readable → COPY writable.
      // Pipeline propagates backpressure and surfaces errors from either side.
      await pipeline(
        Readable.fromWeb(res.body as never),
        writable as unknown as NodeJS.WritableStream,
      );

      // Replace-by-period semantic preserved from the legacy uploader: drop
      // every existing row whose yyyymm appears in this upload, so re-uploading
      // a month overwrites instead of duplicating.
      await tx.unsafe(`
        DELETE FROM data
        WHERE yyyymm IN (
          SELECT DISTINCT yyyymm FROM data_raw
          WHERE yyyymm IS NOT NULL AND TRIM(yyyymm) <> ''
        )
      `);

      await tx.unsafe(
        `INSERT INTO data (${colList}) SELECT ${insertCols} FROM data_raw`,
      );

      // Refresh entity_values from the now-current data table.
      await refreshEntityIndex(tx);

      await tx.unsafe('TRUNCATE data_raw');
    });

    // Best-effort cleanup of the staging blob; failure here is logged, not
    // surfaced — the data already landed in Postgres.
    try {
      await del(blobUrl);
    } catch (err) {
      console.warn('[ingest] staging blob delete failed (non-fatal):', err);
    }

    resetServerDb();

    const totalRows = await countRows();
    return NextResponse.json({
      rowsAdded: totalRows - beforeRows,
      totalRows,
    });
  } catch (e) {
    console.error('[ingest] failed:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

async function countRows(): Promise<number> {
  const r = await sql.unsafe<Array<{ n: string }>>(
    'SELECT COUNT(*)::text AS n FROM data',
  );
  return Number(r[0]?.n ?? 0);
}
