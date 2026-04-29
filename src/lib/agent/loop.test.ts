/**
 * @jest-environment node
 */

// Mock retrieval (loop calls retrieveAll on every turn) and the embedding +
// retrieveEntities surfaces (search_values tool tier 1). Default returns are
// empty/no-op so loop tests stay deterministic.
jest.mock('../retrieval', () => ({
  retrieveAll: jest.fn(async () => ({
    embedding: new Array(1536).fill(0),
    golden: [],
    anchors: [],
  })),
  retrieveGoldenExamples: jest.fn(async () => []),
  retrieveReportAnchors:  jest.fn(async () => []),
  retrieveEntities:       jest.fn(async () => []),
}));

import { runAgent } from './loop';
import type { ModelAdapter, ModelRoundTrip, AgentEvent, ToolCall } from './types';
import type { ServerDb, QueryResult } from '../server-db';

function fakeDb(sqlHandler: (sql: string) => QueryResult): ServerDb {
  return {
    runSafe: async (sql: string) => sqlHandler(sql),
    runTrusted: async (sql: string) => sqlHandler(sql),
    dictionary: {
      generated_at: '',
      row_count: 10,
      fy_range: ['2025-2026'],
      segments: ['NEURO'],
      zbms: ['ZBM MP'],
      hqs: ['HARDA'],
      brand_families: { SHOVERT: ['SHOVERT-8', 'SHOVERT-16'] },
      doctors_top_200: [],
      latest_period: '202512',
    },
    dataVersion: 'v1',
  };
}

/**
 * Scriptable mock model. Takes a list of scripted responses and returns them
 * in order — one per start/continue call.
 */
function scriptedModel(script: ModelRoundTrip[]): ModelAdapter {
  let i = 0;
  return {
    async start(): Promise<ModelRoundTrip> {
      return script[i++] ?? { kind: 'text', text: 'no more script' };
    },
    async continueWithToolResults(): Promise<ModelRoundTrip> {
      return script[i++] ?? { kind: 'text', text: 'no more script' };
    },
  };
}

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe('runAgent', () => {
  it('finalizes on a direct respond_with_answer call', async () => {
    const db = fakeDb(() => ({ rows: [{ n: 10 }], columns: ['n'], rowCount: 1 }));
    const answerCall: ToolCall = {
      id: 'c1',
      name: 'respond_with_answer',
      args: {
        narrative: 'Total is 10',
        headline: '10',
        sql: 'SELECT COUNT(*) AS n FROM data',
        chart_type: 'kpi',
      },
    };
    const model = scriptedModel([
      { kind: 'tool_calls', calls: [answerCall] },
    ]);

    const events = await collectEvents(
      runAgent(
        { userMessage: 'How many rows are there?', history: [] },
        { db, createModel: () => model },
      ),
    );

    const finalEvent = events.find(e => e.type === 'final');
    expect(finalEvent).toBeDefined();
    if (finalEvent?.type === 'final') {
      expect(finalEvent.answer.narrative).toBe('Total is 10');
      expect(finalEvent.answer.chart_type).toBe('kpi');
    }
  });

  it('runs data tool then answers', async () => {
    const db = fakeDb(() => ({
      rows: [{ value: 'SHOVERT-8 TAB 10S' }, { value: 'SHOVERT-16 TAB 10S' }],
      columns: ['value'], rowCount: 2,
    }));

    const model = scriptedModel([
      {
        kind: 'tool_calls',
        calls: [{
          id: 'c1',
          name: 'search_values',
          args: { column: 'item_name', pattern: 'shovert' },
        }],
      },
      {
        kind: 'tool_calls',
        calls: [{
          id: 'c2',
          name: 'respond_with_answer',
          args: {
            narrative: 'Found 2 Shovert variants',
            headline: '2 SKUs',
            sql: "SELECT item_name FROM data WHERE item_name LIKE 'SHOVERT%'",
            chart_type: 'table_only',
          },
        }],
      },
    ]);

    const events = await collectEvents(
      runAgent(
        { userMessage: 'List Shovert variants', history: [] },
        { db, createModel: () => model },
      ),
    );

    const toolCalls = events.filter(e => e.type === 'tool_call');
    const toolResults = events.filter(e => e.type === 'tool_result');
    const finalEvents = events.filter(e => e.type === 'final');
    expect(toolCalls).toHaveLength(1);
    expect(toolResults).toHaveLength(1);
    expect(finalEvents).toHaveLength(1);
  });

  it('emits clarify event on respond_with_clarification', async () => {
    const db = fakeDb(() => ({ rows: [], columns: [], rowCount: 0 }));
    const model = scriptedModel([
      {
        kind: 'tool_calls',
        calls: [{
          id: 'c1',
          name: 'respond_with_clarification',
          args: { question: 'Primary or secondary?', choices: 'Primary|Secondary' },
        }],
      },
    ]);

    const events = await collectEvents(
      runAgent(
        { userMessage: 'show me sales', history: [] },
        { db, createModel: () => model },
      ),
    );

    const clarify = events.find(e => e.type === 'clarify');
    expect(clarify).toBeDefined();
    if (clarify?.type === 'clarify') {
      expect(clarify.question).toBe('Primary or secondary?');
      expect(clarify.choices).toEqual(['Primary', 'Secondary']);
    }
  });

  it('retries when respond_with_answer has invalid args', async () => {
    const db = fakeDb(() => ({ rows: [], columns: [], rowCount: 0 }));

    const model = scriptedModel([
      {
        kind: 'tool_calls',
        calls: [{
          id: 'c1',
          name: 'respond_with_answer',
          args: { narrative: 'x', headline: 'x', sql: 'x', chart_type: 'totally-bogus' },
        }],
      },
      {
        kind: 'tool_calls',
        calls: [{
          id: 'c2',
          name: 'respond_with_answer',
          args: { narrative: 'fixed', headline: 'h', sql: 'SELECT 1', chart_type: 'kpi' },
        }],
      },
    ]);

    const events = await collectEvents(
      runAgent(
        { userMessage: 'q', history: [] },
        { db, createModel: () => model },
      ),
    );

    const finalEvents = events.filter(e => e.type === 'final');
    expect(finalEvents).toHaveLength(1);
    if (finalEvents[0].type === 'final') {
      expect(finalEvents[0].answer.narrative).toBe('fixed');
    }
  });

  it('surfaces an error when model returns plain text', async () => {
    const db = fakeDb(() => ({ rows: [], columns: [], rowCount: 0 }));
    const model = scriptedModel([{ kind: 'text', text: 'I refuse' }]);

    const events = await collectEvents(
      runAgent(
        { userMessage: 'q', history: [] },
        { db, createModel: () => model },
      ),
    );

    const err = events.find(e => e.type === 'error');
    expect(err).toBeDefined();
  });

  it('surfaces an error after hitting iteration cap', async () => {
    const db = fakeDb(() => ({ rows: [{ n: 1 }], columns: ['n'], rowCount: 1 }));

    // 10 rounds of search_values — more than the 8-iteration cap.
    const script: ModelRoundTrip[] = Array.from({ length: 10 }, (_, i) => ({
      kind: 'tool_calls' as const,
      calls: [{ id: `c${i}`, name: 'search_values', args: { column: 'item_name', pattern: `x${i}` } }],
    }));
    const model = scriptedModel(script);

    const events = await collectEvents(
      runAgent(
        { userMessage: 'loop forever', history: [] },
        { db, createModel: () => model },
      ),
    );

    const err = events.find(e => e.type === 'error');
    expect(err).toBeDefined();
    if (err?.type === 'error') expect(err.message).toMatch(/struggling/);
  });
});
