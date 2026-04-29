/**
 * @jest-environment node
 */
import {
  TOOL_DEFINITIONS,
  executeTool,
  parseResponseTool,
  type ToolContext,
} from './tools';
import { createStore, createInMemoryProvider } from '../golden-examples';
import type { ServerDb, DataDictionary, QueryResult } from '../server-db';

function fakeDictionary(): DataDictionary {
  return {
    generated_at: '2026-04-24T00:00:00Z',
    row_count: 10,
    fy_range: ['2025-2026'],
    segments: ['NEURO'],
    zbms: ['ZBM MP'],
    hqs: ['HARDA'],
    brand_families: { SHOVERT: ['SHOVERT-8 TAB 10S', 'SHOVERT-16 TAB 10S'] },
    doctors_top_200: [],
    latest_period: '202512',
  };
}

function makeCtx(sqlHandler: (sql: string) => QueryResult): ToolContext {
  const db: ServerDb = {
    runSafe: async (sql: string) => sqlHandler(sql),
    runTrusted: async (sql: string) => sqlHandler(sql),
    dictionary: fakeDictionary(),
    dataVersion: 'v1',
  };
  const goldenStore = createStore(createInMemoryProvider());
  return { db, goldenStore };
}

describe('TOOL_DEFINITIONS', () => {
  it('includes all 6 tools', () => {
    const names = TOOL_DEFINITIONS.map(t => t.name).sort();
    expect(names).toEqual([
      'get_golden_examples',
      'list_distinct_values',
      'respond_with_answer',
      'respond_with_clarification',
      'run_sql',
      'search_values',
    ]);
  });

  it('every tool has a description and required params', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.parameters.required?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('executeTool — search_values', () => {
  it('returns values matching pattern', async () => {
    const ctx = makeCtx(sql => {
      expect(sql).toMatch(/ILIKE '%shovert%'/i);
      return {
        rows: [{ value: 'SHOVERT-8 TAB 10S' }, { value: 'SHOVERT-16 TAB 10S' }],
        columns: ['value'], rowCount: 2,
      };
    });
    const result = await executeTool(
      { id: '1', name: 'search_values', args: { column: 'item_name', pattern: 'shovert' } },
      ctx,
    ) as { values: string[]; rowCount: number };
    expect(result.values).toEqual(['SHOVERT-8 TAB 10S', 'SHOVERT-16 TAB 10S']);
    expect(result.rowCount).toBe(2);
  });

  it('rejects unknown column', async () => {
    const ctx = makeCtx(() => ({ rows: [], columns: [], rowCount: 0 }));
    const result = await executeTool(
      { id: '1', name: 'search_values', args: { column: 'evil_column', pattern: 'x' } },
      ctx,
    ) as { error: string };
    expect(result.error).toMatch(/unknown column/);
  });

  it('rejects empty pattern', async () => {
    const ctx = makeCtx(() => ({ rows: [], columns: [], rowCount: 0 }));
    const result = await executeTool(
      { id: '1', name: 'search_values', args: { column: 'item_name', pattern: '  ' } },
      ctx,
    ) as { error: string };
    expect(result.error).toMatch(/pattern required/);
  });

  it('escapes single quotes in pattern', async () => {
    let capturedSql = '';
    const ctx = makeCtx(sql => {
      capturedSql = sql;
      return { rows: [], columns: [], rowCount: 0 };
    });
    await executeTool(
      { id: '1', name: 'search_values', args: { column: 'item_name', pattern: "O'BRIEN" } },
      ctx,
    );
    expect(capturedSql).toContain("'%O''BRIEN%'");
  });
});

describe('executeTool — list_distinct_values', () => {
  it('returns distinct values from a column', async () => {
    const ctx = makeCtx(() => ({
      rows: [{ value: 'NEURO' }, { value: 'ORTHO' }],
      columns: ['value'], rowCount: 2,
    }));
    const result = await executeTool(
      { id: '1', name: 'list_distinct_values', args: { column: 'seg' } },
      ctx,
    ) as { values: string[] };
    expect(result.values).toEqual(['NEURO', 'ORTHO']);
  });
});

describe('executeTool — run_sql', () => {
  it('surfaces db error', async () => {
    const ctx = makeCtx(() => ({ rows: [], columns: [], rowCount: 0, error: 'bad SQL' }));
    const result = await executeTool(
      { id: '1', name: 'run_sql', args: { sql: 'SELECT nonsense' } },
      ctx,
    ) as { error: string };
    expect(result.error).toBe('bad SQL');
  });

  it('caps returned rows at 200', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ n: i }));
    const ctx = makeCtx(() => ({ rows, columns: ['n'], rowCount: 500 }));
    const result = await executeTool(
      { id: '1', name: 'run_sql', args: { sql: 'SELECT 1 FROM data' } },
      ctx,
    ) as { rows: unknown[]; preview_note?: string };
    expect(result.rows).toHaveLength(200);
    expect(result.preview_note).toMatch(/showing first 200 of 500/);
  });
});

