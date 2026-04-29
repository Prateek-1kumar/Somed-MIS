/**
 * @jest-environment node
 */
import { embedText, embedTexts, embedQuery, sha256, toVectorLiteral } from './embeddings';

describe('sha256', () => {
  it('is deterministic and 64-char hex', () => {
    const a = sha256('hello');
    const b = sha256('hello');
    const c = sha256('world');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('toVectorLiteral', () => {
  it('formats a number array as pgvector literal', () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
    expect(toVectorLiteral([])).toBe('[]');
  });
});

// Real-API smoke tests, gated behind RETRIEVAL_SMOKE=1.
const smoke = process.env.RETRIEVAL_SMOKE === '1' ? describe : describe.skip;

smoke('Gemini embedding API (real)', () => {
  it('embedText returns 1536-dim vector', async () => {
    const v = await embedText('primary sales by HQ');
    expect(v).toHaveLength(1536);
    expect(v.every(n => typeof n === 'number')).toBe(true);
  }, 30_000);

  it('embedQuery returns 1536-dim vector', async () => {
    const v = await embedQuery('show me crocin sales');
    expect(v).toHaveLength(1536);
  }, 30_000);

  it('embedTexts batches inputs', async () => {
    const vs = await embedTexts(['primary sales', 'secondary returns', 'expired stock']);
    expect(vs).toHaveLength(3);
    expect(vs[0]).toHaveLength(1536);
    expect(vs[1]).toHaveLength(1536);
  }, 30_000);

  it('embedTexts handles empty input', async () => {
    const vs = await embedTexts([]);
    expect(vs).toEqual([]);
  });

  it('paraphrase pair has higher cosine than unrelated pair', async () => {
    const cosine = (a: number[], b: number[]) =>
      a.reduce((s, x, i) => s + x * b[i], 0) /
      (Math.hypot(...a) * Math.hypot(...b));
    const [salesA, salesB, weather] = await embedTexts([
      'sales by HQ for last quarter',
      'primary sales broken down per headquarter recent quarter',
      'weather forecast for tomorrow',
    ]);
    const close = cosine(salesA, salesB);
    const far = cosine(salesA, weather);
    expect(close).toBeGreaterThan(far);
  }, 60_000);
});
