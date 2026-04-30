# Proper RAG Layer Over Supabase + pgvector — Design

**Date:** 2026-04-29
**Project:** 2 of 2
**Predecessor:** `2026-04-29-data-migration-supabase-design.md` (data migration to Postgres — shipped)

## Why this exists

The chat agent today is unreliable. Concretely:

- The same kind of question gets different SQL on different days. There is no semantic similarity over verified Q→SQL pairs — only regex tag overlap.
- The 27 hand-written ReportDef SQL templates in `src/reports/group-{a..g}.ts` and `src/reports/dashboard.ts` are dead weight to chat. Rich, expert-authored templates the agent never sees.
- Cryptic column distinctions like `net_sales_` vs `net_sales`, `foc_value` vs `foc_value_` vs `foc_val_n`, `gri_sales` storing negative values — none of this is explained beyond a static formula dictionary in the system prompt. Cheap fallback models (Cerebras, Groq) hallucinate column names.
- Brand / HQ / doctor name misspellings cause `search_values` (which uses ILIKE on the live table) to return zero matches; the agent then guesses spellings instead of asking.

Project 1 migrated the underlying data store to Supabase Postgres with `pg_trgm` and pgvector available. Project 2 layers a real retrieval system on top — turning the chat agent's prompt from regex-tag bricolage into hybrid semantic + lexical retrieval over four sources of expert content, with a stricter behavioral prompt designed to keep cheap fallback models honest.

## Goals

- Replace regex-tag retrieval in `src/lib/golden-examples.ts` with hybrid (BM25 + dense embedding + Reciprocal Rank Fusion) retrieval over the verified Q→SQL corpus stored in Postgres.
- Index all ReportDef anchor questions (27 from `src/reports/group-*.ts` + 8 dashboard query functions from `src/reports/dashboard.ts` = ~35) in the same hybrid retrieval system, so chat sees expert-authored SQL templates.
- Inject a hand-authored, exhaustive 75-column dictionary inline into the system prompt on every turn — no retrieval needed for column descriptions because they fit comfortably in context.
- Replace the static `search_values` ILIKE with two-tier fuzzy entity matching: pg_trgm over a curated `entity_values` table first, ILIKE on `data` second. Catches the typo case the brief flagged.
- Move all behavioral rules (decision flow, anti-hallucination traps, formula dictionary, chart-type rules) out of TypeScript template literals into a single editable `power-prompt.md` file. Optimized for cheap models — explicit step-by-step checklist instead of prose.
- Stay on Vercel Hobby + Supabase free tier. No background workers, no Redis, no new framework dependencies.

## Non-goals (deferred)

- Cross-session chat memory — privacy and staleness questions are unresolved.
- Cross-encoder reranker — the 2025-2026 research is unambiguous that RRF is sufficient at ≤500-doc corpus sizes; reranking buys 2–3% nDCG@5 at 100–400 ms latency cost.
- LangChain / LlamaIndex — no RAG primitive in either framework provides a feature win for this exact setup; both add Lambda-bundle weight without payoff.
- ParadeDB `pg_search` / `pg_bm25` — not on Supabase's managed-Postgres extension allow-list.
- Schema linking as a pre-step (CHESS, CHASE-SQL pattern) — full 75-column schema fits in the context window. The 2025 "Schema Linking is a Bottleneck" paper (Maamari et al.) shows linking *hurts* recall when the full schema fits.
- Re-embedding existing rows on a schedule — handled by SHA-diff in the reindex script.
- Live editing of `power-prompt.md` without redeploy — edit-PR-deploy is the workflow. Live edit deferred to a possible Project 3.
- Gemini explicit prompt caching — separable follow-up; not blocking on this project.
- Chat UI polish.

## Stack constraints (fixed)

- Next.js 16 App Router with Turbopack — no webpack config.
- Supabase Postgres free tier; transaction-mode pooler (port 6543); `prepare: false`.
- `postgres-js` driver. No ORM.
- Embeddings via Google `gemini-embedding-001`, MRL-truncated to 1536 dimensions.
- Chat completions via the existing fallback chain (Gemini → Cerebras → OpenRouter → Groq → xAI).
- Free deploy, single Lambda. No cron beyond the existing weekly `/api/health` warmup.
- `pg_trgm` already enabled by `0001_init.sql`. `vector` enabled in this project's migration.

