import { list } from '@vercel/blob';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Returns the best available blob URL for the accumulated CSV.
// Prefers accumulated_public.csv (public CDN, browser-fetchable directly).
// Falls back to accumulated.csv (private, needs server proxy to download).
export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'accumulated' });
    const publicBlob = blobs.find(b => b.pathname === 'accumulated_public.csv');
    const privateBlob = blobs.find(b => b.pathname === 'accumulated.csv');
    const blob = publicBlob ?? privateBlob;
    if (!blob) {
      return NextResponse.json({ url: null, isPublic: false });
    }
    return NextResponse.json({
      url: blob.url,
      isPublic: blob.pathname === 'accumulated_public.csv',
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
