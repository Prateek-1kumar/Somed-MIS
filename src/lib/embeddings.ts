// Gemini gemini-embedding-001 wrapper. Uses task-specific embedding modes
// (RETRIEVAL_DOCUMENT for stored docs, RETRIEVAL_QUERY for live queries) and
// MRL-truncates the output to 1536 dims via the API's outputDimensionality
// parameter. Talks to the REST API directly because @google/generative-ai
// v0.24's typed surface doesn't expose outputDimensionality.

import { createHash } from 'node:crypto';

const MODEL = 'gemini-embedding-001';
const DIM = 1536;
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

type TaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

interface EmbedRespSingle {
  embedding?: { values?: number[] };
  error?: { message?: string };
}
interface EmbedRespBatch {
  embeddings?: Array<{ values?: number[] }>;
  error?: { message?: string };
}

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY is not set');
  return k;
}

async function embedOne(text: string, taskType: TaskType): Promise<number[]> {
  const url = `${BASE_URL}/models/${MODEL}:embedContent?key=${apiKey()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: DIM,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini embed failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = await res.json() as EmbedRespSingle;
  const v = json.embedding?.values;
  if (!Array.isArray(v) || v.length !== DIM) {
    throw new Error(`Gemini returned ${v?.length ?? 0} dims, expected ${DIM}`);
  }
  return v;
}

/** Embed a single document for storage (stored corpus side). */
export function embedText(text: string): Promise<number[]> {
  return embedOne(text, 'RETRIEVAL_DOCUMENT');
}

/** Embed a live user query for retrieval (query side). */
export function embedQuery(text: string): Promise<number[]> {
  return embedOne(text, 'RETRIEVAL_QUERY');
}

/** Batch document embedding. Gemini batch endpoint allows up to 100 inputs. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const url = `${BASE_URL}/models/${MODEL}:batchEmbedContents?key=${apiKey()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map(text => ({
        model: `models/${MODEL}`,
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: DIM,
      })),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini batch embed failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = await res.json() as EmbedRespBatch;
  const out = json.embeddings?.map(e => e.values ?? []) ?? [];
  if (out.length !== texts.length) {
    throw new Error(`batch returned ${out.length} embeddings, expected ${texts.length}`);
  }
  for (const v of out) {
    if (v.length !== DIM) throw new Error(`batch embedding returned ${v.length} dims`);
  }
  return out;
}

/** Deterministic SHA-256 hex hash; used for embedding cache invalidation. */
export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Format a number[] embedding for pgvector literal injection. */
export function toVectorLiteral(v: number[]): string {
  return '[' + v.join(',') + ']';
}
