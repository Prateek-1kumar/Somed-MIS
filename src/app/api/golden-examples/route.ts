// Golden-examples CRUD.
// GET    /api/golden-examples          — list all
// POST   /api/golden-examples          — add one (body is the pending record)
// DELETE /api/golden-examples?id=X     — remove by id
//
// Un-verify lives at /api/golden-examples/un-verify for a cleaner client
// intent (it semantically differs from remove even though the persistence
// effect is the same).

import { NextRequest, NextResponse } from 'next/server';
import { createStore, vercelBlobGoldenProvider, type NewGoldenExampleInput } from '@/lib/golden-examples';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const store = createStore(vercelBlobGoldenProvider);

export async function GET() {
  try {
    const all = await store.list();
    return NextResponse.json(all);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as NewGoldenExampleInput & { question?: string; sql?: string };
    if (!body.question?.trim() || !body.sql?.trim()) {
      return NextResponse.json({ error: 'question and sql are required' }, { status: 400 });
    }
    // Enrich tags using the live dictionary so brand/segment/HQ mentions
    // get picked up. If the server DuckDB isn't warm yet, fall back to
    // text-only tag extraction.
    let dictionary;
    try {
      const { getServerDb } = await import('@/lib/server-duckdb');
      const db = await getServerDb();
      dictionary = db.dictionary;
    } catch {
      dictionary = undefined;
    }
    const created = await store.add({
      question: body.question,
      narrative: body.narrative ?? '',
      sql: body.sql,
      chart_type: body.chart_type ?? 'table_only',
      assumptions: body.assumptions ?? [],
      status: body.status ?? 'verified',
      correction_note: body.correction_note,
      dictionary,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });
    await store.remove(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
