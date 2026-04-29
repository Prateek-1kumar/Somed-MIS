/**
 * @jest-environment node
 */

// Mock retrieval module — tools.ts calls retrieveEntities (search_values tier 1)
// and the retrieve* family (retrieve tool). We control those behaviors per test
// instead of hitting the live DB.
jest.mock('../retrieval', () => ({
  retrieveEntities:        jest.fn(),
  retrieveGoldenExamples:  jest.fn(),
  retrieveReportAnchors:   jest.fn(),
  retrieveAll:             jest.fn(),
}));

import {
  TOOL_DEFINITIONS,
  executeTool,
  parseResponseTool,
  type ToolContext,
} from './tools';
import {
  retrieveEntities,
  retrieveGoldenExamples,
  retrieveReportAnchors,
  retrieveAll,
} from '../retrieval';
import type { ServerDb, DataDictionary, QueryResult } from '../server-db';

const mockRetrieveEntities       = retrieveEntities       as jest.MockedFunction<typeof retrieveEntities>;
const mockRetrieveGoldenExamples = retrieveGoldenExamples as jest.MockedFunction<typeof retrieveGoldenExamples>;
const mockRetrieveReportAnchors  = retrieveReportAnchors  as jest.MockedFunction<typeof retrieveReportAnchors>;
const mockRetrieveAll            = retrieveAll            as jest.MockedFunction<typeof retrieveAll>;

beforeEach(() => {
  mockRetrieveEntities.mockReset();
  mockRetrieveGoldenExamples.mockReset();
  mockRetrieveReportAnchors.mockReset();
  mockRetrieveAll.mockReset();
  // Default: entity index returns empty (forces ILIKE fallback in search_values).
  mockRetrieveEntities.mockResolvedValue([]);
});

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
  return { db };
}

describe('TOOL_DEFINITIONS', () => {
  it('includes all 6 tools', () => {
    const names = TOOL_DEFINITIONS.map(t => t.name).sort();
    expect(names).toEqual([
      'list_distinct_values',
      'respond_with_answer',
      'respond_with_clarification',
      'retrieve',
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

describe('executeTool — search_values (tier 1: entity_index)', () => {
  it('returns entity_values matches without hitting the data table', async () => {
    mockRetrieveEntities.mockResolvedValue([
      { value: 'CROCIN', sim: 0.9, display_count: 1200 },
      { value: 'CROCEAL', sim: 0.6, display_count: 80 },
    ]);
    let dataQueried = false;
    const ctx = makeCtx(() => { dataQueried = true; return { rows: [], columns: [], rowCount: 0 }; });
    const result = await executeTool(
      { id: '1', name: 'search_values', args: { column: 'item_name', pattern: 'crockin' } },
      ctx,
    ) as { values: string[]; source: string };
    expect(result.values).toEqual(['CROCIN', 'CROCEAL']);
    expect(result.source).toBe('entity_index');
    expect(dataQueried).toBe(false);
    expect(mockRetrieveEntities).toHaveBeenCalledWith('brand', 'crockin', 20);
  });
});

describe('executeTool — search_values (tier 2: ILIKE fallback)', () => {
  it('falls back to ILIKE when entity_index returns 0', async () => {
    mockRetrieveEntities.mockResolvedValue([]);
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
    ) as { values: string[]; source: string };
    expect(result.values).toEqual(['SHOVERT-8 TAB 10S', 'SHOVERT-16 TAB 10S']);
    expect(result.source).toBe('data_ilike');
  });

  it('skips entity_index for unmapped columns and goes straight to ILIKE', async () => {
    const ctx = makeCtx(sql => {
      expect(sql).toMatch(/ILIKE '%abc%'/i);
      return { rows: [{ value: 'ABC Pharma' }], columns: ['value'], rowCount: 1 };
    });
    const result = await executeTool(
      { id: '1', name: 'search_values', args: { column: 'customer_n', pattern: 'abc' } },
      ctx,
    ) as { values: string[]; source: string };
    expect(result.source).toBe('data_ilike');
    expect(mockRetrieveEntities).not.toHaveBeenCalled();
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

  it('escapes single quotes in ILIKE fallback', async () => {
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

describe('executeTool — retrieve', () => {
  it('rejects missing query', async () => {
    const ctx = makeCtx(() => ({ rows: [], columns: [], rowCount: 0 }));
    const result = await executeTool(
      { id: '1', name: 'retrieve', args: {} },
      ctx,
    ) as { error: string };
    expect(result.error).toMatch(/query required/);
  });

  it('corpus=golden dispatches to retrieveGoldenExamples only', async () => {
    mockRetrieveGoldenExamples.mockResolvedValue([{
      id: 'g1', question: 'top brands', narrative: '', sql: 'SELECT 1',
      chart_type: 'hbar', status: 'verified', correction_note: null, use_count: 0, rrf: 0.05,
    }]);
    const ctx = makeCtx(() => ({ rows: [], columns: [], rowCount: 0 }));
    const result = await executeTool(
      { id: '1', name: 'retrieve', args: { query: 'top brands', corpus: 'golden', k: 3 } },
      ctx,
    ) as { golden: { sql: string }[] };
    expect(result.golden).toHaveLength(1);
    expect(result.golden[0].sql).toBe('SELECT 1');
    expect(mockRetrieveGoldenExamples).toHaveBeenCalledWith('top brands', { k: 3 });
    expect(mockRetrieveReportAnchors).not.toHaveBeenCalled();
    expect(mockRetrieveAll).not.toHaveBeenCalled();
  });

  it('corpus=reports dispatches to retrieveReportAnchors only', async () => {
    mockRetrieveReportAnchors.mockResolvedValue([{
      report_id: 'r1', name: 'Sales Analysis', group_name: 'Sales',
      anchor_question: 'What are…', source_sql: 'SELECT 2', rrf: 0.04,
    }]);
    const ctx = makeCtx(() => ({ rows: [], columns: [], rowCount: 0 }));
    const result = await executeTool(
      { id: '1', name: 'retrieve', args: { query: 'sales', corpus: 'reports' } },
      ctx,
    ) as { anchors: { sql: string }[] };
    expect(result.anchors).toHaveLength(1);
    expect(result.anchors[0].sql).toBe('SELECT 2');
    expect(mockRetrieveAll).not.toHaveBeenCalled();
  });

  it("corpus='all' (default) dispatches to retrieveAll with goldenK=k, anchorsK=ceil(k*0.6)", async () => {
    mockRetrieveAll.mockResolvedValue({
      embedding: new Array(1536).fill(0),
      golden: [{
        id: 'g1', question: 'q', narrative: '', sql: 'SELECT 3', chart_type: 'kpi',
        status: 'verified', correction_note: null, use_count: 0, rrf: 0.03,
      }],
      anchors: [{
        report_id: 'r2', name: 'X', group_name: 'Sales',
        anchor_question: 'a', source_sql: 'SELECT 4', rrf: 0.02,
      }],
    });
    const ctx = makeCtx(() => ({ rows: [], columns: [], rowCount: 0 }));
    const result = await executeTool(
      { id: '1', name: 'retrieve', args: { query: 'foo', k: 5 } },
      ctx,
    ) as { golden: unknown[]; anchors: unknown[] };
    expect(result.golden).toHaveLength(1);
    expect(result.anchors).toHaveLength(1);
    expect(mockRetrieveAll).toHaveBeenCalledWith('foo', { goldenK: 5, anchorsK: 3 });
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
