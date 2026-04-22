import { list } from '@vercel/blob';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'accumulated.csv' });
    const blob = blobs.find(b => b.pathname === 'accumulated.csv');
    if (!blob) return new NextResponse('', { status: 200, headers: { 'Content-Type': 'text/csv' } });
    const response = await fetch(blob.url, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!response.ok) {
      return new NextResponse(`Blob fetch failed: ${response.status}`, { status: 502, headers: { 'Content-Type': 'text/plain' } });
    }
    const text = await response.text();
    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'text/csv' } });
  } catch (e) {
    return new NextResponse(String(e), { status: 502, headers: { 'Content-Type': 'text/plain' } });
  }
}