describe('executeTool — get_golden_examples', () => {
  it('returns examples matching question tags', async () => {
    const provider = createInMemoryProvider([{
      id: 'ge_1',
      question: 'Top brands primary FY 2025-26',
      question_tags: ['metric:net_primary', 'period:current_fy', 'dim:brand'],
      narrative: '',
      sql: 'SELECT 1',
      chart_type: 'hbar',
      assumptions: [],
      status: 'verified' as const,
      created_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
      use_count: 0,
    }]);
    const goldenStore = createStore(provider);
    const ctx: ToolContext = {
      db: {
        runSafe: async () => ({ rows: [], columns: [], rowCount: 0 }),
        runTrusted: async () => ({ rows: [], columns: [], rowCount: 0 }),
        dictionary: fakeDictionary(),
        dataVersion: 'v1',
      },
      goldenStore,
    };
    const result = await executeTool(
      { id: '1', name: 'get_golden_examples', args: { question: 'top brands by primary sales this year' } },
      ctx,
    ) as { examples: { sql: string }[] };
    expect(result.examples).toHaveLength(1);
    expect(result.examples[0].sql).toBe('SELECT 1');
  });
});

describe('parseResponseTool', () => {
  it('parses respond_with_answer', () => {
    const result = parseResponseTool({
      id: '1',
      name: 'respond_with_answer',
      args: {
        narrative: 'Sales are up',
        headline: '₹12.4 Cr',
        sql: 'SELECT SUM(net_sales_) FROM data',
        chart_type: 'kpi',
        chart_x: 'yyyymm',
        assumptions: 'FY 2025-26; exclude inactive',
        follow_ups: 'Break down by HQ|Compare to last year',
      },
    });
    expect(result).toBeDefined();
    if (result?.kind === 'answer') {
      expect(result.narrative).toBe('Sales are up');
      expect(result.headline).toBe('₹12.4 Cr');
      expect(result.chart_type).toBe('kpi');
      expect(result.assumptions).toEqual(['FY 2025-26', 'exclude inactive']);
      expect(result.follow_ups).toEqual(['Break down by HQ', 'Compare to last year']);
      expect(result.chart_hints?.x).toBe('yyyymm');
    }
  });

  it('parses respond_with_clarification with choices', () => {
    const result = parseResponseTool({
      id: '1',
      name: 'respond_with_clarification',
      args: {
        question: 'Primary or secondary?',
        choices: 'Primary|Secondary|Both',
      },
    });
    expect(result).toBeDefined();
    if (result?.kind === 'clarify') {
      expect(result.clarify_question).toBe('Primary or secondary?');
      expect(result.clarify_choices).toEqual(['Primary', 'Secondary', 'Both']);
    }
  });

  it('returns undefined for non-sentinel tool', () => {
    const result = parseResponseTool({
      id: '1',
      name: 'run_sql',
      args: { sql: 'SELECT 1' },
    });
    expect(result).toBeUndefined();
  });

  it('throws on invalid chart_type', () => {
    expect(() =>
      parseResponseTool({
        id: '1',
        name: 'respond_with_answer',
        args: { narrative: 'x', headline: 'x', sql: 'x', chart_type: 'exotic_chart' },
      }),
    ).toThrow(/invalid chart_type/);
  });

  it('throws when required fields are missing', () => {
    expect(() =>
      parseResponseTool({
        id: '1',
        name: 'respond_with_answer',
        args: { narrative: '', headline: 'x', sql: '', chart_type: 'kpi' },
      }),
    ).toThrow(/missing narrative or sql/);
  });

  it('throws when clarify question is empty', () => {
    expect(() =>
      parseResponseTool({
        id: '1',
        name: 'respond_with_clarification',
        args: { question: '' },
      }),
    ).toThrow(/missing question/);
  });
});
