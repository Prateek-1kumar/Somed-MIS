import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  try {
    const queriesUrl = process.env.QUERIES_JSON_URL;
    if (!queriesUrl) return NextResponse.json([]);
    const response = await fetch(queriesUrl);
    if (!response.ok) return NextResponse.json([]);
    const data = await response.json() as unknown[];
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as { queries?: unknown[] };
    if (!Array.isArray(body.queries)) {
      return NextResponse.json({ error: 'queries must be an array' }, { status: 400 });
    }
    const blob = await put('saved_queries.json', JSON.stringify(body.queries), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
