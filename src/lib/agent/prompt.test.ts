/**
 * @jest-environment node
 */
import { buildSystemPrompt } from './prompt';
import type { DataDictionary } from '../server-db';
import type { GoldenExample } from '../golden-examples';

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

function buildGolden(overrides: Partial<GoldenExample> = {}): GoldenExample {
  return {
    id: 'ge_1',
    question: 'Top brands',
    question_tags: [],
    narrative: '',
    sql: 'SELECT 1',
    chart_type: 'hbar',
    assumptions: [],
    status: 'verified',
    created_at: '2026-04-01T00:00:00Z',
    verified_at: '2026-04-01T00:00:00Z',
    use_count: 0,
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  it('includes the schema, dictionary, and rules', () => {
    const prompt = buildSystemPrompt({ dictionary: DICT, goldenExamples: [], history: [] });
    expect(prompt).toContain('SCHEMA: Single table');
    expect(prompt).toContain('net_sales_');
    expect(prompt).toContain('KEY FORMULAS');
    expect(prompt).toContain('BEHAVIORAL RULES');
    expect(prompt).toContain('respond_with_answer');
    expect(prompt).toContain('respond_with_clarification');
  });

  it('summarizes dictionary values', () => {
    const prompt = buildSystemPrompt({ dictionary: DICT, goldenExamples: [], history: [] });
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
    const prompt = buildSystemPrompt({ dictionary: DICT, goldenExamples: examples, history: [] });
    expect(prompt).toContain('SELECT v');
    expect(prompt).toContain('SELECT c');
    expect(prompt).toContain('Lesson: use net primary');
    expect(prompt).toContain('verified on 2026-04-01');
    expect(prompt).toContain('corrected on 2026-04-01');
  });

  it('notes when no examples are available', () => {
    const prompt = buildSystemPrompt({ dictionary: DICT, goldenExamples: [], history: [] });
    expect(prompt).toContain('(none yet');
  });

  it('includes history turns with corrections flagged', () => {
    const prompt = buildSystemPrompt({
      dictionary: DICT,
      goldenExamples: [],
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
    const prompt = buildSystemPrompt({ dictionary: DICT, goldenExamples: [], history: [] });
    expect(prompt).toContain('first turn');
  });
});
