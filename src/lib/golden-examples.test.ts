/**
 * @jest-environment node
 */
import {
  extractTags,
  rankExamples,
  pruneExpired,
  normalizeSql,
  findDuplicate,
  generateExampleId,
  createStore,
  createInMemoryProvider,
  type GoldenExample,
} from './golden-examples';
import type { DataDictionary } from './server-duckdb';

const TEST_DICT: DataDictionary = {
  generated_at: '2026-04-24T00:00:00Z',
  row_count: 100,
  fy_range: ['2024-2025', '2025-2026'],
  segments: ['NEURO', 'ORTHO', 'GASTRO'],
  zbms: ['ZBM MP', 'ZBM EAST'],
  hqs: ['HARDA', 'AGRA'],
  brand_families: {
    SHOVERT: ['SHOVERT-8 TAB 10S', 'SHOVERT-16 TAB 10S'],
    SHOCOX: ['SHOCOX-T4 TAB'],
  },
  doctors_top_200: [],
  latest_period: '202512',
};

function buildExample(overrides: Partial<GoldenExample> = {}): GoldenExample {
  return {
    id: 'ge_test_0001',
    question: 'Top 5 brands by net primary FY 2025-26',
    question_tags: ['metric:net_primary', 'period:current_fy', 'dim:brand'],
    narrative: 'Top brands...',
    sql: 'SELECT item_name, SUM(net_sales_) FROM data GROUP BY 1 ORDER BY 2 DESC LIMIT 5',
    chart_type: 'hbar',
    assumptions: [],
    status: 'verified',
    created_at: '2026-04-01T00:00:00Z',
    verified_at: '2026-04-01T00:00:00Z',
    use_count: 0,
    ...overrides,
  };
}

