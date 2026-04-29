/**
 * @jest-environment node
 */
import {
  normalizeSql,
  findDuplicate,
  generateExampleId,
  type GoldenExample,
} from './golden-examples';

function buildExample(overrides: Partial<GoldenExample> = {}): GoldenExample {
  return {
    id: 'ge_test_0001',
    question: 'Top 5 brands by net primary FY 2025-26',
    question_tags: [],
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
    expect(ids.size).toBeGreaterThan(95); // tiny chance of collision is acceptable
  });
});

// ── Live Postgres store (gated by RETRIEVAL_SMOKE=1) ──────────────────────
// These exercise the real Supabase + Gemini path end-to-end. Each test
// inserts a row with a unique sentinel question, exercises the operation,
// and cleans up the row at the end.

const smoke = process.env.RETRIEVAL_SMOKE === '1' ? describe : describe.skip;

smoke('goldenStore (live Postgres)', () => {
  let goldenStore: typeof import('./golden-examples').goldenStore;
  const sentinel = `golden-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const ids: string[] = [];

  beforeAll(async () => {
    goldenStore = (await import('./golden-examples')).goldenStore;
  });

  afterAll(async () => {
    for (const id of ids) await goldenStore.remove(id).catch(() => {});
    const sql = (await import('./db')).default;
    await sql.end({ timeout: 5 });
  });

  it('add() inserts a new row and returns it with an embedding', async () => {
    const created = await goldenStore.add({
      question: `${sentinel} insert`,
      narrative: 'test',
      sql: 'SELECT 1',
      chart_type: 'kpi',
    });
    ids.push(created.id);
    expect(created.id).toMatch(/^ge_/);
    expect(created.question).toBe(`${sentinel} insert`);
    expect(created.use_count).toBe(0);
    expect(created.status).toBe('verified');
  }, 30_000);

  it('add() bumps use_count on duplicate (question + SQL match)', async () => {
    const first = await goldenStore.add({
      question: `${sentinel} dup`,
      narrative: 't',
      sql: 'SELECT 2',
      chart_type: 'kpi',
    });
    ids.push(first.id);
    const second = await goldenStore.add({
      question: `${sentinel} dup`,
      narrative: 't',
      sql: 'SELECT 2',
      chart_type: 'kpi',
    });
    expect(second.id).toBe(first.id);
    expect(second.use_count).toBe(1);
  }, 60_000);

  it('list() includes inserted rows', async () => {
    const all = await goldenStore.list();
    const ours = all.filter(e => e.question.includes(sentinel));
    expect(ours.length).toBeGreaterThan(0);
  }, 30_000);

  it('incrementUseCount bumps the counter; no-op for unknown id', async () => {
    const created = await goldenStore.add({
      question: `${sentinel} count`,
      narrative: '',
      sql: 'SELECT 3',
      chart_type: 'kpi',
    });
    ids.push(created.id);
    await goldenStore.incrementUseCount(created.id);
    await goldenStore.incrementUseCount(created.id);
    const reloaded = (await goldenStore.list()).find(e => e.id === created.id);
    expect(reloaded?.use_count).toBe(2);
    await expect(goldenStore.incrementUseCount('nope')).resolves.not.toThrow();
  }, 60_000);

  it('remove() / unVerify() delete the row', async () => {
    const created = await goldenStore.add({
      question: `${sentinel} remove`,
      narrative: '',
      sql: 'SELECT 4',
      chart_type: 'kpi',
    });
    await goldenStore.unVerify(created.id);
    const all = await goldenStore.list();
    expect(all.find(e => e.id === created.id)).toBeUndefined();
  }, 30_000);
});
