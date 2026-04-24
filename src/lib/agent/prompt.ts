// System prompt builder. Concatenates the role + schema + formula dictionary
// + data-dictionary summary + retrieved golden examples + behavioral rules +
// the structured-output contract into one prompt string.

import type { DataDictionary } from '../server-duckdb';
import type { GoldenExample } from '../golden-examples';
import { CSV_COLUMNS } from '../schema';

const FORMULA_DICTIONARY = `
KEY FORMULAS — use these exactly:
- Primary Sales       = SUM(net_sales_)
- Primary Target      = SUM(tgt_val_p)
- Primary Ach%        = ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1)
- Secondary Sales     = SUM(sales_valu)
- Secondary Target    = SUM(tgt_val_s)
- Secondary Ach%      = ROUND(SUM(sales_valu)/NULLIF(SUM(tgt_val_s),0)*100,1)
- FOC Value           = SUM(foc_value)   ← NOT foc_value_, NOT foc_val_n
- FOC Qty             = SUM(foc_qty__s + cn_qty)
- Net Secondary       = SUM(sales_valu) - SUM(foc_val_n)
- Total Secondary     = SUM(sales_valu) - SUM(foc_val_n) + SUM(foc_value)
- Total Expenses      = SUM(foc_value) + SUM(sample_exp) + SUM(mrkt_exp) + SUM(camp_exp)
- Sale Primary        = SUM(sale_sales)
- Returning Primary   = SUM(gri_sales)   ← negative values
- RDSI Primary        = SUM(rdsi_sales)  ← negative values
- Net Primary         = SUM(net_sales_)
- Total Returning     = SUM(return_amt)  ← negative values
- Expired Returning   = SUM(expired)
- Near 3m expiry      = SUM(near_3)
- Near 6m expiry      = SUM(near_6)
- Near 9m expiry      = SUM(near_9)
- Long Expiry (>9m)   = SUM(return_amt)-SUM(expired)-SUM(near_3)-SUM(near_6)-SUM(near_9)
- PAP Patients        = SUM(no_patient) * 1000
- DCPP Patients       = SUM(dc_patient) * 1000
- Exclude inactive    = WHERE item_name NOT LIKE '(INACTIVE)%'
`.trim();

const BEHAVIORAL_RULES = `
BEHAVIORAL RULES (read these, they are non-negotiable):
1. If ANY term is ambiguous (metric, period, brand, scope, comparison baseline),
   call respond_with_clarification with ONE specific question — never guess.
2. Before writing SQL that references any brand/item/doctor by name, call
   search_values first to confirm the canonical value. If search_values returns
   zero matches, ask the user via respond_with_clarification. Do not guess spellings.
3. Exclude inactive items by default: add AND item_name NOT LIKE '(INACTIVE)%'
   to every query unless the user explicitly asks for inactive items.
4. Always SELECT with explicit column names. Never SELECT *.
5. Wrap money with ROUND(..., 2) and percentages with ROUND(..., 1).
6. Only the table 'data' exists. No JOINs needed.
7. For trend questions, sort by period ASC and use chart_type "line".
   For ranked lists (top N), use chart_type "hbar" sorted DESC with a LIMIT.
   For single-number answers, use chart_type "kpi".
   For 2D breakdowns (e.g., by HQ × segment), use "stacked_bar".
   When the data is best shown as a table, use "table_only" (no chart).
8. When setting chart_x: it is ALWAYS the CATEGORY column (text grouping),
   NEVER the numeric value column. For "top 10 HQs by sales" with
   SELECT hq_new, SUM(sales_valu) AS secondary_sales, chart_x = "hq_new"
   (not "secondary_sales"). This rule applies to hbar too — even though
   bars go horizontal visually, chart_x is still the category name.
9. In your SQL, put the CATEGORY column first in the SELECT list and the
   numeric column(s) second. This makes downstream rendering reliable.
10. CRITICAL — tool-call formatting:
    - Write SQL as ONE SINGLE LINE inside the sql argument. Use spaces, not
      newlines. Do NOT pretty-print, do NOT use SQL comments, do NOT embed
      line breaks. The tool-call JSON parser rejects unescaped newlines.
    - BAD:  "sql": "WITH t AS (\n  SELECT a FROM data\n)\nSELECT * FROM t"
    - GOOD: "sql": "WITH t AS (SELECT a FROM data) SELECT * FROM t"
    - Keep each tool call's total argument payload under ~2000 characters.
`.trim();

