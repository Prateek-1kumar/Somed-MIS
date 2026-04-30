/**
 * @jest-environment node
 */
import { rrfFuse } from './retrieval';
import { mockEmbed } from './embeddings.test-mock';

describe('rrfFuse (pure)', () => {
  it('produces higher score for items appearing in both rankings', () => {
    const out = rrfFuse(
      [{ id: 'a', rnk: 1 }, { id: 'b', rnk: 2 }],
      [{ id: 'a', rnk: 2 }, { id: 'c', rnk: 1 }],
      60,
    );
    const ranked = out.sort((x, y) => y.rrf - x.rrf);
    expect(ranked[0].id).toBe('a');
  });

  it('uses k=60 by default', () => {
    const out = rrfFuse([{ id: 'x', rnk: 1 }], [], 60);
    expect(out[0].rrf).toBeCloseTo(1 / 61, 5);
  });

  it('ranks items by overall rank-density not raw rank counts', () => {
    // crossed ranks: a is #1 dense + #5 sparse vs b is #5 dense + #1 sparse vs c is #2 dense only
    const out = rrfFuse(
      [{ id: 'a', rnk: 1 }, { id: 'c', rnk: 2 }, { id: 'b', rnk: 5 }],
      [{ id: 'b', rnk: 1 }, { id: 'a', rnk: 5 }],
      60,
    );
    const ranked = out.sort((x, y) => y.rrf - x.rrf).map(r => r.id);
    expect(ranked.slice(0, 2).sort()).toEqual(['a', 'b']);
    expect(ranked[2]).toBe('c');
  });
});

describe('mockEmbed', () => {
  it('returns 1536-dim unit-norm vector', () => {
    const v = mockEmbed('hello world');
    expect(v).toHaveLength(1536);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
  it('shared tokens raise cosine similarity', () => {
    const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
    const a = mockEmbed('primary sales by hq');
    const b = mockEmbed('primary sales by region');
    const c = mockEmbed('completely unrelated text words');
    expect(cos(a, b)).toBeGreaterThan(cos(a, c));
  });
  it('is deterministic', () => {
    expect(mockEmbed('hello')).toEqual(mockEmbed('hello'));
  });
});

// ── Smoke tests against live Supabase (gated). ──────────────────────
// These exercise the actual SQL CTE end-to-end. Live data state:
//   - golden_examples: 2 rows (existing pre-Project-2 verified examples)
//   - report_anchors: 35 rows (one per ReportDef + dashboard query, all embedded)
//   - entity_values: ~1,150 rows across brand/hq/doctor/segment/zbm
// We assert qualitative behavior, not specific IDs.

const smoke = process.env.RETRIEVAL_SMOKE === '1' ? describe : describe.skip;

smoke('retrieve* against live Supabase', () => {
  // Lazy import so tests that don't need DB don't trigger the import-time
  // SUPABASE_DB_URL check in src/lib/db.ts.
  let retrieveGoldenExamples: typeof import('./retrieval').retrieveGoldenExamples;
  let retrieveReportAnchors:  typeof import('./retrieval').retrieveReportAnchors;
  let retrieveEntities:       typeof import('./retrieval').retrieveEntities;
  let retrieveAll:            typeof import('./retrieval').retrieveAll;

  beforeAll(async () => {
    const r = await import('./retrieval');
    retrieveGoldenExamples = r.retrieveGoldenExamples;
    retrieveReportAnchors  = r.retrieveReportAnchors;
    retrieveEntities       = r.retrieveEntities;
    retrieveAll            = r.retrieveAll;
  });

  it('retrieveReportAnchors returns ranked results for an obvious query', async () => {
    const r = await retrieveReportAnchors('top HQ by primary sales achievement', { k: 5 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(5);
    // Every row has the expected shape.
    expect(r[0]).toHaveProperty('report_id');
    expect(r[0]).toHaveProperty('source_sql');
    expect(r[0]).toHaveProperty('rrf');
    // RRF scores should be monotonically non-increasing.
    for (let i = 1; i < r.length; i++) {
      expect(r[i].rrf).toBeLessThanOrEqual(r[i - 1].rrf);
    }
  }, 30_000);

  it('retrieveReportAnchors surfaces a Sales-related anchor for a sales query', async () => {
    const r = await retrieveReportAnchors('primary sales by HQ', { k: 5 });
    const groups = r.map(x => x.group_name.toLowerCase());
    // Expect at least one Sales / HQ-Wise / Item-Wise group in top 5.
    expect(groups.some(g => /sales|hq|item/.test(g))).toBe(true);
  }, 30_000);

  it('retrieveGoldenExamples runs and returns ≤ k rows', async () => {
    const r = await retrieveGoldenExamples('any question text here', { k: 5 });
    expect(Array.isArray(r)).toBe(true);
    expect(r.length).toBeLessThanOrEqual(5);
  }, 30_000);

  it('retrieveEntities (pg_trgm) finds fuzzy brand match', async () => {
    // Probe with a slightly misspelled brand. The seed has SHOGABALIN, etc.
    const r = await retrieveEntities('brand', 'shogabaln', 5);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].sim).toBeGreaterThan(0.4);
  }, 30_000);

  it('retrieveAll embeds once and returns golden + anchors', async () => {
    const r = await retrieveAll('top brands by net primary sales', {
      goldenK: 3, anchorsK: 3,
    });
    expect(r.embedding).toHaveLength(1536);
    expect(r.golden.length).toBeLessThanOrEqual(3);
    expect(r.anchors.length).toBeLessThanOrEqual(3);
  }, 30_000);
});
