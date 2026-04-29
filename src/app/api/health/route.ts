// GET /api/health — Vercel Cron target. Hits Postgres with a trivial query
// once a week to keep the Supabase free-tier project from auto-pausing
// after 7 days of inactivity. Also handy for uptime probes.

import { NextResponse } from 'next/server';
import sql from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await sql`SELECT 1 AS ok`;
    return NextResponse.json({
      ok: true,
      db: rows[0]?.ok === 1,
      ts: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e), ts: new Date().toISOString() },
      { status: 503 },
    );
  }
}