## Architecture

```
                          Browser (Next.js client)
                                    │
                                    ▼
                       /api/chat (SSE)         /api/data/ingest (CSV upload)
                                    │                       │
                                    ▼                       ▼
                          Vercel Lambda (Node.js)
                                    │
            ┌──────────────────┬────┴──────────────┬───────────────────┐
            ▼                  ▼                   ▼                   ▼
     buildSystemPrompt    retrieveAll()      embedText()          entityIndex.refresh()
            │                  │ embed once        │                   │
            │                  │ + 2× hybrid SQL   │                   │
            ▼                  ▼                   ▼                   ▼
        ┌─────────────────────────────────────────────────────────────────────┐
        │                    Supabase Postgres                                │
        │                                                                     │
        │   data ← (existing)                                                 │
        │   golden_examples (text + tsvector + vector(1536))                  │
        │   report_anchors  (text + tsvector + vector(1536))                  │
        │   entity_values   (text + pg_trgm gist index)                       │
        └─────────────────────────────────────────────────────────────────────┘
```

Retrieval is co-located with the canonical data store; no separate vector DB.

## Decision summary (locked in via brainstorming)

| Question | Decision |
|---|---|
| Indexing trigger | Embed-on-write everywhere; `prebuild` script for ReportDef anchors via SHA diff; entity index refreshed inside `/api/data/ingest`. |
| Embedding model + dim | `gemini-embedding-001`, 1536 dims (Matryoshka-truncated). |
| BM25 implementation | Plain Postgres `tsvector` + `ts_rank_cd` with GIN index. (`pg_search` not available on Supabase.) |
| Dense / sparse fusion | Reciprocal Rank Fusion, k=60, no per-stage weighting. |
| Top-K per stage / final | Top 30 per stage → RRF → final top-K (5 for golden, 3 for anchors). |
| Reranker | None. |
| Column descriptions | Inject all 75 inline in system prompt (Record<CsvColumn, string>) — not retrieved. Compile-time exhaustiveness via TS. |
| Behavioral prompt | Single file `src/lib/agent/power-prompt.md`. Loaded at module init. Replaces today's `BEHAVIORAL_RULES` and `FORMULA_DICTIONARY`. |
| Mid-turn retrieval | One unified `retrieve(query, corpus, k)` tool replaces today's `get_golden_examples`. Corpus ∈ `'golden' | 'reports' | 'all'`. |
| Entity fuzzy match | Two-tier `search_values`: pg_trgm over `entity_values` first; ILIKE on `data` fallback. |
| Existing golden examples blob | One-shot migration into Postgres; archive blob 30 days; then delete. Skip if blob is empty. |
| Chat UI | Out of scope. |

## Schema (`supabase/migrations/0002_rag.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS vector;     -- pg_trgm enabled by 0001

