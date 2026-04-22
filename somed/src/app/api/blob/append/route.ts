import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { CSV_COLUMNS } from '@/lib/schema';

const EXPECTED_HEADER = CSV_COLUMNS.join(',');

function readFirstLine(csv: string): string {
  const nl = csv.search(/\r?\n/);
  return nl === -1 ? csv : csv.slice(0, nl);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { accumulatedCsv?: string };
    if (typeof body.accumulatedCsv !== 'string') {
      return NextResponse.json({ error: 'accumulatedCsv must be a string' }, { status: 400 });
    }
    // Strip BOM if present so header comparison is exact.
    const csv = body.accumulatedCsv.charCodeAt(0) === 0xFEFF
      ? body.accumulatedCsv.slice(1)
      : body.accumulatedCsv;
    const header = readFirstLine(csv).trim();
    if (header !== EXPECTED_HEADER) {
      const receivedCols = header.split(',').length;
      return NextResponse.json({
        error: `CSV header does not match the expected schema. Expected ${CSV_COLUMNS.length} columns starting with "${CSV_COLUMNS.slice(0, 4).join(',')}...", received ${receivedCols} columns starting with "${header.slice(0, 80)}...". Aborting to prevent data corruption.`,
      }, { status: 400 });
    }
    const blob = await put('accumulated.csv', csv, {
      access: 'private',
      contentType: 'text/csv',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
