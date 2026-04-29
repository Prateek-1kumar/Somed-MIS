// Postgres client singleton. Talks to Supabase via the transaction-mode
// pooler (port 6543), which means no session state between queries — that's
// why prepared statements are disabled.
//
// One connection per warm Lambda. The pooler multiplexes for us.

import postgres from 'postgres';

const url = process.env.SUPABASE_DB_URL;
if (!url && typeof window === 'undefined' && process.env.NODE_ENV !== 'test') {
  // Fail loudly at import time on the server. Tests inject their own client.
  throw new Error(
    'SUPABASE_DB_URL is not set. Add the Supabase transaction-pooler '
    + 'connection string (port 6543) to .env.local and Vercel project env.',
  );
}

const sql = postgres(url ?? 'postgres://invalid', {
  max: 1,
  idle_timeout: 20,
  prepare: false,
});

export default sql;