-- ── 1. Golden Q→SQL pairs (HITL store) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS golden_examples (
  id              text PRIMARY KEY,         -- ge_2026-04-29_xxxx
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
  search_text     text NOT NULL,            -- = question on day 1; separate so we can extend later
  fts             tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
  embedding       vector(1536),             -- NULL until embedded
  embedding_sha   text                      -- SHA-256 of search_text at embed time
);
CREATE INDEX IF NOT EXISTS idx_golden_fts ON golden_examples USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_golden_embedding ON golden_examples
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ── 2. ReportDef anchors (~35 docs, source-of-truth = src/reports/*.ts) ─
CREATE TABLE IF NOT EXISTS report_anchors (
  report_id       text PRIMARY KEY,         -- 'r1'..'r27' or 'dash_overview_kpis' etc. (35 total)
  name            text NOT NULL,
  group_name      text NOT NULL,
  anchor_question text NOT NULL,            -- auto-generated NL question
  source_sql      text NOT NULL,            -- the SELECT, for retrieval display
  search_text     text NOT NULL,            -- anchor_question + ' ' + name + ' ' + select-aliases
  fts             tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
  embedding       vector(1536),
  embedding_sha   text
);
CREATE INDEX IF NOT EXISTS idx_anchors_fts ON report_anchors USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_anchors_embedding ON report_anchors
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ── 3. Entity values (brand families, HQs, doctors, segments, ZBMs) ────
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
```

### Schema notes

- `embedding` is nullable so a row can exist before it's embedded; failed embed calls leave a recoverable orphan. Retrieval queries filter `WHERE embedding IS NOT NULL`.
- `embedding_sha` is the SHA-256 of the exact `search_text` we sent to Gemini. The reindex script compares it against `sha256(current search_text)` to decide whether to re-embed. To migrate the embedding model later, set all `embedding_sha = NULL` and re-run reindex.
- `search_text` is kept separate from `question` / `anchor_question` so we can prepend tags or annotations later without losing row identity.
- `golden_examples.id` is text to preserve the existing `ge_<date>_<rand>` scheme used by current code (`src/lib/golden-examples.ts::generateExampleId`), so blob migration doesn't change IDs.
- `entity_values.display_count` lets `search_values` rank by similarity AND prevalence (a brand in 50,000 rows beats one in 12 rows on a tie).
- HNSW parameters `m=16, ef_construction=64` are the pgvector documentation defaults; tuning is unnecessary at this corpus size.
- `status='corrected'` boost is applied at retrieval time as a 1.25× multiplier on the RRF score; replaces the brittle `+5` bonus in current `rankExamples`.

## Hybrid retrieval query

One CTE per corpus, run in parallel from `retrieveAll()`. The structure for `golden_examples`:

```sql
-- Parameters: $1 = query_embedding (vector(1536)), $2 = query_text, $3 = top_k
WITH dense AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rnk
  FROM golden_examples
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> $1::vector
  LIMIT 30
),
sparse AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(fts, q) DESC) AS rnk
  FROM golden_examples, plainto_tsquery('english', $2) AS q
  WHERE fts @@ q
  LIMIT 30
),
fused AS (
  SELECT id, SUM(1.0 / (60 + rnk)) AS rrf
  FROM (SELECT id, rnk FROM dense UNION ALL SELECT id, rnk FROM sparse) r
  GROUP BY id
)
SELECT g.*, f.rrf
FROM fused f JOIN golden_examples g USING (id)
ORDER BY (f.rrf * CASE WHEN g.status = 'corrected' THEN 1.25 ELSE 1.0 END) DESC
LIMIT $3;
```

The same shape applies to `report_anchors`, minus the corrected boost.

The entity index uses pg_trgm only:

```sql
-- Parameters: $1 = query_text, $2 = kind, $3 = limit
SELECT value, similarity(value, $1) AS sim, display_count
FROM entity_values
WHERE kind = $2 AND value % $1
ORDER BY similarity(value, $1) DESC, display_count DESC
LIMIT $3;
```

### Why this shape

- One round-trip per corpus. RRF lives entirely in the SQL; the Node side never touches raw scores.
- `<=>` is cosine distance, paired with `vector_cosine_ops` HNSW.
- `plainto_tsquery` accepts user prose verbatim with no operator parsing.
- `ts_rank_cd` is "cover density" rank, slightly better than `ts_rank` on short documents.
- `LIMIT 30` per stage gives RRF enough fusion candidates without scanning the full table; effectively exhaustive at 100–500 rows.
- `embedding IS NOT NULL` guards against orphan rows from failed embed calls.

## Indexing pipeline

| Trigger | What runs | Where | Latency |
|---|---|---|---|
| User saves a golden example (HITL) | embed + INSERT one row | `POST /api/golden-examples` | ~200 ms |
| `npm run build` (incl. Vercel deploy) | reindex 0–N changed anchors | `prebuild` script | ~50 ms no-op; ~3 s if all 35 changed |
| CSV upload | refresh `entity_values` | inside `/api/data/ingest` transaction | ~500 ms (no embed) |
| Server cold start | read `power-prompt.md` | `prompt.ts` module init | <1 ms |
| `npm run migrate-golden-examples` (manual, one-shot) | blob → Postgres + embed | local shell | ~5 s for ~30 examples |
| `npm run seed-entity-index` (manual, one-shot) | populate from existing data | local shell | ~500 ms |

### Anchor question generation

`scripts/reindex-anchors.ts` iterates the 27-entry `REPORTS` array and the 8 dashboard query functions in `src/reports/dashboard.ts` (~35 anchors total). For each, it builds:

```
anchor_question = generateAnchorQuestion(name, sqlFactory({}))
search_text     = anchor_question + ' ' + name + ' ' + extractAliases(sql)
sha             = sha256(search_text)
```

`generateAnchorQuestion` is deterministic — pulls the report name, the `SELECT` aliases, and the `GROUP BY` columns to construct one long-form natural-language question. Example for `r1 Sales Analysis` (selects `primary_sale, primary_return, primary_cn, net_primary, target, achievement_pct, secondary_net, foc_value, collection, closing_value` grouped by `zbm, abm, hq_new`):

> "What are the primary sale, primary return, CN deduction, net primary, target, achievement %, secondary net, FOC value, collection and closing value broken down by ZBM, ABM and HQ?"

If the auto-generated text is wrong for a particular report, override it with a JSDoc tag in the source:

```ts
/** @anchor What are the doctors with low patient counts and high call frequency? */
export function r24DoctorVisitHierarchy(...) { ... }
```

The script reads `@anchor` preferentially over the auto-generated string.

The script reads `embedding_sha` from the DB; mismatch → re-embed via Gemini batch endpoint and UPSERT. Logs `X added, Y updated, Z unchanged`.

### Entity index refresh

`src/lib/entity-index.ts::refreshEntityIndex(sql)` runs five `INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE` statements — one each for brand families, HQs, doctors, segments, ZBMs:

```sql
INSERT INTO entity_values (kind, value, display_count)
SELECT 'brand', UPPER(substring(item_name from '^[A-Za-z][A-Za-z0-9]*')), COUNT(*)
FROM data
WHERE item_name IS NOT NULL AND item_name NOT LIKE '(INACTIVE)%'
GROUP BY UPPER(substring(item_name from '^[A-Za-z][A-Za-z0-9]*'))
ON CONFLICT (kind, value) DO UPDATE SET display_count = EXCLUDED.display_count;
```

Called by:
- `POST /api/data/ingest` — after the typed `INSERT INTO data` succeeds, inside the same transaction.
- `scripts/seed-entity-index.ts` — one-shot, run once during Project 2 bootstrap.

## Power prompt + column dictionary

Two files own behavioral and schema content. Both are read once at module init and cached for the warm Lambda lifetime.

### `src/lib/agent/power-prompt.md`

Single source of truth for behavioral rules. Sections:

- **Decision flow** — five explicit steps to run before responding (am I sure what's asked? have I confirmed entities? are retrieved patterns relevant? are columns right? could the result be misinterpreted?). Each step ends with "if X, call respond_with_clarification."
- **Anti-hallucination traps** — dataset-specific failure modes: column-name confusables (`net_sales_` ≠ `net_sales`, `foc_value` ≠ `foc_value_` ≠ `foc_val_n`), sign-convention traps (`gri_sales`, `rdsi_sales` are negative), period semantics (Indian FY April–March), scope semantics (brand families vs SKUs, inactive item exclusion).
- **Formula dictionary** — relocated verbatim from current `FORMULA_DICTIONARY` in `prompt.ts`.
- **Chart-type rules** — relocated from current `BEHAVIORAL_RULES` rules 7–10.
- **SQL formatting rules** — relocated from current rules 4–6, 10.
- **When in doubt** — "respond_with_clarification beats a wrong answer."

Total size: ~700 tokens; replaces `BEHAVIORAL_RULES` (~500) + `FORMULA_DICTIONARY` (~400). Net change: −200 tokens.

The trap list grows over time as HITL corrections reveal new failure modes. Suggested workflow (manual, ~monthly): run `scripts/review-corrections.ts` (a 30-line script that prints recent `correction_note` rows grouped by similar phrasing) and convert recurring patterns into trap-list bullets.

### `src/lib/column-descriptions.ts`

```ts
import type { CsvColumn } from './schema';

export const COLUMN_DESCRIPTIONS: Record<CsvColumn, string> = {
  net_sales_: 'numeric: primary sales NET of returns. The default "sales" reading. '
    + 'Trailing underscore is intentional — DO NOT use "net_sales" (different column). '
    + 'Examples: 12450.50, 0, -345.20',
  // ... 74 more
};
```

`Record<CsvColumn, string>` enforces compile-time exhaustiveness — adding a column to `CSV_COLUMNS` without a description fails the build. Hand-authored once; ~75 lines, ~30 tokens each, ~2,250 tokens total when injected.

## System prompt assembly

After Project 2, `buildSystemPrompt(input)` returns the concatenation of:

1. Role line ("You are a senior pharma-sales data analyst…"). Static.
2. Schema column list (from `CSV_COLUMNS`). Static.
3. **Column dictionary** (all 75 entries from `COLUMN_DESCRIPTIONS`). Static. **NEW.**
4. **Power prompt content** (read from `power-prompt.md` at module init). Static. **NEW.**
5. Data dictionary summary (row count, FYs, segments, ZBMs, HQs, brand-family list). Computed once per warm Lambda; cached.
6. **Top-5 retrieved golden examples** (RRF over hybrid). Per turn. Replaces today's tag-overlap selection.
7. **Top-3 retrieved ReportDef anchors** (RRF over hybrid). Per turn. **NEW.**
8. Conversation history summary (existing). Per turn.
9. `OUTPUT_CONTRACT` (sentinel-tool definitions). Static.

Cacheable prefix (sections 1–5, 9): ~3,850 tokens. Per-turn variable content (sections 6–8): ~2,000 tokens. Total static system prompt: ~6,100 tokens. Increase of ~3,000 tokens vs today, dominated by the column dictionary (~2,250) and ReportDef anchors (~600).

The cacheable prefix is a candidate for Gemini explicit prompt caching in a follow-up project — would reclaim ~75% of the cost on cache hits.

## Tool surface

| Tool | Today | After Project 2 |
|---|---|---|
| `search_values(column, pattern, limit)` | ILIKE on `data.<column>` | Two-tier: pg_trgm over `entity_values` (kind = column→kind mapping) first; if ≥1 match, return it; if 0, fall back to ILIKE on `data.<column>`. |
| `list_distinct_values(column, limit)` | unchanged | unchanged |
| `run_sql(sql)` | unchanged | unchanged |
| `get_golden_examples(question, k)` | regex tag → topK | **Replaced by `retrieve(query, corpus, k)`.** Args: `query: string`, `corpus: 'golden' \| 'reports' \| 'all'` (default `'all'`), `k?: number` (default 5). For `corpus='golden'` or `'reports'`, `k` is the top-K of that single corpus. For `corpus='all'`, `k` becomes `goldenK` and `anchorsK = ceil(k * 0.6)` is auto-set (5 → 3, matching the upfront-injection ratio). Internally dispatches to `retrieveGoldenExamples`, `retrieveReportAnchors`, or `retrieveAll`. |
| `respond_with_answer` | unchanged | unchanged |
| `respond_with_clarification` | unchanged | unchanged |

The `retrieve` tool gives the agent a way to refine retrieval mid-turn when the upfront top-K injection is off-topic. Documented behavior in power-prompt.md Step 3 ("Are my retrieved examples actually relevant?").

The `column → kind` mapping is hard-coded:

```ts
const COLUMN_TO_KIND: Partial<Record<CsvColumn, EntityKind>> = {
  item_name: 'brand',
  hq_new:    'hq',
  dr_name:   'doctor',
  seg:       'segment',
  zbm:       'zbm',
};
```

Other columns fall straight through to ILIKE.

## Retrieval orchestration (`src/lib/retrieval.ts`)

The Gemini API distinguishes embedding *task types*; we use both:

- `embedText(text)` — stores documents. Calls Gemini with `task: 'RETRIEVAL_DOCUMENT'`.
- `embedQuery(text)` — embeds the live user question for retrieval. Calls Gemini with `task: 'RETRIEVAL_QUERY'`.

Using the right task type for each side improves recall ~5–10% on Gemini's own benchmarks, at zero extra cost. Both helpers live in `src/lib/embeddings.ts`.

```ts
export async function embedQuery(text: string): Promise<number[]>;

export async function retrieveGoldenExamples(
  question: string,
  opts?: { k?: number; embedding?: number[] }
): Promise<GoldenExample[]>;

export async function retrieveReportAnchors(
  question: string,
  opts?: { k?: number; embedding?: number[] }
): Promise<ReportAnchor[]>;

export async function retrieveEntities(
  kind: EntityKind,
  query: string,
  limit?: number
): Promise<EntityMatch[]>;

export async function retrieveAll(
  question: string,
  opts?: { goldenK?: number; anchorsK?: number }
): Promise<{ embedding: number[]; golden: GoldenExample[]; anchors: ReportAnchor[] }>;
```

`retrieveAll()` embeds once, runs both hybrid queries in `Promise.all`. ~150 ms embed + ~30 ms parallel queries = ~180 ms per turn upfront cost (replacing today's ~5 ms tag overlap).

The chat loop in `src/lib/agent/loop.ts` changes from:

```ts
const tags = extractTags(userMessage, deps.db.dictionary);
const goldenExamples = await deps.goldenStore.topK(tags, 5);
```

to:

```ts
const { embedding, golden, anchors } = await retrieveAll(userMessage, {
  goldenK: 5, anchorsK: 3
});
// `embedding` is plumbed into deps.retrieve to support mid-turn retrieve()
// tool calls without re-embedding the original question.
```

## Migration plan

### One-shot migrations (run during Project 2 bootstrap)

1. `psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_rag.sql` — create tables, indexes, extension.
2. `npm run reindex-anchors` — embeds all ~35 ReportDef anchors via Gemini batch endpoint.
3. `npm run migrate-golden-examples` — reads the existing `golden_examples.json` from Vercel Blob, INSERTs each into `golden_examples`, embeds in batches of 100, renames blob → `golden_examples.json.archived`. **Skipped if blob is empty / 0 examples.**
4. `npm run seed-entity-index` — populates `entity_values` from current `data` rows.

After step 4, all corpora are populated and the system is ready for chat cutover.

### Five-phase rollout

| Phase | Scope | Reversibility |
|---|---|---|
| 1 — Schema + helpers | `0002_rag.sql`, `embeddings.ts`, `power-prompt.md`, `column-descriptions.ts`, layer-1 tests | Migration is additive; revert TS commits to roll back. |
| 2 — Indexing pipeline | `reindex-anchors.ts` + `prebuild`, `migrate-golden-examples.ts`, `entity-index.ts` + ingest hook, one-shot scripts | Tables stay populated; revert hooks to roll back. |
| 3 — Retrieval layer | `retrieval.ts`, layer-2 testcontainers tests, retrieval-bench iterations | Pure addition; nothing reads `retrieval.ts` until phase 4. |
| 4 — Chat cutover | `prompt.ts`, `loop.ts`, `tools.ts` rewrites; delete dead code | Single-commit revert restores tag-overlap behavior. |
| 5 — Cleanup | Delete archived blob (30 days post-cutover); optional Gemini prompt caching | No-op until phase 4 has soaked. |

Each phase is independently mergeable. Phase 1's biggest manual lift — hand-authoring 75 column descriptions — gates phases 2–4.

### Rollback

If phase 4 breaks chat:

1. `git revert` the cutover commit.
2. Old code reads `golden_examples.json.archived` once renamed back; Postgres tables stay in place but unused.
3. Phases 1–3 stay merged with no behavior impact.

The 30-day archive window protects the blob through the verification period.

## Test strategy

Three layers, plus a manual quality bench.

### Layer 1 — unit tests (no DB, no API)

| Function | What it tests |
|---|---|
| `generateAnchorQuestion(name, sql)` | Deterministic anchor text generation |
| `extractAliases(sql)` | Pulls `AS xyz` aliases |
| `columnToEntityKind(col)` | `item_name → 'brand'`, etc. |
| `rrfFuse(denseRanks, sparseRanks, k=60)` | Pure-TS mirror of the SQL CTE; sanity-check |
| `buildPowerPromptSections(content)` | Parses the .md into named sections |
| `normalizeSql`, `findDuplicate`, `sha256` | Existing pure functions |

### Layer 2 — integration tests (testcontainers Postgres + mocked embeddings)

`src/lib/embeddings.test-mock.ts` exports a deterministic 1536-dim mock — same input → same output, plausible token-overlap-based cosine similarity.

| Suite | What it asserts |
|---|---|
| `retrieval.test.ts` | Seed 10 known rows; assert top-3 IDs match expected. Vary `status` to confirm `corrected` boost. |
| `retrieval.test.ts` (BM25 leg) | Rare-token query (e.g., "DOLO-650") surfaces via sparse alone; confirms hybrid > dense-only. |
| `retrieval.test.ts` (RRF) | Two rows with crossed dense/sparse ranks both surface in top-3; confirms fusion. |
| `entity-index.test.ts` | "crockin" pg_trgm-matches "CROCIN". |
| `golden-examples.test.ts` | `add` writes + embeds; `topK` returns hybrid results. |
| `tools.test.ts` | `retrieve` produces expected results. `search_values` falls back through entity_values then ILIKE. |
| `loop.test.ts` | Tool-loop assertions unchanged; mock target swaps from `goldenStore.topK` to `retrieveAll`. |
| `prompt.test.ts` | System prompt contains all expected sections (power-prompt content, full column dictionary, retrieved goldens, retrieved anchors). |

### Layer 3 — real-API smoke (gated, manual)

`tests/smoke/embedding-real.test.ts` runs only when `RETRIEVAL_SMOKE=1`. Hits Gemini once. Asserts: 1536 dims; paraphrase pair cosine > 0.7; unrelated pair cosine < 0.4.

### Layer 4 — retrieval-quality regression bench (gated, manual)

`scripts/retrieval-bench.ts` reads `tests/fixtures/retrieval-bench.json` (~20 hand-curated `{ question, expected_top_3 }` cases) and reports pass/fail per case. Run before every deploy. Failing cases are escalated: trap-list addition or anchor-question generator tuning.

### What is deliberately not tested

- Exact RRF score values (only ordering is asserted).
- HNSW recall@K (non-deterministic on insert order; we'd be testing pgvector, not our code).
- Power-prompt.md wording (style, not behavior — covered by the regression bench).
- LLM behavior with the new prompt (impossible to unit-test; covered by the regression bench).

## File inventory

### New

| Path | Purpose |
|---|---|
| `supabase/migrations/0002_rag.sql` | pgvector extension + 3 RAG tables |
| `src/lib/embeddings.ts` | `embedText` / `embedTexts` Gemini wrapper |
| `src/lib/retrieval.ts` | All retrieval functions + RRF SQL |
| `src/lib/entity-index.ts` | `refreshEntityIndex(sql)` |
| `src/lib/column-descriptions.ts` | `Record<CsvColumn, string>` with all 75 entries |
| `src/lib/agent/power-prompt.md` | Decision flow + traps + formulas + chart rules |
| `scripts/reindex-anchors.ts` | SHA-diff embed for ReportDef anchors |
| `scripts/migrate-golden-examples.ts` | Blob → Postgres one-shot |
| `scripts/seed-entity-index.ts` | One-shot entity_values bootstrap |
| `scripts/retrieval-bench.ts` | Manual quality regression bench |
| `tests/fixtures/seed-rag.sql` | Test fixtures with known mock-embeddings |
| `tests/fixtures/retrieval-bench.json` | ~20 question→expected-top-3 cases |
| `src/lib/embeddings.test-mock.ts` | Deterministic mock for tests |
| `src/lib/retrieval.test.ts` | Hybrid + RRF integration tests |
| `src/lib/entity-index.test.ts` | pg_trgm fuzzy match tests |
| `scripts/reindex-anchors.test.ts` | SHA-diff logic, anchor-question generation |
| `src/lib/agent/power-prompt.test.ts` | File loads, sections present |
| `tests/smoke/embedding-real.test.ts` | Real Gemini smoke (gated) |

### Modified

| Path | Change |
|---|---|
| `src/lib/golden-examples.ts` | Replace blob provider with Postgres provider; drop tag/rank/prune machinery |
| `src/lib/agent/prompt.ts` | Read power-prompt.md, inject column-descriptions, inject retrieved anchors; drop `BEHAVIORAL_RULES`, `FORMULA_DICTIONARY` constants |
| `src/lib/agent/loop.ts` | Swap `extractTags` + `goldenStore.topK` for `retrieveAll` |
| `src/lib/agent/tools.ts` | `retrieve` replaces `get_golden_examples`; two-tier `search_values` |
| `src/app/api/data/ingest/route.ts` | Add `refreshEntityIndex` call inside ingest transaction |
| `src/lib/golden-examples.test.ts` | Drop tag/rank/prune tests; rewrite store tests for Postgres |
| `src/lib/agent/loop.test.ts` | Swap mock from `goldenStore.topK` to `retrieveAll` |
| `src/lib/agent/prompt.test.ts` | Assert all new prompt sections |
| `src/lib/agent/tools.test.ts` | Replace `get_golden_examples` test, extend `search_values` test |
| `package.json` | Add `prebuild`, `reindex-anchors`, `migrate-golden-examples`, `seed-entity-index`, `retrieval-bench` scripts |

### Deleted

- `vercelBlobGoldenProvider`, `BLOB_PATH`, `EXPIRY_MONTHS` from `golden-examples.ts`.
- `METRIC_KEYWORDS`, `PERIOD_KEYWORDS`, `BREAKDOWN_KEYWORDS`, `extractTags`, `rankExamples`, `pruneExpired` from `golden-examples.ts`.
- `BEHAVIORAL_RULES`, `FORMULA_DICTIONARY` constants from `prompt.ts` (relocated to `power-prompt.md`).
- After 30 days post-cutover: `golden_examples.json.archived` blob.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Hand-authoring 75 column descriptions takes longer than expected | Phase 1 gating; do not start phase 2 until done. ~2-hour focused sitting. |
| Anchor-question generator produces poor NL for some reports | JSDoc `@anchor` override; retrieval-bench catches regressions. |
| Embedding API quota during migration | Gemini batch endpoint = 100 inputs per call. ~35 anchors + ~30 goldens = 1 batch each. |
| HNSW ANN miss on tiny corpus | At 100–500 rows + `LIMIT 30` pre-fusion, retrieval is essentially exhaustive. Recall ≈ 1.0. |
| Free-tier daily quota cliff (Gemini 250 RPD) | Existing fallback chain already handles this. Adding prompt caching is a +50% lift; defer to Project 3. |
| Postgres FTS English stemmer mishandles pharma jargon | Acceptable: BM25 is recall-boosting, dense leg covers stemmer misses, pg_trgm handles entity-name matches. |
| Blob `golden_examples.json` has rows we lose | 30-day archive window before deletion; migration is non-destructive. |
| `pg_trgm.similarity_threshold` default 0.3 too strict for short brand names | Tunable per-query (`SET LOCAL pg_trgm.similarity_threshold = 0.2`); revisit if bench flags false negatives. |
| Vercel cold start + per-turn embed adds latency | ~180 ms upfront cost is acceptable; revisit only if cumulative agent-loop latency exceeds 5 s. |
| Power-prompt.md edit shipped without redeploy | Edit-PR-deploy is documented in repo README. Live edit is a separate (deferred) project. |

## Sizing impact (Supabase free tier)

| Table | Rows (year 1) | Avg row | Embedding | Indexes | Total |
|---|---|---|---|---|---|
| `golden_examples` | ~100 | ~2 KB | 6 KB (1536 × 4 B) | ~1.5 MB | ~800 KB + index |
| `report_anchors` | ~35 | ~3 KB | 6 KB | ~0.5 MB | ~315 KB + index |
| `entity_values` | ~500 | ~80 B | — | ~40 KB | ~80 KB |
| **RAG total** | | | | | **~5 MB** |

vs the existing 130 MB `data` table; Project 2 adds ~4% to DB footprint. Free-tier 500 MB cap is unaffected.

## References (verifiable; not fetched)

- pgvector: https://github.com/pgvector/pgvector
- pg_trgm docs: https://www.postgresql.org/docs/current/pgtrgm.html
- Postgres FTS docs: https://www.postgresql.org/docs/current/textsearch-controls.html
- Cormack et al. RRF (2009): https://plg.uwaterloo.ca/~gvcormack/cormacksigir09-rrf.pdf
- Gemini embeddings (Matryoshka, dimensions): https://ai.google.dev/gemini-api/docs/embeddings
- MTEB leaderboard: https://huggingface.co/spaces/mteb/leaderboard
- Supabase managed extensions allow-list: https://supabase.com/docs/guides/database/extensions
- "Schema Linking is a Bottleneck" (Maamari et al. 2024): https://arxiv.org/abs/2410.01943
- DAIL-SQL: https://arxiv.org/abs/2308.15363
- CHASE-SQL: https://arxiv.org/abs/2410.01943

## Open questions

None — all design decisions locked in via brainstorming on 2026-04-29. Implementation can proceed straight into the writing-plans phase once this spec is approved.
