import { NextResponse } from 'next/server';

export async function GET() {
  const blobUrl = process.env.ACCUMULATED_CSV_URL;
  if (!blobUrl) return new NextResponse('', { status: 200, headers: { 'Content-Type': 'text/csv' } });
  try {
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return new NextResponse(`Blob fetch failed: ${response.status}`, { status: 502, headers: { 'Content-Type': 'text/plain' } });
    }
    const text = await response.text();
    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'text/csv' } });
  } catch (e) {
    return new NextResponse(String(e), { status: 502, headers: { 'Content-Type': 'text/plain' } });
  }
}
