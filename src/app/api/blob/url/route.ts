import { list } from '@vercel/blob';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Returns the pre-signed download URL for the accumulated CSV blob so the
// client can fetch it directly from blob storage. This avoids streaming large
// CSVs through a Vercel serverless function, which causes 502 timeouts.
export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'accumulated.csv' });
    const blob = blobs.find(b => b.pathname === 'accumulated.csv');
    if (!blob) {
      return NextResponse.json({ url: null });
    }
    return NextResponse.json({ url: blob.downloadUrl });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
