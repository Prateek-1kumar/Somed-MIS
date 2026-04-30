// POST /api/golden-examples/un-verify  { id }
// Removes a previously-verified example so it no longer influences agent answers.
// Kept as a distinct endpoint (vs DELETE) so the client intent is explicit in
// logs and telemetry.

import { NextRequest, NextResponse } from 'next/server';
import goldenStore from '@/lib/golden-examples';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { id?: string };
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await goldenStore.unVerify(body.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
