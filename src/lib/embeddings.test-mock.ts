// Deterministic, plausible-semantic 1536-dim embedding for tests.
// Token-overlap-based: shared lowercase tokens raise cosine similarity.
// Not realistic, but consistent across runs and good enough to exercise
// the dense leg of retrieval ranking.

const DIM = 1536;

function hashToken(t: string): number {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function mockEmbed(text: string): number[] {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const v = new Array<number>(DIM).fill(0);
  for (const t of tokens) {
    const idx = hashToken(t) % DIM;
    v[idx] += 1;
  }
  // L2 normalize so cosine == dot product, and magnitudes stay sane.
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}
