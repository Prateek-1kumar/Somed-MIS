// src/app/api/nl-to-sql/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { generateSql } from '@/lib/ai';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { question?: string };
    if (!body.question?.trim()) {
      return NextResponse.json({ error: 'question required' }, { status: 400 });
    }
    const result = await generateSql(body.question);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: 'AI unavailable — write SQL manually', detail: String(e) }, { status: 500 });
  }
}
