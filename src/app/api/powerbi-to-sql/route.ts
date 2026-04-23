// src/app/api/powerbi-to-sql/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { convertPowerBiSql } from '@/lib/ai';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { sql?: string };
    if (!body.sql?.trim()) {
      return NextResponse.json({ error: 'sql required' }, { status: 400 });
    }
    const convertedSql = await convertPowerBiSql(body.sql);
    return NextResponse.json({ convertedSql });
  } catch (e) {
    return NextResponse.json({ error: 'Conversion failed', detail: String(e) }, { status: 500 });
  }
}
