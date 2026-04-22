import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { accumulatedCsv?: string };
    if (typeof body.accumulatedCsv !== 'string') {
      return NextResponse.json({ error: 'accumulatedCsv must be a string' }, { status: 400 });
    }
    const blob = await put('accumulated.csv', body.accumulatedCsv, {
      access: 'public',
      contentType: 'text/csv',
      addRandomSuffix: false,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
