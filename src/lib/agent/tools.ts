// Tool implementations + FunctionDeclaration specs for the agent loop.
//
// Four data/memory tools + two "sentinel" response tools. The sentinel tools
// mark the end of the turn — the agent MUST call exactly one of them to end
// a round.

import type { ServerDb } from '../server-db';
import {
  retrieveGoldenExamples,
  retrieveReportAnchors,
  retrieveAll,
  retrieveEntities,
} from '../retrieval';
import { isEntityColumn, ENTITY_KIND_BY_COLUMN } from '../entity-index';
import type {
  ToolDefinition,
  ToolCall,
  FinalAnswer,
  FinalClarification,
  StructuredFinal,
  ChartType,
} from './types';

const VALID_CHART_TYPES = new Set<ChartType>([
  'kpi', 'line', 'bar', 'hbar', 'pie', 'stacked_bar', 'table_only',
]);

// ── Tool declarations passed to Gemini ────────────────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_values',
    description:
      'Find values matching a pattern in a column. Use before referencing any named entity (brand, item, doctor) in SQL. Pattern is a substring — it will be wrapped in LIKE "%...%".',
    parameters: {
      type: 'object',
      properties: {
        column: { type: 'string', description: 'column name (e.g., item_name, dr_name)' },
        pattern: { type: 'string', description: 'substring to search for' },
        limit: { type: 'integer', description: 'max values to return (default 20)' },
      },
      required: ['column', 'pattern'],
    },
  },
  {
    name: 'list_distinct_values',
    description:
      'List distinct values of a small categorical column. Use when search_values returns nothing or you need the full option set.',
    parameters: {
      type: 'object',
      properties: {
        column: { type: 'string', description: 'column name (e.g., fy, seg, zbm)' },
        limit: { type: 'integer', description: 'max values to return (default 100)' },
      },
      required: ['column'],
    },
  },
  {
    name: 'run_sql',
    description:
      'Execute a DuckDB SELECT against the data table. Returns rows + columns. SELECT-only; any write keyword is rejected. Auto-wrapped with LIMIT 100000 if no LIMIT given. Call this to get real data to answer the user.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'a complete DuckDB SELECT statement' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'retrieve',
    description:
      'Retrieve more team-verified Q→SQL examples and/or expert ReportDef SQL templates that match a refined question. Top-K of each are already in your system prompt; call this when the upfront slice felt off-topic.',
    parameters: {
      type: 'object',
      properties: {
        query:  { type: 'string', description: 'natural-language question to match patterns against' },
        corpus: { type: 'string', description: "one of: 'golden' | 'reports' | 'all' (default 'all')" },
        k:      { type: 'integer', description: 'max examples to return (default 5; for corpus=all, k goldens + ceil(k*0.6) anchors)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'respond_with_answer',
    description:
      'Finalize this turn with a complete answer. Call this ONLY when you have enough information from the data to answer accurately.',
    parameters: {
      type: 'object',
      properties: {
        narrative: { type: 'string', description: 'one paragraph, plain English explanation of the result' },
        headline: { type: 'string', description: 'one-line takeaway for a KPI card' },
        sql: { type: 'string', description: 'the exact SELECT that produced the result' },
        chart_type: { type: 'string', description: 'one of: kpi, line, bar, hbar, pie, stacked_bar, table_only' },
        chart_x: { type: 'string', description: 'CATEGORY column (the text / grouping column). ALWAYS the categorical column, even for hbar. Do NOT put a numeric column here.' },
        chart_y: { type: 'string', description: 'VALUE column (the numeric column being plotted). Optional.' },
        chart_series: { type: 'string', description: 'Optional column for multi-series breakdown (e.g., seg for stacked_bar).' },
        assumptions: { type: 'string', description: 'semicolon-separated list of assumptions made' },
        follow_ups: { type: 'string', description: 'pipe-separated list of 2-4 natural follow-up questions' },
      },
      required: ['narrative', 'headline', 'sql', 'chart_type'],
    },
  },
  {
    name: 'respond_with_clarification',
    description:
      'Ask ONE specific clarifying question when the user\'s request is ambiguous. Call this ONLY when you genuinely cannot decide how to proceed without more info.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'one specific clarifying question' },
        choices: { type: 'string', description: 'pipe-separated list of 2-4 likely options (optional)' },
      },
      required: ['question'],
    },
  },
];

