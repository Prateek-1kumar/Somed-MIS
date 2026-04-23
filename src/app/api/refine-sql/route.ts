import { NextRequest, NextResponse } from 'next/server';
import { refineSql } from '@/lib/ai';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { currentSql?: string; instruction?: string; reportTitle?: string };
    if (typeof body.currentSql !== 'string' || !body.currentSql.trim()) {
      return NextResponse.json({ error: 'currentSql is required' }, { status: 400 });
    }
    if (typeof body.instruction !== 'string' || !body.instruction.trim()) {
      return NextResponse.json({ error: 'instruction is required' }, { status: 400 });
    }
    const result = await refineSql(
      body.currentSql,
      body.instruction,
      body.reportTitle ?? 'report',
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
