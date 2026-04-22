import { list, put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'saved_queries.json' });
    const blob = blobs.find(b => b.pathname === 'saved_queries.json');
    if (!blob) return NextResponse.json([]);
    const response = await fetch(blob.downloadUrl);
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
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
