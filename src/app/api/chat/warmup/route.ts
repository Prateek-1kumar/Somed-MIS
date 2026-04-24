// Warmup endpoint — called by the chat page on mount so the server DuckDB
// singleton is hot by the time the user sends their first message.
//
// Safe to call repeatedly; internally idempotent.

import { NextResponse } from 'next/server';
import { getServerDb } from '@/lib/server-duckdb';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getServerDb();
    return NextResponse.json({
      ok: true,
      dataVersion: db.dataVersion,
      rowCount: db.dictionary.row_count,
      latestPeriod: db.dictionary.latest_period,
    });
  } catch (e) {
    const msg = String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
