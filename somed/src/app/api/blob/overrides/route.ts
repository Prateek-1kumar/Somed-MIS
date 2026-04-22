import { list, put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

type Override = { sql: string; savedAt: string };

export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'report_overrides.json' });
    const blob = blobs.find(b => b.pathname === 'report_overrides.json');
    if (!blob) return NextResponse.json({});
    const response = await fetch(blob.url, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!response.ok) return NextResponse.json({});
    const data = await response.json() as Record<string, Override>;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({});
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as { overrides?: Record<string, Override> };
    if (!body.overrides || typeof body.overrides !== 'object' || Array.isArray(body.overrides)) {
      return NextResponse.json({ error: 'overrides must be an object' }, { status: 400 });
    }
    const blob = await put('report_overrides.json', JSON.stringify(body.overrides), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
