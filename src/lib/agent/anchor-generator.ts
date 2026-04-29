// Deterministic NL anchor question generator. Used by scripts/reindex-anchors.ts
// to turn each ReportDef SQL into a long-form question that the embedding model
// can match against natural-language user queries.

const SELECT_RE = /SELECT([\s\S]*?)FROM/i;
const ALIAS_RE  = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
const GROUP_RE  = /GROUP\s+BY\s+([\s\S]*?)(ORDER\s+BY|LIMIT|$)/i;

export function extractAliases(sql: string): string[] {
  const sel = sql.match(SELECT_RE);
  if (!sel) return [];
  const inside = sel[1];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  ALIAS_RE.lastIndex = 0;
  while ((m = ALIAS_RE.exec(inside)) !== null) out.push(m[1]);
  return out;
}

function extractGroupCols(sql: string): string[] {
  const m = sql.match(GROUP_RE);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim()).filter(Boolean);
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase();
}

/**
 * Build a long-form natural-language question that summarizes what a report
 * computes, suitable for embedding-based retrieval.
 *
 * Example:
 *   name = "Sales Analysis"
 *   aliases = ["primary_sale", "net_primary", "achievement_pct"]
 *   group  = ["zbm", "abm", "hq_new"]
 * → "What are the primary sale, net primary and achievement pct broken down
 *    by zbm, abm and hq new for the Sales Analysis report?"
 */
export function generateAnchorQuestion(name: string, sql: string): string {
  const aliases = extractAliases(sql).map(humanize);
  const group   = extractGroupCols(sql).map(humanize);
  const aliasPart = aliases.length === 0
    ? 'metrics'
    : aliases.length === 1
      ? aliases[0]
      : `${aliases.slice(0, -1).join(', ')} and ${aliases[aliases.length - 1]}`;
  const groupPart = group.length === 0
    ? ''
    : group.length === 1
      ? ` broken down by ${group[0]}`
      : ` broken down by ${group.slice(0, -1).join(', ')} and ${group[group.length - 1]}`;
  return `What are the ${aliasPart}${groupPart} for the ${name} report?`;
}
