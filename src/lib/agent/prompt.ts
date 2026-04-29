// System prompt builder. Concatenates: role + schema + full column dictionary
// + power prompt (decision flow, traps, formulas, chart rules) + computed
// data dictionary + retrieved golden examples + retrieved ReportDef anchors
// + conversation history + structured-output contract.
//
// Static blocks (column dictionary + power prompt + schema list + output
// contract) are candidates for Gemini explicit-cache prefix in a follow-up.

import type { DataDictionary } from '../server-db';
import type { AnchorRow, GoldenRow } from '../retrieval';
import { CSV_COLUMNS } from '../schema';
import { COLUMN_DESCRIPTIONS } from '../column-descriptions';
import { POWER_PROMPT } from './power-prompt';

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

function summarizeColumnDictionary(): string {
  const lines = (Object.keys(COLUMN_DESCRIPTIONS) as Array<keyof typeof COLUMN_DESCRIPTIONS>)
    .map(col => `- \`${col}\`: ${COLUMN_DESCRIPTIONS[col]}`)
    .join('\n');
  return `COLUMN DICTIONARY (full schema with semantics — cross-check before writing SQL):\n${lines}`;
}

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

function summarizeGoldenExamples(examples: GoldenRow[]): string {
  if (examples.length === 0) {
    return 'GOLDEN EXAMPLES: (none retrieved for this question)';
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

function summarizeAnchors(anchors: AnchorRow[]): string {
  if (anchors.length === 0) {
    return 'REPORT TEMPLATES: (none retrieved)';
  }
  const lines = anchors.map((a, i) =>
    `[Template ${i + 1}] ${a.name} (${a.group_name})\n  Anchor: ${a.anchor_question}\n  SQL: ${a.source_sql}`,
  ).join('\n\n');
  return `REPORT TEMPLATES (expert-authored SQL — adapt these):\n\n${lines}`;
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
  goldenExamples: GoldenRow[];
  anchors: AnchorRow[];
  history: ConversationTurn[];
}

export function buildSystemPrompt(input: BuildPromptInput): string {
  const { dictionary, goldenExamples, anchors, history } = input;
  const schemaLine = `SCHEMA: Single table 'data' with columns: ${CSV_COLUMNS.join(', ')}`;
  return [
    'You are a senior pharma-sales data analyst for Shomed Remedies MIS.',
    'Your job is to answer the user\'s question ACCURATELY using the Postgres `data` table.',
    'Be decisive. If ambiguous, ask ONE targeted question instead of guessing.',
    '',
    schemaLine,
    '',
    summarizeColumnDictionary(),
    '',
    POWER_PROMPT,
    '',
    summarizeDictionary(dictionary),
    '',
    summarizeGoldenExamples(goldenExamples),
    '',
    summarizeAnchors(anchors),
    '',
    summarizeHistory(history),
    '',
    OUTPUT_CONTRACT,
  ].join('\n');
}
