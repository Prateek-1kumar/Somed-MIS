// Hybrid retrieval over Postgres FTS + pgvector with Reciprocal Rank Fusion.
// One round-trip per corpus; embeddings reused across corpora within a turn.
//
// Public API:
//   embedQuery / embedText  — re-exports from ./embeddings
//   retrieveGoldenExamples  — RRF over golden_examples
//   retrieveReportAnchors   — RRF over report_anchors
//   retrieveEntities        — pg_trgm fuzzy match over entity_values
//   retrieveAll             — embed once + parallel fetch

import sql from './db';
import { embedQuery as _embedQuery, embedText as _embedText, toVectorLiteral } from './embeddings';
import type { EntityKind } from './entity-index';

export const embedQuery = _embedQuery;
export const embedText  = _embedText;

const RRF_K = 60;
const STAGE_LIMIT = 30;

// ── Pure RRF (mirrors the SQL CTE; used by tests + sanity checks) ────

export interface RankedId { id: string; rnk: number }
export interface FusedScore { id: string; rrf: number }

export function rrfFuse(
  dense: RankedId[], sparse: RankedId[], k: number = RRF_K,
): FusedScore[] {
  const m = new Map<string, number>();
  for (const r of dense)  m.set(r.id, (m.get(r.id) ?? 0) + 1 / (k + r.rnk));
  for (const r of sparse) m.set(r.id, (m.get(r.id) ?? 0) + 1 / (k + r.rnk));
  return [...m.entries()].map(([id, rrf]) => ({ id, rrf }));
}

// ── Golden examples ──────────────────────────────────────────────────

export interface GoldenRow {
  id: string;
  question: string;
  narrative: string;
  sql: string;
  chart_type: string;
  status: 'verified' | 'corrected';
  correction_note: string | null;
  use_count: number;
  verified_at: string;
  rrf: number;
}

export async function retrieveGoldenExamples(
  question: string,
  opts: { k?: number; embedding?: number[] } = {},
): Promise<GoldenRow[]> {
  const k = opts.k ?? 5;
  const embedding = opts.embedding ?? await embedQuery(question);
  const vec = toVectorLiteral(embedding);
  const rows = await sql.unsafe<GoldenRow[]>(`
    WITH dense AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rnk
      FROM golden_examples
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT ${STAGE_LIMIT}
    ),
    sparse AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(fts, q) DESC) AS rnk
      FROM golden_examples, plainto_tsquery('english', $2) AS q
      WHERE fts @@ q
      LIMIT ${STAGE_LIMIT}
    ),
    fused AS (
      SELECT id, SUM(1.0 / (${RRF_K} + rnk))::float8 AS rrf
      FROM (SELECT id, rnk FROM dense UNION ALL SELECT id, rnk FROM sparse) r
      GROUP BY id
    )
    SELECT g.id, g.question, g.narrative, g.sql, g.chart_type, g.status,
           g.correction_note, g.use_count, g.verified_at::text AS verified_at, f.rrf
    FROM fused f JOIN golden_examples g USING (id)
    ORDER BY (f.rrf * CASE WHEN g.status='corrected' THEN 1.25 ELSE 1.0 END) DESC
    LIMIT $3
  `, [vec, question, k]);
  return rows;
}

// ── ReportDef anchors ─────────────────────────────────────────────────

export interface AnchorRow {
  report_id: string;
  name: string;
  group_name: string;
  anchor_question: string;
  source_sql: string;
  rrf: number;
}

export async function retrieveReportAnchors(
  question: string,
  opts: { k?: number; embedding?: number[] } = {},
): Promise<AnchorRow[]> {
  const k = opts.k ?? 3;
  const embedding = opts.embedding ?? await embedQuery(question);
  const vec = toVectorLiteral(embedding);
  const rows = await sql.unsafe<AnchorRow[]>(`
    WITH dense AS (
      SELECT report_id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rnk
      FROM report_anchors
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT ${STAGE_LIMIT}
    ),
    sparse AS (
      SELECT report_id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(fts, q) DESC) AS rnk
      FROM report_anchors, plainto_tsquery('english', $2) AS q
      WHERE fts @@ q
      LIMIT ${STAGE_LIMIT}
    ),
    fused AS (
      SELECT report_id, SUM(1.0 / (${RRF_K} + rnk))::float8 AS rrf
      FROM (SELECT report_id, rnk FROM dense UNION ALL SELECT report_id, rnk FROM sparse) r
      GROUP BY report_id
    )
    SELECT a.report_id, a.name, a.group_name, a.anchor_question, a.source_sql, f.rrf
    FROM fused f JOIN report_anchors a USING (report_id)
    ORDER BY f.rrf DESC
    LIMIT $3
  `, [vec, question, k]);
  return rows;
}

// ── Entity index (pg_trgm) ────────────────────────────────────────────

export interface EntityMatch { value: string; sim: number; display_count: number }

export async function retrieveEntities(
  kind: EntityKind, query: string, limit: number = 20,
): Promise<EntityMatch[]> {
  const rows = await sql.unsafe<EntityMatch[]>(`
    SELECT value, similarity(value, $1)::float8 AS sim, display_count
    FROM entity_values
    WHERE kind = $2 AND value % $1
    ORDER BY similarity(value, $1) DESC, display_count DESC
    LIMIT $3
  `, [query, kind, limit]);
  return rows;
}

// ── Combined: embed once, fetch in parallel ──────────────────────────

export interface RetrievalResult {
  embedding: number[];
  golden: GoldenRow[];
  anchors: AnchorRow[];
}

export async function retrieveAll(
  question: string,
  opts: { goldenK?: number; anchorsK?: number } = {},
): Promise<RetrievalResult> {
  const goldenK = opts.goldenK ?? 5;
  const anchorsK = opts.anchorsK ?? 3;
  const embedding = await embedQuery(question);
  const [golden, anchors] = await Promise.all([
    retrieveGoldenExamples(question, { k: goldenK, embedding }),
    retrieveReportAnchors(question, { k: anchorsK, embedding }),
  ]);
  return { embedding, golden, anchors };
}
