#!/usr/bin/env node
// One-shot migration: read existing golden_examples.json from Vercel Blob,
// INSERT each row into the new Postgres `golden_examples` table, embed each
// row's question, and archive the blob (renamed → .archived) for 30-day
// rollback safety.
//
// Idempotent: rows whose `id` already exists in Postgres are skipped.
// Empty blob: prints "Nothing to migrate" and exits 0.

import { config as loadDotenv } from 'dotenv';
// Load .env.local first (Next-style overrides), then .env as a fallback.
loadDotenv({ path: '.env.local' });
loadDotenv();

import { list, put, del } from '@vercel/blob';
import postgres from 'postgres';
import { embedTexts, sha256, toVectorLiteral } from '../src/lib/embeddings';

// Direct postgres-js client — we don't import `src/lib/db.ts` because that
// module evaluates env vars at import time, which runs BEFORE `loadDotenv()`
// can populate them.
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('SUPABASE_DB_URL is not set. Aborting.');
  process.exit(1);
}
const sql = postgres(dbUrl, { max: 1, prepare: false });

const BLOB_PATH = 'golden_examples.json';
const ARCHIVED_PATH = 'golden_examples.json.archived';
const BATCH = 100;

interface OldGolden {
  id: string;
  question: string;
  question_tags?: string[];
  narrative: string;
  sql: string;
  chart_type: string;
  assumptions?: string[];
  status: 'verified' | 'corrected';
  correction_note?: string;
  created_at: string;
  verified_at: string;
  use_count: number;
}

async function readBlob(): Promise<{ examples: OldGolden[]; url?: string }> {
  const { blobs } = await list({ prefix: BLOB_PATH });
  const blob = blobs.find(b => b.pathname === BLOB_PATH);
  if (!blob) return { examples: [] };
  const res = await fetch(blob.url, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`fetch blob: ${res.status} ${res.statusText}`);
  const json = await res.json() as unknown;
  if (!Array.isArray(json)) return { examples: [], url: blob.url };
  return { examples: json as OldGolden[], url: blob.url };
}

async function main(): Promise<void> {
  console.log('Reading existing golden_examples.json from Vercel Blob…');
  const { examples: old, url: blobUrl } = await readBlob();
  console.log(`Found ${old.length} examples in blob.`);
  if (old.length === 0) {
    console.log('Nothing to migrate. Exiting.');
    await sql.end();
    return;
  }

  // Skip IDs that are already in Postgres.
  const existing = await sql<{ id: string }[]>`SELECT id FROM golden_examples`;
  const existingIds = new Set(existing.map(r => r.id));
  const toInsert = old.filter(o => !existingIds.has(o.id));
  console.log(`${toInsert.length} new (others already in DB).`);

  let inserted = 0;
  if (toInsert.length > 0) {
    for (let off = 0; off < toInsert.length; off += BATCH) {
      const chunk = toInsert.slice(off, off + BATCH);
      console.log(`Embedding chunk ${off}–${off + chunk.length}…`);
      const embeddings = await embedTexts(chunk.map(o => o.question));
      for (let i = 0; i < chunk.length; i++) {
        const o = chunk[i];
        const v = embeddings[i];
        const search_text = o.question;
        const vec = toVectorLiteral(v);
        await sql`
          INSERT INTO golden_examples
            (id, question, narrative, sql, chart_type, assumptions, status,
             correction_note, created_at, verified_at, use_count, search_text,
             embedding, embedding_sha)
          VALUES
            (${o.id}, ${o.question}, ${o.narrative}, ${o.sql}, ${o.chart_type},
             ${o.assumptions ?? []}, ${o.status}, ${o.correction_note ?? null},
             ${o.created_at}, ${o.verified_at}, ${o.use_count},
             ${search_text}, ${sql.unsafe(`'${vec}'::vector`)}, ${sha256(search_text)})
          ON CONFLICT (id) DO NOTHING
        `;
        inserted += 1;
      }
    }
  }

  // Archive the original blob (kept for 30 days) then delete the active one.
  console.log('Archiving original blob…');
  await put(ARCHIVED_PATH, JSON.stringify(old, null, 2), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  if (blobUrl) await del(blobUrl);

  const finalCount = await sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM golden_examples`;
  console.log(
    `Migration complete. Inserted ${inserted}; ${finalCount[0]?.n} rows total. Archived blob retained as ${ARCHIVED_PATH} (delete after 30 days).`,
  );
  await sql.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
