// SQL safety primitives shared by both the legacy DuckDB-backed server (still
// in use during cutover) and the new Postgres-backed server. Pure functions —
// no DB connection, no I/O.

const MAX_ROWS_WRAP = 100_000;

const FORBIDDEN_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'attach',
  'detach', 'copy', 'export', 'import', 'pragma', 'install', 'load',
  'truncate', 'grant', 'revoke', 'vacuum',
];

/**
 * Reject any SQL that isn't SELECT / WITH. Runs a keyword scan on the
 * lowercased SQL with string-literals stripped. Postgres' parser is the
 * deeper defense (it rejects multi-statement input by default), but this
 * keyword scan catches obvious issues before we reach the wire.
 */
export function validateSelectSql(sql: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (!trimmed) return { ok: false, reason: 'empty SQL' };

  const stripped = trimmed.replace(/'(?:[^']|'')*'/g, "''").toLowerCase();

  const firstToken = stripped.match(/^\s*(\w+)/)?.[1];
  if (firstToken !== 'select' && firstToken !== 'with') {
    return { ok: false, reason: `only SELECT or WITH queries allowed (got ${firstToken})` };
  }

  if (/;.*\S/.test(stripped)) {
    return { ok: false, reason: 'multi-statement queries not allowed' };
  }

  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(stripped)) {
      return { ok: false, reason: `forbidden keyword: ${kw}` };
    }
  }

  const noDoubleQuotes = stripped.replace(/"[^"]*"/g, '""');
  const fromMatches = [...noDoubleQuotes.matchAll(/\bfrom\s+([a-z_][a-z0-9_]*)/gi)];
  const joinMatches = [...noDoubleQuotes.matchAll(/\bjoin\s+([a-z_][a-z0-9_]*)/gi)];
  for (const m of [...fromMatches, ...joinMatches]) {
    const table = m[1].toLowerCase();
    if (table !== 'data' && !isKnownCte(stripped, table)) {
      return { ok: false, reason: `unknown table: ${table} (only 'data' is allowed)` };
    }
  }

  return { ok: true };
}

function isKnownCte(sql: string, name: string): boolean {
  const re = new RegExp(`(?:\\bwith\\b|,)\\s*${name}\\s+as\\s*\\(`, 'i');
  return re.test(sql);
}

/**
 * Wrap an unbounded query with LIMIT to protect against accidental huge
 * result sets. Doesn't touch queries that already have an explicit LIMIT.
 */
export function wrapWithLimit(sql: string, cap = MAX_ROWS_WRAP): string {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (/\blimit\s+\d+/i.test(trimmed)) return trimmed;
  return `SELECT * FROM (${trimmed}) __capped__ LIMIT ${cap}`;
}

export { MAX_ROWS_WRAP };
