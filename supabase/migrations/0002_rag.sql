-- Project 2: RAG layer. Adds pgvector + 3 RAG tables on top of 0001_init.sql.
-- pg_trgm is already enabled by 0001 and is used here for entity_values fuzzy matching.

CREATE EXTENSION IF NOT EXISTS vector;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. golden_examples — HITL store of verified Q→SQL pairs.
--    `embedding` is NULL until embedded; retrieval queries filter NOT NULL.
--    `embedding_sha` is SHA-256 of `search_text` at embed time; cache-bust
--    by clearing it (e.g. on embedding-model upgrade).
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS golden_examples (
  id              text PRIMARY KEY,                                                  -- ge_2026-04-29_xxxx (preserves existing scheme)
  question        text NOT NULL,
  narrative       text NOT NULL,
  sql             text NOT NULL,
  chart_type      text NOT NULL,
  assumptions     text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL CHECK (status IN ('verified','corrected')),
  correction_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  verified_at     timestamptz NOT NULL DEFAULT now(),
  use_count       int NOT NULL DEFAULT 0,
  search_text     text NOT NULL,                                                     -- = question on day 1; separate for future extension
  fts             tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
  embedding       vector(1536),
  embedding_sha   text
);
CREATE INDEX IF NOT EXISTS idx_golden_fts ON golden_examples USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_golden_embedding ON golden_examples
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. report_anchors — auto-generated NL anchors for the 27 ReportDefs +
--    8 dashboard query functions (~35 rows). Source of truth lives in
--    src/reports/*.ts; scripts/reindex-anchors.ts maintains this table.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_anchors (
  report_id       text PRIMARY KEY,                                                  -- 'r1'..'r27' | 'dash_overview_kpis' | etc.
  name            text NOT NULL,
  group_name      text NOT NULL,
  anchor_question text NOT NULL,
  source_sql      text NOT NULL,
  search_text     text NOT NULL,                                                     -- anchor_question + ' ' + name + ' ' + select-aliases
  fts             tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
  embedding       vector(1536),
  embedding_sha   text
);
CREATE INDEX IF NOT EXISTS idx_anchors_fts ON report_anchors USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_anchors_embedding ON report_anchors
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. entity_values — brand families, HQs, doctors, segments, ZBMs.
--    pg_trgm fuzzy matching only; no embeddings. `display_count` lets us
--    rank by both similarity and prevalence.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entity_values (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('brand','hq','doctor','segment','zbm')),
  value         text NOT NULL,
  display_count int NOT NULL DEFAULT 1,
  UNIQUE (kind, value)
);
CREATE INDEX IF NOT EXISTS idx_entity_value_trgm
  ON entity_values USING gist (value gist_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entity_kind_value ON entity_values (kind, value);