const OUTPUT_CONTRACT = `
WHEN RESPONDING TO THE USER:
Call exactly one of these two tools to end the turn. Do NOT produce plain text
replies — your final answer MUST go through one of these tools.

Tool: respond_with_answer
  Args:
    narrative (string): one paragraph in plain English explaining the result.
    headline (string): one-line takeaway suitable for a KPI card.
    sql (string): the exact SELECT that produced the final result.
    chart_type (string): one of kpi, line, bar, hbar, pie, stacked_bar, table_only.
    chart_x (string, optional): column name for x-axis.
    chart_y (string, optional): column name for y-axis.
    chart_series (string, optional): column for multi-series breakdown.
    assumptions (string): semicolon-separated list of assumptions you made.
    follow_ups (string): pipe-separated list of 2-4 natural follow-up questions.

Tool: respond_with_clarification
  Args:
    question (string): ONE specific clarifying question.
    choices (string, optional): pipe-separated list of 2-4 likely answer options.
`.trim();

function summarizeDictionary(d: DataDictionary): string {
  const brandLines = Object.entries(d.brand_families)
    .slice(0, 50)
    .map(([family, skus]) => `    ${family}: ${skus.length} SKU${skus.length === 1 ? '' : 's'}`)
    .join('\n');
  return `
DATA DICTIONARY (derived from the live data):
- Total rows: ${d.row_count.toLocaleString()}
- Latest period (yyyymm): ${d.latest_period ?? 'unknown'}
- Financial years: ${d.fy_range.join(', ')}
- Segments: ${d.segments.join(', ')}
- ZBMs: ${d.zbms.join(', ')}
- HQs: ${d.hqs.join(', ')}
- Brand families (top 50 by name):
${brandLines}
- Use search_values(column="item_name", pattern="<family>") to list all SKUs in a family.
`.trim();
}

function summarizeGoldenExamples(examples: GoldenExample[]): string {
  if (examples.length === 0) {
    return 'GOLDEN EXAMPLES: (none yet for this question pattern)';
  }
  const lines = examples.map((e, i) => {
    const verdict = e.status === 'corrected'
      ? `corrected on ${e.verified_at.slice(0, 10)}`
      : `verified on ${e.verified_at.slice(0, 10)}`;
    const lesson = e.correction_note ? `\n  Lesson: ${e.correction_note}` : '';
    return `[Example ${i + 1}] (${verdict}, used ${e.use_count}x)
  Q: ${e.question}
  SQL: ${e.sql}${lesson}`;
  }).join('\n\n');
  return `GOLDEN EXAMPLES (team-verified patterns — follow the same logic):\n\n${lines}`;
}

function summarizeHistory(turns: ConversationTurn[]): string {
  if (turns.length === 0) return 'CONVERSATION HISTORY: (this is the first turn)';
  const lines = turns.map((t, i) => {
    const corr = t.correction_note ? ` [USER CORRECTION: ${t.correction_note}]` : '';
    const sqlLine = t.sql ? `\n  (SQL: ${t.sql})` : '';
    return `[turn ${i + 1}, ${t.role}]: ${t.content}${sqlLine}${corr}`;
  }).join('\n');
  return `CONVERSATION HISTORY (last ${turns.length} turns):\n${lines}`;
}

import type { ConversationTurn } from './types';

export interface BuildPromptInput {
  dictionary: DataDictionary;
  goldenExamples: GoldenExample[];
  history: ConversationTurn[];
}

export function buildSystemPrompt(input: BuildPromptInput): string {
  const { dictionary, goldenExamples, history } = input;
  const schemaLine = `SCHEMA: Single table 'data' with columns: ${CSV_COLUMNS.join(', ')}`;
  return [
    'You are a senior pharma-sales data analyst for Shomed Remedies MIS.',
    'Your job is to answer the user\'s question ACCURATELY using the DuckDB `data` table.',
    'Be decisive. If ambiguous, ask ONE targeted question instead of guessing.',
    '',
    schemaLine,
    '',
    FORMULA_DICTIONARY,
    '',
    summarizeDictionary(dictionary),
    '',
    summarizeGoldenExamples(goldenExamples),
    '',
    summarizeHistory(history),
    '',
    BEHAVIORAL_RULES,
    '',
    OUTPUT_CONTRACT,
  ].join('\n');
}