export const RESPONSE_TOOL_NAMES = new Set(['respond_with_answer', 'respond_with_clarification']);

// ── Tool execution ────────────────────────────────────────────────────────

export interface ToolContext {
  db: ServerDb;
}

export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<unknown> {
  switch (call.name) {
    case 'search_values': return searchValues(call.args, ctx);
    case 'list_distinct_values': return listDistinctValues(call.args, ctx);
    case 'run_sql': return runSqlTool(call.args, ctx);
    case 'retrieve': return retrieveTool(call.args);
    default:
      return { error: `unknown tool: ${call.name}` };
  }
}

// Column allowlist — we want to stop the agent from scanning arbitrary
// user-supplied identifiers. Only columns from the real schema are allowed.
import { CSV_COLUMNS } from '../schema';
const COLUMN_SET = new Set<string>(CSV_COLUMNS);

function requireColumn(column: unknown): string {
  if (typeof column !== 'string' || !COLUMN_SET.has(column)) {
    throw new Error(`unknown column: ${String(column)}`);
  }
  return column;
}

async function searchValues(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  try {
    const column = requireColumn(args.column);
    const pattern = String(args.pattern ?? '').trim();
    if (!pattern) return { error: 'pattern required' };
    const limit = clampInt(args.limit, 1, 100, 20);

    // Tier 1: pg_trgm via entity_values for columns mapped to an EntityKind.
    // Catches misspellings (e.g., "crockin" → CROCIN) and is faster than ILIKE
    // on the 129K-row data table. Falls through to Tier 2 on zero matches.
    if (isEntityColumn(column)) {
      const kind = ENTITY_KIND_BY_COLUMN[column as keyof typeof ENTITY_KIND_BY_COLUMN]!;
      const matches = await retrieveEntities(kind, pattern, limit);
      if (matches.length > 0) {
        return {
          values: matches.map(m => m.value),
          rowCount: matches.length,
          source: 'entity_index',
        };
      }
    }

    // Tier 2: ILIKE fallback over the live data table.
    const safePattern = pattern.replace(/'/g, "''");
    const sql = `SELECT DISTINCT ${column} AS value FROM data WHERE ${column} ILIKE '%${safePattern}%' AND ${column} IS NOT NULL AND TRIM(${column}) <> '' ORDER BY ${column} LIMIT ${limit}`;
    const result = await ctx.db.runTrusted(sql);
    if (result.error) return { error: result.error };
    return {
      values: result.rows.map(r => r.value),
      rowCount: result.rowCount,
      source: 'data_ilike',
    };
  } catch (e) {
    return { error: String(e) };
  }
}

async function listDistinctValues(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  try {
    const column = requireColumn(args.column);
    const limit = clampInt(args.limit, 1, 500, 100);
    const sql = `SELECT DISTINCT ${column} AS value FROM data WHERE ${column} IS NOT NULL AND TRIM(${column}) <> '' ORDER BY ${column} LIMIT ${limit}`;
    const result = await ctx.db.runTrusted(sql);
    if (result.error) return { error: result.error };
    return { values: result.rows.map(r => r.value), rowCount: result.rowCount };
  } catch (e) {
    return { error: String(e) };
  }
}

async function runSqlTool(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const sql = String(args.sql ?? '');
  if (!sql.trim()) return { error: 'sql required' };
  const result = await ctx.db.runSafe(sql);
  if (result.error) return { error: result.error };
  // Cap response payload so the model doesn't get flooded.
  const rows = result.rows.slice(0, 200);
  return {
    rows,
    columns: result.columns,
    rowCount: result.rowCount,
    truncated: result.truncated,
    preview_note: rows.length < result.rowCount
      ? `showing first ${rows.length} of ${result.rowCount} rows`
      : undefined,
  };
}

async function retrieveTool(args: Record<string, unknown>): Promise<unknown> {
  try {
    const query = String(args.query ?? '').trim();
    const corpus = String(args.corpus ?? 'all') as 'golden' | 'reports' | 'all';
    const k = clampInt(args.k, 1, 10, 5);
    if (!query) return { error: 'query required' };

    if (corpus === 'golden') {
      const examples = await retrieveGoldenExamples(query, { k });
      return {
        golden: examples.map(e => ({
          question: e.question,
          sql: e.sql,
          status: e.status,
          correction_note: e.correction_note,
          narrative: e.narrative,
        })),
      };
    }
    if (corpus === 'reports') {
      const anchors = await retrieveReportAnchors(query, { k });
      return {
        anchors: anchors.map(a => ({
          name: a.name,
          group: a.group_name,
          anchor_question: a.anchor_question,
          sql: a.source_sql,
        })),
      };
    }
    // corpus === 'all' (default): k goldens + ceil(k*0.6) anchors, embed once.
    const r = await retrieveAll(query, { goldenK: k, anchorsK: Math.ceil(k * 0.6) });
    return {
      golden: r.golden.map(e => ({
        question: e.question,
        sql: e.sql,
        status: e.status,
        correction_note: e.correction_note,
        narrative: e.narrative,
      })),
      anchors: r.anchors.map(a => ({
        name: a.name,
        group: a.group_name,
        anchor_question: a.anchor_question,
        sql: a.source_sql,
      })),
    };
  } catch (e) {
    return { error: String(e) };
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ── Response-tool parsing ─────────────────────────────────────────────────

/**
 * Parse a sentinel tool call into a StructuredFinal. Returns undefined if the
 * call isn't a sentinel. Throws on malformed args — caller should feed the
 * error back to the model.
 */
export function parseResponseTool(call: ToolCall): StructuredFinal | undefined {
  if (call.name === 'respond_with_answer') {
    const args = call.args as Record<string, unknown>;
    const chart = String(args.chart_type ?? 'table_only') as ChartType;
    if (!VALID_CHART_TYPES.has(chart)) {
      throw new Error(`invalid chart_type: ${chart}`);
    }
    const assumptions = String(args.assumptions ?? '')
      .split(/[;\n]+/).map(s => s.trim()).filter(Boolean);
    const followUps = String(args.follow_ups ?? '')
      .split(/[|\n]+/).map(s => s.trim()).filter(Boolean);
    const answer: FinalAnswer = {
      kind: 'answer',
      narrative: String(args.narrative ?? '').trim(),
      headline: String(args.headline ?? '').trim(),
      sql: String(args.sql ?? '').trim(),
      chart_type: chart,
      chart_hints: {
        x: args.chart_x ? String(args.chart_x) : undefined,
        y: args.chart_y ? String(args.chart_y) : undefined,
        series: args.chart_series ? String(args.chart_series) : undefined,
      },
      assumptions,
      follow_ups: followUps,
    };
    if (!answer.narrative || !answer.sql) {
      throw new Error('respond_with_answer missing narrative or sql');
    }
    return answer;
  }
  if (call.name === 'respond_with_clarification') {
    const args = call.args as Record<string, unknown>;
    const choices = String(args.choices ?? '')
      .split(/[|\n]+/).map(s => s.trim()).filter(Boolean);
    const clarify: FinalClarification = {
      kind: 'clarify',
      clarify_question: String(args.question ?? '').trim(),
      clarify_choices: choices.length > 0 ? choices : undefined,
    };
    if (!clarify.clarify_question) {
      throw new Error('respond_with_clarification missing question');
    }
    return clarify;
  }
  return undefined;
}
