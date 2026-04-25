import { list, copy } from '@vercel/blob';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Copies the private accumulated.csv to a public CDN blob so browsers can
// download it directly without streaming through a serverless function.
// copy() is a server-to-server metadata operation — it does not stream the
// blob content through this function, so it completes in milliseconds
// regardless of CSV size.
export async function POST() {
  try {
    const { blobs } = await list({ prefix: 'accumulated.csv' });
    const src = blobs.find(b => b.pathname === 'accumulated.csv');
    if (!src) {
      return NextResponse.json({ error: 'Source blob not found' }, { status: 404 });
    }
    const dest = await copy(src.url, 'accumulated_public.csv', {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return NextResponse.json({ url: dest.url });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