describe('extractTags', () => {
  it('tags metric, period, and breakdown dims', () => {
    const tags = extractTags('Top 5 brands by net primary sales for this year');
    expect(tags).toEqual(expect.arrayContaining([
      'metric:net_primary', 'period:current_fy', 'dim:brand',
    ]));
  });

  it('tags secondary sales with monthly trend', () => {
    const tags = extractTags('Monthly secondary sales trend for NEURO segment', TEST_DICT);
    expect(tags).toEqual(expect.arrayContaining([
      'metric:secondary', 'period:monthly', 'dim:segment', 'segment:NEURO',
    ]));
  });

  it('detects brand family from dictionary', () => {
    const tags = extractTags('How is Shovert doing this year?', TEST_DICT);
    expect(tags).toContain('brand:SHOVERT');
    expect(tags).toContain('period:current_fy');
  });

  it('detects HQ name', () => {
    const tags = extractTags('Show me Harda sales', TEST_DICT);
    expect(tags).toContain('hq:HARDA');
  });

  it('returns empty array for untagged question', () => {
    const tags = extractTags('what is the meaning of life');
    expect(tags).toEqual([]);
  });

  it('deduplicates and sorts tags', () => {
    const tags = extractTags('primary sales primary sales');
    expect(tags).toEqual([...tags].sort());
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe('rankExamples', () => {
  it('ranks higher-overlap examples first', () => {
    const ex1 = buildExample({ id: 'a', question_tags: ['metric:primary'] });
    const ex2 = buildExample({ id: 'b', question_tags: ['metric:primary', 'dim:hq'] });
    const ranked = rankExamples([ex1, ex2], ['metric:primary', 'dim:hq']);
    expect(ranked[0].example.id).toBe('b');
  });

  it('corrected examples outrank verified ones on same tags', () => {
    const verifiedEx = buildExample({ id: 'v', status: 'verified', question_tags: ['metric:primary'] });
    const correctedEx = buildExample({ id: 'c', status: 'corrected', question_tags: ['metric:primary'], correction_note: 'use net' });
    const ranked = rankExamples([verifiedEx, correctedEx], ['metric:primary']);
    expect(ranked[0].example.id).toBe('c');
  });

  it('gives recency bonus to newer examples', () => {
    const now = new Date('2026-04-24T00:00:00Z');
    const oldEx = buildExample({ id: 'old', created_at: '2025-04-24T00:00:00Z', question_tags: ['metric:primary'] });
    const newEx = buildExample({ id: 'new', created_at: '2026-04-20T00:00:00Z', question_tags: ['metric:primary'] });
    const ranked = rankExamples([oldEx, newEx], ['metric:primary'], now);
    expect(ranked[0].example.id).toBe('new');
  });

  it('filters out zero-overlap non-corrected examples', () => {
    const ex = buildExample({ id: 'no-overlap', question_tags: ['metric:secondary'], status: 'verified' });
    const ranked = rankExamples([ex], ['metric:primary']);
    expect(ranked).toHaveLength(0);
  });
});

describe('pruneExpired', () => {
  it('removes examples older than 18 months', () => {
    const now = new Date('2026-04-24T00:00:00Z');
    const old = buildExample({ id: 'old', verified_at: '2024-04-01T00:00:00Z' });
    const fresh = buildExample({ id: 'fresh', verified_at: '2025-12-01T00:00:00Z' });
    const kept = pruneExpired([old, fresh], now);
    expect(kept.map(e => e.id)).toEqual(['fresh']);
  });

  it('keeps all when all are fresh', () => {
    const now = new Date('2026-04-24T00:00:00Z');
    const recent = buildExample({ verified_at: '2026-01-01T00:00:00Z' });
    expect(pruneExpired([recent], now)).toHaveLength(1);
  });
});

describe('normalizeSql + findDuplicate', () => {
  it('normalizes whitespace and trailing semicolon', () => {
    expect(normalizeSql('SELECT   *  FROM  data ;')).toBe('select * from data');
    expect(normalizeSql('select * from data')).toBe('select * from data');
  });

  it('finds duplicate when question + SQL match (modulo whitespace)', () => {
    const ex = buildExample({ question: 'Top 5', sql: 'SELECT 1' });
    const dup = findDuplicate([ex], 'top 5', 'select   1');
    expect(dup).toBe(ex);
  });

  it('returns undefined when nothing matches', () => {
    const ex = buildExample({ question: 'Top 5', sql: 'SELECT 1' });
    const dup = findDuplicate([ex], 'Top 10', 'SELECT 1');
    expect(dup).toBeUndefined();
  });
});

describe('generateExampleId', () => {
  it('returns date-prefixed unique id', () => {
    const id = generateExampleId(new Date('2026-04-24T00:00:00Z'));
    expect(id).toMatch(/^ge_2026-04-24_[a-z0-9]{4}$/);
  });

  it('is unlikely to collide across multiple calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateExampleId()));
    expect(ids.size).toBeGreaterThan(95); // allow small chance of collision
  });
});

describe('store (add/list/remove/unVerify/incrementUseCount/topK)', () => {
  it('adds and lists a new example', async () => {
    const store = createStore(createInMemoryProvider());
    const created = await store.add({
      question: 'Top brands FY 2025-26',
      narrative: 'top brands...',
      sql: 'SELECT 1',
      chart_type: 'hbar',
    });
    expect(created.id).toMatch(/^ge_/);
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].question).toBe('Top brands FY 2025-26');
    expect(all[0].question_tags).toContain('dim:brand');
  });

  it('dedupes on identical question + SQL (bumps use_count)', async () => {
    const store = createStore(createInMemoryProvider());
    await store.add({ question: 'Q1', narrative: '', sql: 'SELECT 1', chart_type: 'kpi' });
    const second = await store.add({ question: 'Q1', narrative: '', sql: 'SELECT 1', chart_type: 'kpi' });
    expect(second.use_count).toBe(1);
    const all = await store.list();
    expect(all).toHaveLength(1);
  });

  it('removes an example by id', async () => {
    const store = createStore(createInMemoryProvider());
    const a = await store.add({ question: 'A', narrative: '', sql: 'SELECT 1', chart_type: 'kpi' });
    await store.add({ question: 'B', narrative: '', sql: 'SELECT 2', chart_type: 'kpi' });
    await store.remove(a.id);
    const all = await store.list();
    expect(all.map(e => e.question)).toEqual(['B']);
  });

  it('unVerify is equivalent to remove', async () => {
    const store = createStore(createInMemoryProvider());
    const a = await store.add({ question: 'A', narrative: '', sql: 'SELECT 1', chart_type: 'kpi' });
    await store.unVerify(a.id);
    const all = await store.list();
    expect(all).toHaveLength(0);
  });

  it('incrementUseCount bumps the counter', async () => {
    const store = createStore(createInMemoryProvider());
    const a = await store.add({ question: 'A', narrative: '', sql: 'SELECT 1', chart_type: 'kpi' });
    await store.incrementUseCount(a.id);
    await store.incrementUseCount(a.id);
    const reloaded = (await store.list()).find(e => e.id === a.id);
    expect(reloaded?.use_count).toBe(2);
  });

  it('incrementUseCount is a no-op for unknown id', async () => {
    const store = createStore(createInMemoryProvider());
    await expect(store.incrementUseCount('nope')).resolves.not.toThrow();
  });

  it('topK returns ranked examples matching question tags', async () => {
    const store = createStore(createInMemoryProvider());
    await store.add({ question: 'Top brands by primary FY 2025-26', narrative: '', sql: 'SELECT 1', chart_type: 'hbar' });
    await store.add({ question: 'Monthly secondary trend for NEURO', narrative: '', sql: 'SELECT 2', chart_type: 'line', dictionary: TEST_DICT });
    const match = await store.topK(['metric:primary', 'dim:brand', 'period:current_fy']);
    expect(match[0].question).toMatch(/Top brands/);
  });

  it('topK respects k parameter', async () => {
    const store = createStore(createInMemoryProvider());
    for (let i = 0; i < 10; i++) {
      await store.add({
        question: `Q ${i} primary sales`,
        narrative: '',
        sql: `SELECT ${i}`,
        chart_type: 'kpi',
      });
    }
    const top3 = await store.topK(['metric:primary'], 3);
    expect(top3).toHaveLength(3);
  });

  it('stores correction_note on corrected examples', async () => {
    const store = createStore(createInMemoryProvider());
    const created = await store.add({
      question: 'Shovert this year',
      narrative: 'fixed',
      sql: 'SELECT 1',
      chart_type: 'line',
      status: 'corrected',
      correction_note: 'use net_sales_ not sales_valu',
    });
    expect(created.status).toBe('corrected');
    expect(created.correction_note).toMatch(/net_sales_/);
  });
});

describe('in-memory provider isolation', () => {
  it('multiple stores with separate providers do not share state', async () => {
    const a = createStore(createInMemoryProvider());
    const b = createStore(createInMemoryProvider());
    await a.add({ question: 'X', narrative: '', sql: 'SELECT 1', chart_type: 'kpi' });
    expect((await a.list())).toHaveLength(1);
    expect((await b.list())).toHaveLength(0);
  });
});
