import { list } from '@vercel/blob';
import { NextResponse } from 'next/server';

// Force Node.js runtime so we get the full streaming behaviour on Vercel.
export const runtime = 'nodejs';
// Don't cache — clients need the freshest blob after every upload.
export const dynamic = 'force-dynamic';
// Extend timeout for the server-proxy fallback used when the blob is private.
export const maxDuration = 60;

export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'accumulated.csv' });
    const blob = blobs.find(b => b.pathname === 'accumulated.csv');
    if (!blob) {
      return new NextResponse('', { status: 200, headers: { 'Content-Type': 'text/csv' } });
    }
    const upstream = await fetch(blob.downloadUrl, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!upstream.ok || !upstream.body) {
      return new NextResponse(`Blob fetch failed: ${upstream.status}`, {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    // Stream the blob body straight through. Materializing the CSV via
    // response.text() would hit Vercel's 4.5 MB serverless response cap for
    // any dataset over that size.
    const headers = new Headers({
      'Content-Type': 'text/csv',
      'Cache-Control': 'no-store',
    });
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) headers.set('Content-Length', contentLength);
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (e) {
    return new NextResponse(String(e), { status: 502, headers: { 'Content-Type': 'text/plain' } });
  }
}
