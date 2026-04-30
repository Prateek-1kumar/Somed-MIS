#!/usr/bin/env node
// One-shot seed: populate `entity_values` from existing `data` rows by
// running `refreshEntityIndex` once. Idempotent — re-running just refreshes
// `display_count`. Use after bringing up the RAG migration on a database
// that already has data ingested before the ingest-route hook existed.

import { config as loadDotenv } from 'dotenv';
// Load .env.local first (Next-style overrides), then .env as a fallback.
loadDotenv({ path: '.env.local' });
loadDotenv();

import postgres from 'postgres';
import { refreshEntityIndex } from '../src/lib/entity-index';

// Direct postgres-js client — we don't import `src/lib/db.ts` because that
// module evaluates env vars at import time, which runs BEFORE `loadDotenv()`
// can populate them.
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('SUPABASE_DB_URL is not set. Aborting.');
  process.exit(1);
}
const sql = postgres(dbUrl, { max: 1, prepare: false });

async function main(): Promise<void> {
  console.log('Refreshing entity_values from data…');
  await refreshEntityIndex(sql);
  const counts = await sql<{ kind: string; n: string }[]>`
    SELECT kind, COUNT(*)::text AS n FROM entity_values GROUP BY kind ORDER BY kind
  `;
  for (const c of counts) console.log(`  ${c.kind}: ${c.n}`);
  await sql.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
