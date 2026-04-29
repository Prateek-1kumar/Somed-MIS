// Golden-examples store. Team-verified Q→SQL pairs persisted in Postgres.
// Embedding happens on add(); retrieval lives in src/lib/retrieval.ts.
//
// The previous tag-based retrieval (extractTags / rankExamples / pruneExpired)
// is replaced by hybrid (BM25 + pgvector + RRF) retrieval — see retrieval.ts.
// The HITL persistence shape (verified/corrected, use_count, correction_note)
// is preserved so existing UI code keeps working.

import sql from './db';
import { embedText, sha256, toVectorLiteral } from './embeddings';

export type GoldenStatus = 'verified' | 'corrected';

export interface GoldenExample {
  id: string;
  question: string;
  /**
   * Legacy tag list. Always empty after the Project 2 migration; retained on
   * the type for backward compatibility with the learned-patterns UI which
   * filters/renders tag chips. Will be removed after that UI is updated.
   */
  question_tags: string[];
  narrative: string;
  sql: string;
  chart_type: string;
  assumptions: string[];
  status: GoldenStatus;
  correction_note?: string;
  created_at: string;
  verified_at: string;
  use_count: number;
}

export interface NewGoldenExampleInput {
  question: string;
  narrative: string;
  sql: string;
  chart_type: string;
  assumptions?: string[];
  status?: GoldenStatus;
  correction_note?: string;
}

// ── Pure helpers ──────────────────────────────────────────────────────────

export function normalizeSql(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/\s*;+\s*$/, '').trim();
}

export function findDuplicate(
  examples: GoldenExample[], question: string, sqlText: string,
): GoldenExample | undefined {
  const q = question.trim().toLowerCase();
  const s = normalizeSql(sqlText);
  return examples.find(e =>
    e.question.trim().toLowerCase() === q && normalizeSql(e.sql) === s,
  );
}

export function generateExampleId(now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 6);
  return `ge_${date}_${rand}`;
}

// ── Row mapper (DB → public type) ─────────────────────────────────────────

interface DbRow {
  id: string;
  question: string;
  narrative: string;
  sql: string;
  chart_type: string;
  assumptions: string[];
  status: GoldenStatus;
  correction_note: string | null;
  created_at: string;
  verified_at: string;
  use_count: number;
}

function rowToExample(r: DbRow): GoldenExample {
  return {
    id: r.id,
    question: r.question,
    question_tags: [],
    narrative: r.narrative,
    sql: r.sql,
    chart_type: r.chart_type,
    assumptions: r.assumptions ?? [],
    status: r.status,
    correction_note: r.correction_note ?? undefined,
    created_at: r.created_at,
    verified_at: r.verified_at,
    use_count: r.use_count,
  };
}

const ROW_COLUMNS = `
  id, question, narrative, sql, chart_type, assumptions, status,
  correction_note, created_at::text AS created_at,
  verified_at::text AS verified_at, use_count
`;

// ── Postgres-backed store ─────────────────────────────────────────────────

export const goldenStore = {
  async list(): Promise<GoldenExample[]> {
    const rows = await sql<DbRow[]>`
      SELECT ${sql.unsafe(ROW_COLUMNS)}
      FROM golden_examples
      ORDER BY verified_at DESC
    `;
    return rows.map(rowToExample);
  },

  /**
   * Insert a new example or, if (question, SQL) already matches an existing
   * row, bump its use_count and refresh verified_at. Returns the created or
   * updated row.
   *
   * The embedding call (~150 ms) is on the synchronous critical path; if it
   * fails the whole add() rejects so the row is not partially written.
   */
  async add(input: NewGoldenExampleInput): Promise<GoldenExample> {
    const all = await this.list();
    const dup = findDuplicate(all, input.question, input.sql);
    if (dup) {
      const updated = await sql<DbRow[]>`
        UPDATE golden_examples
           SET use_count = use_count + 1,
               verified_at = now()
         WHERE id = ${dup.id}
        RETURNING ${sql.unsafe(ROW_COLUMNS)}
      `;
      return rowToExample(updated[0]);
    }

    const id = generateExampleId();
    const search_text = input.question;
    const vector = await embedText(search_text);
    const vec = toVectorLiteral(vector);

    const inserted = await sql<DbRow[]>`
      INSERT INTO golden_examples
        (id, question, narrative, sql, chart_type, assumptions, status,
         correction_note, search_text, embedding, embedding_sha)
      VALUES
        (${id}, ${input.question}, ${input.narrative}, ${input.sql},
         ${input.chart_type}, ${input.assumptions ?? []},
         ${input.status ?? 'verified'}, ${input.correction_note ?? null},
         ${search_text}, ${sql.unsafe(`'${vec}'::vector`)},
         ${sha256(search_text)})
      RETURNING ${sql.unsafe(ROW_COLUMNS)}
    `;
    return rowToExample(inserted[0]);
  },

  async remove(id: string): Promise<void> {
    await sql`DELETE FROM golden_examples WHERE id = ${id}`;
  },

  async unVerify(id: string): Promise<void> {
    return this.remove(id);
  },

  async incrementUseCount(id: string): Promise<void> {
    await sql`UPDATE golden_examples SET use_count = use_count + 1 WHERE id = ${id}`;
  },
};

export type GoldenExamplesStore = typeof goldenStore;
export default goldenStore;
