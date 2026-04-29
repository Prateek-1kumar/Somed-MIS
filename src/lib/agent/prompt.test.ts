/**
 * @jest-environment node
 */
import { buildSystemPrompt } from './prompt';
import type { DataDictionary } from '../server-db';
import type { GoldenRow, AnchorRow } from '../retrieval';

const DICT: DataDictionary = {
  generated_at: '2026-04-24T00:00:00Z',
  row_count: 129117,
  fy_range: ['2024-2025', '2025-2026'],
  segments: ['NEURO', 'ORTHO'],
  zbms: ['ZBM MP'],
  hqs: ['HARDA', 'AGRA'],
  brand_families: {
    SHOVERT: ['SHOVERT-8 TAB 10S', 'SHOVERT-16 TAB 10S'],
    SHOCOX: ['SHOCOX-T4 TAB'],
  },
  doctors_top_200: [],
  latest_period: '202512',
};

function buildGolden(overrides: Partial<GoldenRow> = {}): GoldenRow {
  return {
    id: 'ge_1',
    question: 'Top brands',
    narrative: '',
    sql: 'SELECT 1',
    chart_type: 'hbar',
    status: 'verified',
    correction_note: null,
    use_count: 0,
    verified_at: '2026-04-01T00:00:00Z',
    rrf: 0.05,
    ...overrides,
  };
}

function buildAnchor(overrides: Partial<AnchorRow> = {}): AnchorRow {
  return {
    report_id: 'r_x',
    name: 'Sales Analysis',
    group_name: 'Sales',
    anchor_question: 'What are the primary sales by HQ?',
    source_sql: 'SELECT hq_new, SUM(net_sales_) FROM data GROUP BY 1',
    rrf: 0.04,
    ...overrides,
  };
}

const EMPTY = (): { goldenExamples: GoldenRow[]; anchors: AnchorRow[]; history: never[] } => ({
  goldenExamples: [], anchors: [], history: [],
});

describe('buildSystemPrompt', () => {
  it('includes the schema, column dictionary, and power prompt', () => {
    const prompt = buildSystemPrompt({ dictionary: DICT, ...EMPTY() });
    expect(prompt).toContain('SCHEMA: Single table');
    // Schema column list — long but contains every column name.
    expect(prompt).toContain('net_sales_');
    // Column dictionary block.
    expect(prompt).toContain('COLUMN DICTIONARY');
    expect(prompt).toContain('`net_sales_`');
    expect(prompt).toContain('`gri_sales`');
    // Power prompt sections.
    expect(prompt).toContain('DECISION FLOW');
    expect(prompt).toContain('ANTI-HALLUCINATION TRAPS');
    expect(prompt).toContain('FORMULA DICTIONARY');
    // Output contract.
    expect(prompt).toContain('respond_with_answer');
    expect(prompt).toContain('respond_with_clarification');
  });

  it('summarizes dictionary values', () => {
    const prompt = buildSystemPrompt({ dictionary: DICT, ...EMPTY() });
    expect(prompt).toContain('NEURO');
    expect(prompt).toContain('ZBM MP');
    expect(prompt).toContain('HARDA');
    expect(prompt).toContain('SHOVERT: 2 SKUs');
    expect(prompt).toContain('SHOCOX: 1 SKU');
  });

  it('includes golden examples when present', () => {
    const examples = [
      buildGolden({ id: 'ge_v', question: 'Q1', sql: 'SELECT v', status: 'verified' }),
      buildGolden({ id: 'ge_c', question: 'Q2', sql: 'SELECT c', status: 'corrected', correction_note: 'use net primary' }),
    ];
    const prompt = buildSystemPrompt({
      dictionary: DICT, goldenExamples: examples, anchors: [], history: [],
    });
    expect(prompt).toContain('SELECT v');
    expect(prompt).toContain('SELECT c');
    expect(prompt).toContain('Lesson: use net primary');
    expect(prompt).toContain('verified on 2026-04-01');
    expect(prompt).toContain('corrected on 2026-04-01');
  });

  it('notes when no golden examples are available', () => {
    const prompt = buildSystemPrompt({ dictionary: DICT, ...EMPTY() });
    expect(prompt).toContain('(none retrieved');
  });

  it('includes ReportDef anchors when present', () => {
    const prompt = buildSystemPrompt({
      dictionary: DICT,
      goldenExamples: [],
      anchors: [buildAnchor({ report_id: 'r1', name: 'Sales Analysis', group_name: 'Sales' })],
      history: [],
    });
    expect(prompt).toContain('REPORT TEMPLATES');
    expect(prompt).toContain('Sales Analysis');
    expect(prompt).toContain('Anchor: What are the primary sales');
  });

  it('notes when no anchors are retrieved', () => {
    const prompt = buildSystemPrompt({ dictionary: DICT, ...EMPTY() });
    expect(prompt).toContain('REPORT TEMPLATES: (none retrieved)');
  });

  it('includes history turns with corrections flagged', () => {
    const prompt = buildSystemPrompt({
      dictionary: DICT,
      goldenExamples: [],
      anchors: [],
      history: [
        { role: 'user', content: 'show sales' },
        { role: 'assistant', content: 'here', sql: 'SELECT 1', correction_note: 'use net primary' },
      ],
    });
    expect(prompt).toContain('[turn 1, user]');
    expect(prompt).toContain('[turn 2, assistant]');
    expect(prompt).toContain('(SQL: SELECT 1)');
    expect(prompt).toContain('USER CORRECTION: use net primary');
  });

  it('marks the first turn when history is empty', () => {
    const prompt = buildSystemPrompt({ dictionary: DICT, ...EMPTY() });
    expect(prompt).toContain('first turn');
  });
});
