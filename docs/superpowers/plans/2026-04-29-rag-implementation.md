# RAG Layer over Supabase + pgvector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace regex-tag retrieval with hybrid (BM25 + pgvector + RRF) retrieval over three corpora — golden Q→SQL pairs, ReportDef anchors, and a pg_trgm entity index — plus inject all 75 column descriptions and a checklist-style power prompt to make cheap fallback models behave.

**Architecture:** Single-Lambda Node.js on Vercel Hobby; Supabase Postgres with pgvector (1536-dim Gemini embeddings) + pg_trgm; Postgres-native FTS for BM25. Embeddings on write everywhere — `prebuild` script for static ReportDef anchors via SHA diff. One unified `retrieve(query, corpus, k)` tool replaces `get_golden_examples`.

**Tech Stack:** Next.js 16 App Router (Turbopack), TypeScript, postgres-js (Porsager), pgvector + pg_trgm, Google `gemini-embedding-001` (Matryoshka 1536-dim, RETRIEVAL_DOCUMENT/RETRIEVAL_QUERY task types), `@google/generative-ai`, Jest + testcontainers-node.

**Spec:** `docs/superpowers/specs/2026-04-29-rag-design.md` — read first, return here.

**Hard constraints (from project brief):**
- No git commits by the agent — user runs commits.
- No new framework dependencies (no Drizzle/Kysely/LangChain).
- No background workers, no cron beyond the existing weekly health Cron.
- Schema changes via numbered SQL files in `supabase/migrations/`.
- Single connection pooler (port 6543), `prepare: false`.

---

## Phasing

| Phase | Tasks | Dependencies |
|---|---|---|
| **1 — Schema + helpers** | 1, 2, 3, 4 | None (parallel-safe) |
| **2 — Indexing pipeline** | 5, 6, 7, 8, 9 | Phase 1 done |
| **3 — Retrieval layer** | 10 | Phase 1 + 2 done |
| **4 — Chat cutover** | 11, 12, 13, 14, 15 | Phase 3 done |
| **Phase verification** | 16, 17 | Phase 4 done |

Each phase ends with `npm test` passing and (where applicable) the user running a local sanity check before moving to the next phase.

---

## Task 1: Schema migration (`0002_rag.sql`)

**Files:**
- Create: `supabase/migrations/0002_rag.sql`
- Verify: connection via `psql "$SUPABASE_DB_URL"`

- [ ] **Step 1.1: Write the migration file**

Create `supabase/migrations/0002_rag.sql`:

```sql
-- Project 2: RAG layer. pgvector + 3 RAG tables.
-- Depends on 0001_init.sql (data, data_raw, pg_trgm).

CREATE EXTENSION IF NOT EXISTS vector;

-- ── 1. Golden Q→SQL pairs (HITL store) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS golden_examples (
  id              text PRIMARY KEY,
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
  search_text     text NOT NULL,
  fts             tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
  embedding       vector(1536),
  embedding_sha   text
);
CREATE INDEX IF NOT EXISTS idx_golden_fts ON golden_examples USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_golden_embedding ON golden_examples
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ── 2. ReportDef anchors ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_anchors (
  report_id       text PRIMARY KEY,
  name            text NOT NULL,
  group_name      text NOT NULL,
  anchor_question text NOT NULL,
  source_sql      text NOT NULL,
  search_text     text NOT NULL,
  fts             tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
  embedding       vector(1536),
  embedding_sha   text
);
CREATE INDEX IF NOT EXISTS idx_anchors_fts ON report_anchors USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_anchors_embedding ON report_anchors
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ── 3. Entity values (pg_trgm fuzzy match, no embeddings) ──────────────
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

- [ ] **Step 1.2: Apply the migration**

Run from project root:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_rag.sql
```

Expected output: `CREATE EXTENSION` (or NOTICE: already exists) followed by 3× `CREATE TABLE` and 5× `CREATE INDEX`.

- [ ] **Step 1.3: Verify schema**

```bash
psql "$SUPABASE_DB_URL" -c "\dt golden_examples report_anchors entity_values"
psql "$SUPABASE_DB_URL" -c "\d golden_examples"
```

Expected: 3 tables present; `golden_examples` shows `embedding vector(1536)`, `fts tsvector`, etc.

- [ ] **Step 1.4: Stage for commit (user runs git commit)**

```bash
git add supabase/migrations/0002_rag.sql
git status
```

---

## Task 2: Embeddings helper (`src/lib/embeddings.ts`)

**Files:**
- Create: `src/lib/embeddings.ts`
- Create: `src/lib/embeddings.test.ts`
- Reference: `process.env.GEMINI_API_KEY` (already set per brief)

- [ ] **Step 2.1: Write the failing test**

Create `src/lib/embeddings.test.ts`:

```ts
import { embedText, embedTexts, embedQuery, sha256 } from './embeddings';

describe('embeddings', () => {
  describe('sha256', () => {
    it('returns deterministic 64-char hex hash', () => {
      const a = sha256('hello');
      const b = sha256('hello');
      const c = sha256('world');
      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('embedText / embedQuery / embedTexts', () => {
    // These hit the real Gemini API; gated behind RETRIEVAL_SMOKE=1.
    const skip = process.env.RETRIEVAL_SMOKE !== '1';

    (skip ? it.skip : it)('embedText returns 1536-dim vector', async () => {
      const v = await embedText('primary sales by HQ');
      expect(v).toHaveLength(1536);
      expect(v.every(n => typeof n === 'number')).toBe(true);
    });

    (skip ? it.skip : it)('embedQuery returns 1536-dim vector', async () => {
      const v = await embedQuery('show me crocin sales');
      expect(v).toHaveLength(1536);
    });

    (skip ? it.skip : it)('embedTexts batches inputs', async () => {
      const vs = await embedTexts(['a', 'b', 'c']);
      expect(vs).toHaveLength(3);
      expect(vs[0]).toHaveLength(1536);
    });
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npm test -- embeddings.test
```

Expected: FAIL with "Cannot find module './embeddings'" or similar.

- [ ] **Step 2.3: Write the helper**

Create `src/lib/embeddings.ts`:

```ts
// Gemini gemini-embedding-001 wrapper. Uses task-specific embedding modes:
// RETRIEVAL_DOCUMENT for stored docs, RETRIEVAL_QUERY for live queries.
// Output dimensionality is MRL-truncated to 1536 (validated cut point per
// ai.google.dev/gemini-api/docs/embeddings).

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createHash } from 'node:crypto';

const MODEL = 'gemini-embedding-001';
const DIM = 1536;

let _client: GoogleGenerativeAI | null = null;
function client(): GoogleGenerativeAI {
  if (_client) return _client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  _client = new GoogleGenerativeAI(key);
  return _client;
}

type TaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

async function embedOne(text: string, taskType: TaskType): Promise<number[]> {
  const model = client().getGenerativeModel({ model: MODEL });
  const res = await model.embedContent({
    content: { role: 'user', parts: [{ text }] },
    taskType,
    outputDimensionality: DIM,
  } as never);
  const v = res.embedding?.values;
  if (!Array.isArray(v) || v.length !== DIM) {
    throw new Error(`embedding returned ${v?.length ?? 0} dims, expected ${DIM}`);
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
  const model = client().getGenerativeModel({ model: MODEL });
  const res = await model.batchEmbedContents({
    requests: texts.map(text => ({
      content: { role: 'user', parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: DIM,
    } as never)),
  });
  const out = res.embeddings?.map(e => e.values ?? []) ?? [];
  for (const v of out) {
    if (v.length !== DIM) throw new Error(`batch embedding returned ${v.length} dims`);
  }
  return out;
}

/** Deterministic SHA-256 hex hash; used for embedding cache invalidation. */
export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
```

- [ ] **Step 2.4: Run test to verify hash test passes**

```bash
npm test -- embeddings.test
```

Expected: PASS for `sha256` tests; SKIP for the three `embed*` tests.

- [ ] **Step 2.5: Manual smoke against real Gemini**

```bash
RETRIEVAL_SMOKE=1 npm test -- embeddings.test
```

Expected: all 4 tests PASS. If FAILS with rate limit, retry once.

- [ ] **Step 2.6: Stage for commit**

```bash
git add src/lib/embeddings.ts src/lib/embeddings.test.ts
git status
```

---

## Task 3: Column descriptions (`src/lib/column-descriptions.ts`)

**Files:**
- Create: `src/lib/column-descriptions.ts`
- Create: `src/lib/column-descriptions.test.ts`
- Reference: `src/lib/schema.ts` (CSV_COLUMNS), `src/reports/dashboard.ts` (formula context)

This task is mostly mechanical — author one short description per column. Use the FORMULA_DICTIONARY in `src/lib/agent/prompt.ts:9-35` and the report SQL in `src/reports/*.ts` as ground truth.

- [ ] **Step 3.1: Write the failing test**

Create `src/lib/column-descriptions.test.ts`:

```ts
import { COLUMN_DESCRIPTIONS } from './column-descriptions';
import { CSV_COLUMNS } from './schema';

describe('COLUMN_DESCRIPTIONS', () => {
  it('has an entry for every CSV_COLUMNS value', () => {
    for (const col of CSV_COLUMNS) {
      expect(COLUMN_DESCRIPTIONS[col]).toBeDefined();
      expect(COLUMN_DESCRIPTIONS[col].length).toBeGreaterThan(20);
    }
  });

  it('has no extra keys beyond CSV_COLUMNS', () => {
    const csv = new Set<string>(CSV_COLUMNS);
    for (const k of Object.keys(COLUMN_DESCRIPTIONS)) {
      expect(csv.has(k)).toBe(true);
    }
  });

  it('mentions the trailing-underscore distinction for net_sales_', () => {
    expect(COLUMN_DESCRIPTIONS.net_sales_).toMatch(/underscore/i);
    expect(COLUMN_DESCRIPTIONS.net_sales_).toMatch(/net_sales/);
  });

  it('mentions sign convention for gri_sales', () => {
    expect(COLUMN_DESCRIPTIONS.gri_sales).toMatch(/negative/i);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
npm test -- column-descriptions.test
```

Expected: FAIL with module not found.

- [ ] **Step 3.3: Author the descriptions**

Create `src/lib/column-descriptions.ts`. Each entry: type + 1-line description + 1-3 sample values. Trailing-underscore and sign-convention traps explicit. Format:

```ts
import type { CsvColumn } from './schema';

/**
 * One human-readable description per column in the `data` table. Injected
 * verbatim into the chat agent's system prompt on every turn — the
 * 75-row dictionary fits in ~2,250 tokens and removes the need to retrieve
 * column docs.
 *
 * Source-of-truth precedence when authoring:
 *   1. The formula dictionary (now in src/lib/agent/power-prompt.md).
 *   2. The report SQL in src/reports/*.ts (canonical usage).
 *   3. CSV_COLUMN_TYPES in src/lib/schema.ts.
 *
 * Format: "type: one-line meaning. Examples: a, b, c"
 *   - For confusable columns, EXPLICITLY name what they are NOT.
 *   - For sign-coded columns, state whether values are negative.
 */
export const COLUMN_DESCRIPTIONS: Record<CsvColumn, string> = {
  // ── Hierarchy / org ────────────────────────────────────────────────────
  pts:        'numeric: points (legacy, low signal). Examples: 12, 0, 1.5',
  pp:         'numeric: previous-period reference (legacy). Examples: 0, 4500',
  co:         'text: company / division code. Examples: SHM, SHN',
  fy:         'text: financial year in Indian format (April–March). Examples: "2024-2025", "2025-2026"',
  zbm:        'text: Zonal Business Manager code. Examples: "ZBM-NORTH", "ZBM-WEST"',
  abm:        'text: Area Business Manager code. Examples: "ABM-DEL", "ABM-MUM"',
  tbm:        'text: Territory Business Manager code. Examples: "TBM-DEL-1"',
  hq_new:     'text: current HQ assignment. Use this (NOT hq) for HQ-level breakdowns. Examples: "DEL-04", "MUM-02"',
  hq:         'text: legacy HQ assignment (pre-restructuring). Prefer hq_new.',
  customer_n: 'text: stockist / customer name. Examples: "ABC Pharma", "XYZ Distributors"',

  // ── Period ─────────────────────────────────────────────────────────────
  yyyymm:     'text (TEXT, NOT integer — preserves leading zeros): year-month period. Examples: "202504", "202601"',
  year:       'numeric: calendar year. Examples: 2025, 2026',
  qtr:        'text: quarter label. Examples: "Q1", "Q2", "Q3", "Q4"',
  hly:        'text: half-yearly label. Examples: "H1", "H2"',
  mth:        'numeric: month number 1-12.',
  month:      'text: month name. Examples: "Apr", "May"',

  // ── Item / segment ─────────────────────────────────────────────────────
  seg:        'text: therapeutic segment. Examples: "NEURO", "CARDIO", "GASTRO"',
  item_code:  'text: SKU code. Examples: "CRO650-10", "DOLO-15"',
  item_name:  'text: full SKU name. Use UPPER(substring(item_name from \'^[A-Za-z][A-Za-z0-9]*\')) to extract the brand family (e.g. CROCIN). EXCLUDE inactive items via NOT LIKE \'(INACTIVE)%\'. Examples: "Crocin-650 10x10", "Dolo-650"',

  // ── Stock movement ─────────────────────────────────────────────────────
  opening_qt: 'numeric: opening stock quantity (units).',
  opening_va: 'numeric: opening stock value (₹).',
  closing_qt: 'numeric: closing stock quantity (units).',
  closing_va: 'numeric: closing stock value (₹).',

  // ── PRIMARY sales (sales TO stockists) ─────────────────────────────────
  // CRITICAL: "primary sales" is the default sales reading in this dataset.
  net_sales_: 'numeric: PRIMARY SALES NET OF RETURNS — the default "sales" reading. The TRAILING UNDERSCORE is intentional. DO NOT use "net_sales" (no underscore) — that is a different, narrower column. Formula: SUM(net_sales_). Examples: 12450.50, 0, -345.20',
  net_sales:  'numeric: distinct from net_sales_ — narrower aggregation, rarely used. Prefer net_sales_ for "primary sales".',
  net_qty:    'numeric: net primary qty.',
  sale_sales: 'numeric: GROSS PRIMARY SALES (before returns/credit notes). Formula: SUM(sale_sales).',
  sale_qty:   'numeric: gross primary qty.',
  gri_sales:  'numeric: PRIMARY RETURNS — STORED AS NEGATIVE VALUES. To compute net = sale_sales + gri_sales (NOT subtract — sign is in the data).',
  gri_qty:    'numeric: primary return qty (typically negative).',
  rdsi_sales: 'numeric: RDSI / credit-note deductions on primary — STORED AS NEGATIVE VALUES. Subtract by adding (sign already in data).',
  rdsi_qty:   'numeric: rdsi qty (typically negative).',

  // ── PRIMARY targets ────────────────────────────────────────────────────
  tgt_val_p:  'numeric: PRIMARY TARGET VALUE (₹). Formula: SUM(tgt_val_p). Achievement % = ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100, 1)',
  tgt_qty_p:  'numeric: primary target qty.',

  // ── SECONDARY sales (sales FROM stockists to retailers) ────────────────
  sales_valu: 'numeric: SECONDARY SALES VALUE (₹). Note the spelling — sales_VALU (no E). Formula: SUM(sales_valu). Examples: 8200, 0',
  sales_qty_: 'numeric: PRIMARY qty (with trailing underscore). NOT secondary qty — see sales_qty2.',
  sales_qty2: 'numeric: secondary qty.',
  sales_qty3: 'numeric: tertiary qty (rarely used).',
  sales_val2: 'numeric: secondary value (alternate column, low usage).',

  // ── SECONDARY targets ──────────────────────────────────────────────────
  tgt_val_s:  'numeric: SECONDARY TARGET VALUE. Achievement % = ROUND(SUM(sales_valu)/NULLIF(SUM(tgt_val_s),0)*100, 1)',
  tgt_qty_s:  'numeric: secondary target qty.',

  // ── FOC (free-of-cost) ─────────────────────────────────────────────────
  // CRITICAL: three nearly identical column names; do not confuse.
  foc_value:  'numeric: FOC VALUE (₹) — the canonical FOC value column. Formula: SUM(foc_value). DO NOT use foc_value_ or foc_val_n.',
  foc_value_: 'numeric: legacy/alternate FOC value (NOT the canonical FOC). Prefer foc_value.',
  foc_val_n:  'numeric: NET-SECONDARY FOC ADJUSTMENT. Used only in the formula: SUM(sales_valu) - SUM(foc_val_n). NOT a standalone FOC value.',
  foc_qty__s: 'numeric: FOC qty (with double underscore + s suffix). Formula: SUM(foc_qty__s + cn_qty) for FOC qty.',
  foc_rate:   'numeric: FOC rate (per unit).',
  cn_qty:     'numeric: credit-note qty. Combined with foc_qty__s in FOC formulas.',
  cn_value:   'numeric: credit-note value.',

  // ── Doctors / patients ─────────────────────────────────────────────────
  doc_code:   'text: doctor code.',
  dr_name:    'text: doctor full name. Examples: "Dr. Sharma A", "Dr. Patel R"',
  no_patient: 'numeric: PAP patients (in thousands). Formula: SUM(no_patient) * 1000.',
  dc_patient: 'numeric: DCPP patients (in thousands). Formula: SUM(dc_patient) * 1000.',
  pap_stn:    'text: PAP station / center.',
  pap_date:   'text (date as TEXT — CSV uses "/  /" sentinel). PAP visit date.',
  done_by:    'text: who recorded the entry.',

  // ── Expiry / returns ───────────────────────────────────────────────────
  return_qty: 'numeric: total return quantity (may be negative).',
  return_amt: 'numeric: TOTAL RETURNING (₹). May be negative. Formula: SUM(return_amt). Long-expiry-bucket = SUM(return_amt) - SUM(expired) - SUM(near_3) - SUM(near_6) - SUM(near_9)',
  expired:    'numeric: EXPIRED RETURN VALUE. Formula: SUM(expired).',
  near_3:     'numeric: returns with ≤3-month expiry remaining.',
  near_6:     'numeric: returns with ≤6-month expiry remaining.',
  near_9:     'numeric: returns with ≤9-month expiry remaining.',
  exp_dt:     'text (date as TEXT). Expiry date.',
  expiry_dat: 'text (date as TEXT). Expiry date alternate.',
  batch_no_:  'text: batch number (trailing underscore in column name).',

  // ── Expenses ───────────────────────────────────────────────────────────
  camp_exp:   'numeric: campaign expenses. Component of total_expenses.',
  sample_qty: 'numeric: sample quantity distributed.',
  sample_exp: 'numeric: SAMPLE EXPENSES. Component of: SUM(foc_value)+SUM(sample_exp)+SUM(mrkt_exp)+SUM(camp_exp).',
  sample_pts: 'numeric: sample points (legacy).',
  mrkt_qty:   'numeric: marketing qty.',
  mrkt_exp:   'numeric: MARKETING EXPENSES. Component of total_expenses.',
  mrkt_pts:   'numeric: marketing points (legacy).',

  // ── Collection / misc ──────────────────────────────────────────────────
  coll:       'numeric: collection (₹). Outstanding = SUM(net_sales_) - SUM(coll).',
  coll_date:  'text (date as TEXT). Collection date.',
  category:   'text: customer/product category label.',
  remark:     'text: free-form remark.',
};
```

NOTE: Verify the count is exactly 75. Run:

```bash
node -e "console.log(Object.keys(require('./src/lib/column-descriptions.ts').COLUMN_DESCRIPTIONS).length)" 2>/dev/null || echo "use ts-node"
```

Or rely on the type system — `Record<CsvColumn, string>` with all 75 CsvColumn keys must be present, or TypeScript fails the build.

- [ ] **Step 3.4: Run test**

```bash
npm test -- column-descriptions.test
```

Expected: PASS. If FAIL on "missing entry", add the column. If FAIL on "extra key", remove it.

- [ ] **Step 3.5: Verify TypeScript exhaustiveness**

```bash
npx tsc --noEmit
```

Expected: no errors. If `Record<CsvColumn, string>` is missing keys, TypeScript will name them.

- [ ] **Step 3.6: Stage**

```bash
git add src/lib/column-descriptions.ts src/lib/column-descriptions.test.ts
git status
```

---

## Task 4: Power prompt file (`src/lib/agent/power-prompt.md`)

**Files:**
- Create: `src/lib/agent/power-prompt.md`
- Create: `src/lib/agent/power-prompt.ts` (the loader)
- Create: `src/lib/agent/power-prompt.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `src/lib/agent/power-prompt.test.ts`:

```ts
import { POWER_PROMPT, getPowerPromptSection } from './power-prompt';

describe('POWER_PROMPT', () => {
  it('loads non-empty content', () => {
    expect(POWER_PROMPT.length).toBeGreaterThan(500);
  });

  it('contains all expected top-level sections', () => {
    const required = [
      '# DECISION FLOW',
      '# ANTI-HALLUCINATION TRAPS',
      '# FORMULA DICTIONARY',
      '# CHART TYPE RULES',
      '# SQL FORMATTING RULES',
      '# WHEN IN DOUBT',
    ];
    for (const r of required) expect(POWER_PROMPT).toContain(r);
  });

  it('mentions the trailing-underscore trap for net_sales_', () => {
    expect(POWER_PROMPT).toMatch(/net_sales_/);
    expect(POWER_PROMPT).toMatch(/underscore/i);
  });

  it('mentions the gri_sales sign convention', () => {
    expect(POWER_PROMPT).toMatch(/gri_sales/);
    expect(POWER_PROMPT).toMatch(/negative/i);
  });

  it('section getter returns content for known headings', () => {
    const flow = getPowerPromptSection('DECISION FLOW');
    expect(flow).toBeTruthy();
    expect(flow!.length).toBeGreaterThan(50);
  });

  it('section getter returns null for unknown heading', () => {
    expect(getPowerPromptSection('NONEXISTENT')).toBeNull();
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
npm test -- power-prompt.test
```

Expected: FAIL with module not found.

- [ ] **Step 4.3: Write the markdown content**

Create `src/lib/agent/power-prompt.md` (verbatim — author with intent; this file is hot-reloaded in dev):

```md
# DECISION FLOW

Run through these steps IN ORDER before every response.
Cheap models: think out loud through each step before acting.

## Step 1 — Is the question fully unambiguous?

Required clarity on:
- METRIC: primary or secondary? gross or net? value or quantity?
- PERIOD: which FY? which quarter? YTD vs full year?
- SCOPE: which HQ / segment / brand?
- COMPARISON BASELINE: vs target? vs last year? vs another HQ?

If ANY field above is ambiguous → call respond_with_clarification with ONE focused
question. Do NOT default-guess.

## Step 2 — Have I confirmed every named entity?

For every brand / item / doctor / HQ name in the question:
1. Call search_values(column, pattern) FIRST.
2. If 0 matches → respond_with_clarification ("Did you mean X or Y?").
3. Never write SQL with a literal entity string you have not confirmed.

## Step 3 — Are my retrieved examples actually relevant?

Look at the GOLDEN EXAMPLES and REPORT TEMPLATES sections of this prompt.
- If a retrieved example matches the question shape → follow its SQL pattern.
- If retrieved examples are off-topic → call retrieve(query, corpus="all", k=10)
  with a refined query (e.g., "monthly returns by segment").
- If still empty → respond_with_clarification before improvising.

## Step 4 — Are my columns the RIGHT ones?

Cross-check every column you reference against the COLUMN DICTIONARY.
"Sales" alone is ambiguous: primary (net_sales_) vs secondary (sales_valu)
vs gross primary (sale_sales). When in doubt → respond_with_clarification.

## Step 5 — Could the result be misinterpreted?

Every assumption you made → list it in `assumptions` (semicolon-separated).
Examples:
- "Excluded INACTIVE items"
- "Included only FY 2025-2026"
- "Returns shown as positive numbers (gri_sales is negative in source)"

# ANTI-HALLUCINATION TRAPS

These are real failure modes from this dataset. Memorize before responding.

## Column-name confusables

- `net_sales_` (TRAILING underscore) is primary sales NET of returns. The default
  "sales" reading. DO NOT use `net_sales` (no underscore) — that's a different,
  narrower column. ALWAYS double-check the underscore.
- `foc_value` (correct, no trailing _) ≠ `foc_value_` ≠ `foc_val_n`.
  Three different columns. FOC formula uses `foc_value`. `foc_val_n` is the
  net-secondary FOC adjustment.
- `sales_valu` (truncated, no E) is secondary sales value. Do NOT type `sales_value`.
- `sales_qty_` (trailing _) is PRIMARY qty. `sales_qty2` and `sales_qty3` are
  secondary/tertiary qty.
- `tgt_val_p` vs `tgt_val_s` — primary vs secondary target value. Easy to swap.

## Sign convention

- `gri_sales`, `rdsi_sales` are stored as NEGATIVE numbers (returns / credit notes).
  net = sale_sales + gri_sales + rdsi_sales (NOT subtract — the negative is in the data).
- `return_amt`, `expired`, `near_3`, `near_6`, `near_9` may be negative. The KPIs in
  src/reports/dashboard.ts are the canonical reference; mimic them.

## Period semantics

- "Last quarter" / "this quarter" depend on the Indian financial year (April–March).
  If user did not specify FY → ask which one.
- "YTD" means current FY only, from April through latest yyyymm. Confirm if ambiguous.
- `yyyymm` is TEXT (preserves leading zeros). Compare with strings, not integers.

## Scope semantics

- "Sales" alone → is it primary or secondary? ASK. Never guess.
- "Crocin" / "Dolo" etc. — these are brand FAMILIES (CROCIN, DOLO uppercase prefix);
  multiple SKUs share each family. Use search_values(item_name, "Crocin") to find
  exact SKUs, OR group by UPPER(substring(item_name from '^[A-Za-z][A-Za-z0-9]*'))
  to aggregate family-level.
- Inactive items: ALWAYS add `AND item_name NOT LIKE '(INACTIVE)%'` unless user
  explicitly asks to include inactive.

# FORMULA DICTIONARY

Use these formulas exactly. Do not invent variants.

- Primary Sales       = SUM(net_sales_)
- Primary Target      = SUM(tgt_val_p)
- Primary Ach%        = ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100, 1)
- Secondary Sales     = SUM(sales_valu)
- Secondary Target    = SUM(tgt_val_s)
- Secondary Ach%      = ROUND(SUM(sales_valu)/NULLIF(SUM(tgt_val_s),0)*100, 1)
- FOC Value           = SUM(foc_value)
- FOC Qty             = SUM(foc_qty__s + cn_qty)
- Net Secondary       = SUM(sales_valu) - SUM(foc_val_n)
- Total Secondary     = SUM(sales_valu) - SUM(foc_val_n) + SUM(foc_value)
- Total Expenses      = SUM(foc_value) + SUM(sample_exp) + SUM(mrkt_exp) + SUM(camp_exp)
- Sale Primary        = SUM(sale_sales)
- Returning Primary   = SUM(gri_sales)
- RDSI Primary        = SUM(rdsi_sales)
- Net Primary         = SUM(net_sales_)
- Total Returning     = SUM(return_amt)
- Expired Returning   = SUM(expired)
- Near 3m expiry      = SUM(near_3)
- Near 6m expiry      = SUM(near_6)
- Near 9m expiry      = SUM(near_9)
- Long Expiry (>9m)   = SUM(return_amt)-SUM(expired)-SUM(near_3)-SUM(near_6)-SUM(near_9)
- PAP Patients        = SUM(no_patient) * 1000
- DCPP Patients       = SUM(dc_patient) * 1000
- Outstanding         = SUM(net_sales_) - SUM(coll)

# CHART TYPE RULES

- Trend over time → line. Sort by period ASC.
- Top-N ranked list → hbar. Sort DESC. LIMIT N.
- Single-number answer → kpi.
- 2D breakdown (HQ × segment) → stacked_bar.
- Heavy table that's hard to chart → table_only.

`chart_x` is ALWAYS the categorical column, never the numeric value. This applies
even to hbar (where bars run horizontal but the category is still the x-axis label).
In your SELECT list, put the category column first and the numeric column(s) second.

# SQL FORMATTING RULES

- ONE SINGLE LINE inside the `sql` argument. Spaces, not newlines.
- No SQL comments inside tool-call args (the JSON parser rejects them).
- Total `sql` argument < 2000 characters.
- SELECT only. No INSERT/UPDATE/DELETE/DDL.
- Always SELECT explicit column names. Never SELECT *.
- Money → ROUND(..., 2). Percentages → ROUND(..., 1).

# WHEN IN DOUBT

respond_with_clarification beats a wrong answer.
The user's 10-second clarification is cheaper than your wrong SQL.
```

- [ ] **Step 4.4: Write the loader**

Create `src/lib/agent/power-prompt.ts`:

```ts
// Loads power-prompt.md once per warm Lambda. Module-level cache; in dev,
// Next.js HMR re-evaluates this file when the .md changes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let _cache: string | null = null;

function load(): string {
  if (_cache) return _cache;
  const path = join(process.cwd(), 'src/lib/agent/power-prompt.md');
  _cache = readFileSync(path, 'utf8');
  return _cache;
}

export const POWER_PROMPT: string = load();

/** Returns the body of a top-level (#) section by name, or null. */
export function getPowerPromptSection(name: string): string | null {
  const re = new RegExp(`^# ${name}\\s*$([\\s\\S]*?)(?=^# |\\Z)`, 'mi');
  const m = POWER_PROMPT.match(re);
  return m ? m[1].trim() : null;
}
```

- [ ] **Step 4.5: Run test to verify it passes**

```bash
npm test -- power-prompt.test
```

Expected: PASS for all 6 tests.

- [ ] **Step 4.6: Stage**

```bash
git add src/lib/agent/power-prompt.md src/lib/agent/power-prompt.ts src/lib/agent/power-prompt.test.ts
git status
```

---

## Task 5: Anchor question generator + reindex script

**Files:**
- Create: `src/lib/agent/anchor-generator.ts`
- Create: `src/lib/agent/anchor-generator.test.ts`
- Create: `scripts/reindex-anchors.ts`
- Modify: `package.json` (add scripts)
- Reference: `src/reports/index.ts`, `src/reports/dashboard.ts`

- [ ] **Step 5.1: Write failing tests for the generator**

Create `src/lib/agent/anchor-generator.test.ts`:

```ts
import { extractAliases, generateAnchorQuestion } from './anchor-generator';

describe('extractAliases', () => {
  it('pulls AS-aliased columns from a SELECT', () => {
    const sql = `SELECT zbm, abm, hq_new,
      SUM(sale_sales) AS primary_sale,
      SUM(gri_sales) AS primary_return,
      SUM(net_sales_) AS net_primary
    FROM data WHERE fy = $1 GROUP BY zbm, abm, hq_new`;
    const aliases = extractAliases(sql);
    expect(aliases).toEqual(['primary_sale', 'primary_return', 'net_primary']);
  });

  it('returns empty array on no aliases', () => {
    expect(extractAliases('SELECT 1 FROM data')).toEqual([]);
  });
});

describe('generateAnchorQuestion', () => {
  it('produces a long-form NL question from name + sql', () => {
    const sql = `SELECT zbm, abm, hq_new,
      SUM(sale_sales) AS primary_sale,
      SUM(net_sales_) AS net_primary
    FROM data GROUP BY zbm, abm, hq_new ORDER BY net_primary DESC`;
    const q = generateAnchorQuestion('Sales Analysis', sql);
    expect(q).toMatch(/sales analysis/i);
    expect(q).toMatch(/primary[_ ]sale/i);
    expect(q).toMatch(/net[_ ]primary/i);
    expect(q).toMatch(/zbm/i);
    expect(q.length).toBeGreaterThan(50);
  });

  it('handles SQL with no GROUP BY', () => {
    const sql = `SELECT SUM(net_sales_) AS net_primary FROM data`;
    const q = generateAnchorQuestion('Total Sales', sql);
    expect(q).toMatch(/total sales/i);
    expect(q).toMatch(/net[_ ]primary/i);
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
npm test -- anchor-generator.test
```

Expected: FAIL with module not found.

- [ ] **Step 5.3: Write the generator**

Create `src/lib/agent/anchor-generator.ts`:

```ts
// Deterministic NL anchor question generator. Used by scripts/reindex-anchors.ts
// to turn each ReportDef SQL into a long-form question that the embedding model
// can match against natural-language user queries.

const SELECT_RE = /SELECT([\s\S]*?)FROM/i;
const ALIAS_RE  = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
const GROUP_RE  = /GROUP\s+BY\s+([\s\S]*?)(ORDER\s+BY|LIMIT|$)/i;

export function extractAliases(sql: string): string[] {
  const sel = sql.match(SELECT_RE);
  if (!sel) return [];
  const inside = sel[1];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  ALIAS_RE.lastIndex = 0;
  while ((m = ALIAS_RE.exec(inside)) !== null) out.push(m[1]);
  return out;
}

function extractGroupCols(sql: string): string[] {
  const m = sql.match(GROUP_RE);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim()).filter(Boolean);
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase();
}

/**
 * Build a long-form natural-language question that summarizes what a report
 * computes, suitable for embedding-based retrieval.
 *
 * Example:
 *   name = "Sales Analysis"
 *   aliases = ["primary_sale", "net_primary", "achievement_pct"]
 *   group  = ["zbm", "abm", "hq_new"]
 * → "What are the primary sale, net primary and achievement pct broken down
 *    by zbm, abm and hq new for the Sales Analysis report?"
 */
export function generateAnchorQuestion(name: string, sql: string): string {
  const aliases = extractAliases(sql).map(humanize);
  const group   = extractGroupCols(sql).map(humanize);
  const aliasPart = aliases.length === 0
    ? 'metrics'
    : aliases.length === 1
      ? aliases[0]
      : `${aliases.slice(0, -1).join(', ')} and ${aliases[aliases.length - 1]}`;
  const groupPart = group.length === 0
    ? ''
    : group.length === 1
      ? ` broken down by ${group[0]}`
      : ` broken down by ${group.slice(0, -1).join(', ')} and ${group[group.length - 1]}`;
  return `What are the ${aliasPart}${groupPart} for the ${name} report?`;
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

```bash
npm test -- anchor-generator.test
```

Expected: PASS for both `extractAliases` and `generateAnchorQuestion` test groups.

- [ ] **Step 5.5: Write the reindex script**

Create `scripts/reindex-anchors.ts`:

```ts
#!/usr/bin/env node
// Embeds (or re-embeds, on SHA mismatch) all ReportDef anchors into
// the report_anchors table. Run from `prebuild` and as `npm run reindex-anchors`.
//
// Anchor source: src/reports/index.ts (REPORTS) + src/reports/dashboard.ts.
// Override the auto-generated anchor with `/** @anchor <text> */` JSDoc.

import 'dotenv/config';
import sql from '../src/lib/db';
import { embedTexts, sha256 } from '../src/lib/embeddings';
import { generateAnchorQuestion, extractAliases } from '../src/lib/agent/anchor-generator';
import { REPORTS } from '../src/reports';
import * as dashboard from '../src/reports/dashboard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface AnchorEntry {
  report_id: string;
  name: string;
  group_name: string;
  anchor_question: string;
  source_sql: string;
  search_text: string;
  sha: string;
}

// Read raw source files to find @anchor JSDoc tags.
function findAnchorOverride(fnName: string, srcPaths: string[]): string | null {
  for (const path of srcPaths) {
    const src = readFileSync(path, 'utf8');
    const re = new RegExp(`@anchor\\s+([^\\n]+)\\s*\\*\\/\\s*export\\s+function\\s+${fnName}\\b`);
    const m = src.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function buildEntries(): AnchorEntry[] {
  const entries: AnchorEntry[] = [];
  const groupSrcs = ['a','b','c','d','e','f','g'].map(g =>
    join(process.cwd(), `src/reports/group-${g}.ts`));
  const dashSrc = [join(process.cwd(), 'src/reports/dashboard.ts')];

  // ── ReportDefs ────────────────────────────────────────────────────────
  for (const def of REPORTS) {
    const fnName = def.sqlFactory.name;
    const sqlText = def.sqlFactory({}).text;
    const override = findAnchorOverride(fnName, groupSrcs);
    const anchor_question = override ?? generateAnchorQuestion(def.name, sqlText);
    const aliases = extractAliases(sqlText).join(' ');
    const search_text = `${anchor_question} ${def.name} ${aliases}`.trim();
    entries.push({
      report_id: def.id,
      name: def.name,
      group_name: def.group,
      anchor_question,
      source_sql: sqlText,
      search_text,
      sha: sha256(search_text),
    });
  }

  // ── Dashboard query functions ─────────────────────────────────────────
  const dashFns: Array<[string, string, (f: object) => { text: string; params: unknown[] }]> = [
    ['dash_overview_kpis',           'Dashboard Overview KPIs',          dashboard.dashOverviewKpis],
    ['dash_overview_fy',             'Dashboard Overview FY-wise',       dashboard.dashOverviewFy],
    ['dash_brand',                   'Dashboard Brand Breakdown',        dashboard.dashBrand],
    ['dash_segment',                 'Dashboard Segment Breakdown',      dashboard.dashSegment],
    ['dash_expenses',                'Dashboard Expenses',                dashboard.dashExpenses],
    ['dash_primary_bifurcation',     'Dashboard Primary Bifurcation',    dashboard.dashPrimaryBifurcation],
    ['dash_primary_bifurcation_fy',  'Dashboard Primary Bifurcation FY', dashboard.dashPrimaryBifurcationFy],
    ['dash_returning',               'Dashboard Returning',              dashboard.dashReturning],
  ];

  for (const [id, name, fn] of dashFns) {
    const sqlText = fn({}).text;
    const override = findAnchorOverride(fn.name, dashSrc);
    const anchor_question = override ?? generateAnchorQuestion(name, sqlText);
    const aliases = extractAliases(sqlText).join(' ');
    const search_text = `${anchor_question} ${name} ${aliases}`.trim();
    entries.push({
      report_id: id,
      name,
      group_name: 'Dashboard',
      anchor_question,
      source_sql: sqlText,
      search_text,
      sha: sha256(search_text),
    });
  }

  return entries;
}

async function main(): Promise<void> {
  console.log('Building anchor entries…');
  const entries = buildEntries();
  console.log(`Built ${entries.length} entries`);

  // Fetch existing SHAs.
  const existing = await sql<{ report_id: string; embedding_sha: string | null }[]>`
    SELECT report_id, embedding_sha FROM report_anchors
  `;
  const shaMap = new Map(existing.map(r => [r.report_id, r.embedding_sha]));

  const toEmbed = entries.filter(e => shaMap.get(e.report_id) !== e.sha);
  console.log(`${toEmbed.length} need (re-)embedding; ${entries.length - toEmbed.length} unchanged`);

  if (toEmbed.length > 0) {
    const embeddings = await embedTexts(toEmbed.map(e => e.search_text));
    for (let i = 0; i < toEmbed.length; i++) {
      const e = toEmbed[i];
      const v = embeddings[i];
      await sql`
        INSERT INTO report_anchors
          (report_id, name, group_name, anchor_question, source_sql, search_text, embedding, embedding_sha)
        VALUES
          (${e.report_id}, ${e.name}, ${e.group_name}, ${e.anchor_question},
           ${e.source_sql}, ${e.search_text}, ${'[' + v.join(',') + ']'}::vector, ${e.sha})
        ON CONFLICT (report_id) DO UPDATE SET
          name = EXCLUDED.name,
          group_name = EXCLUDED.group_name,
          anchor_question = EXCLUDED.anchor_question,
          source_sql = EXCLUDED.source_sql,
          search_text = EXCLUDED.search_text,
          embedding = EXCLUDED.embedding,
          embedding_sha = EXCLUDED.embedding_sha
      `;
    }
  }

  // Also UPSERT unchanged rows so any text drift in source_sql / name lands.
  const unchanged = entries.filter(e => shaMap.get(e.report_id) === e.sha);
  for (const e of unchanged) {
    await sql`
      INSERT INTO report_anchors
        (report_id, name, group_name, anchor_question, source_sql, search_text, embedding_sha)
      VALUES
        (${e.report_id}, ${e.name}, ${e.group_name}, ${e.anchor_question},
         ${e.source_sql}, ${e.search_text}, ${e.sha})
      ON CONFLICT (report_id) DO UPDATE SET
        name = EXCLUDED.name,
        group_name = EXCLUDED.group_name,
        anchor_question = EXCLUDED.anchor_question,
        source_sql = EXCLUDED.source_sql,
        search_text = EXCLUDED.search_text
    `;
  }

  console.log(`Done. ${toEmbed.length} embedded, ${unchanged.length} text-only updated.`);
  await sql.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 5.6: Add npm scripts**

Modify `package.json` — add to the `"scripts"` block:

```json
"prebuild": "tsx scripts/reindex-anchors.ts",
"reindex-anchors": "tsx scripts/reindex-anchors.ts",
```

Make sure `tsx` is available; if not, install it:

```bash
npm install --save-dev tsx dotenv
```

- [ ] **Step 5.7: Run reindex once and verify**

```bash
npm run reindex-anchors
```

Expected output: "Built ~35 entries" → "~35 need (re-)embedding" → "Done. ~35 embedded, 0 text-only updated."

Verify the table:

```bash
psql "$SUPABASE_DB_URL" -c "SELECT report_id, name FROM report_anchors ORDER BY report_id LIMIT 5;"
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM report_anchors WHERE embedding IS NOT NULL;"
```

Expected: 5 rows from the first query; total count = ~35 from the second.

- [ ] **Step 5.8: Run again to confirm idempotence**

```bash
npm run reindex-anchors
```

Expected output: "0 need (re-)embedding; ~35 unchanged" → "Done. 0 embedded, ~35 text-only updated."

- [ ] **Step 5.9: Stage**

```bash
git add src/lib/agent/anchor-generator.ts src/lib/agent/anchor-generator.test.ts scripts/reindex-anchors.ts package.json package-lock.json
git status
```

---

## Task 6: Migration script (`scripts/migrate-golden-examples.ts`)

**Files:**
- Create: `scripts/migrate-golden-examples.ts`
- Modify: `package.json` (add npm script)

- [ ] **Step 6.1: Write the migration script**

Create `scripts/migrate-golden-examples.ts`:

```ts
#!/usr/bin/env node
// One-shot: read the existing golden_examples.json from Vercel Blob, INSERT
// each row into the new Postgres table, embed, and rename the blob to
// .archived for 30-day rollback.
//
// Idempotent: existing IDs are skipped.

import 'dotenv/config';
import { list, put, del } from '@vercel/blob';
import sql from '../src/lib/db';
import { embedTexts, sha256 } from '../src/lib/embeddings';

const BLOB_PATH = 'golden_examples.json';
const ARCHIVED_PATH = 'golden_examples.json.archived';

interface OldGolden {
  id: string;
  question: string;
  question_tags?: string[];
  narrative: string;
  sql: string;
  chart_type: string;
  assumptions?: string[];
  status: 'verified' | 'corrected';
  correction_note?: string;
  created_at: string;
  verified_at: string;
  use_count: number;
}

async function readBlob(): Promise<OldGolden[]> {
  const { blobs } = await list({ prefix: BLOB_PATH });
  const blob = blobs.find(b => b.pathname === BLOB_PATH);
  if (!blob) return [];
  const res = await fetch(blob.url, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`fetch blob: ${res.status}`);
  const json = await res.json() as unknown;
  if (!Array.isArray(json)) return [];
  return json as OldGolden[];
}

async function main(): Promise<void> {
  console.log('Reading existing golden_examples.json from Vercel Blob…');
  const old = await readBlob();
  console.log(`Found ${old.length} examples in blob.`);
  if (old.length === 0) {
    console.log('Nothing to migrate. Exiting.');
    await sql.end();
    return;
  }

  // Filter out IDs that already exist in Postgres.
  const existing = await sql<{ id: string }[]>`SELECT id FROM golden_examples`;
  const existingIds = new Set(existing.map(r => r.id));
  const toInsert = old.filter(o => !existingIds.has(o.id));
  console.log(`${toInsert.length} new (others already in DB).`);

  if (toInsert.length === 0) {
    console.log('Nothing new to insert. Skipping embed.');
  } else {
    // Embed in one batch (Gemini supports up to 100; if the blob has more,
    // chunk by 100).
    const CHUNK = 100;
    for (let off = 0; off < toInsert.length; off += CHUNK) {
      const chunk = toInsert.slice(off, off + CHUNK);
      console.log(`Embedding chunk ${off}-${off + chunk.length}…`);
      const embeddings = await embedTexts(chunk.map(o => o.question));
      for (let i = 0; i < chunk.length; i++) {
        const o = chunk[i];
        const v = embeddings[i];
        const search_text = o.question;
        await sql`
          INSERT INTO golden_examples
            (id, question, narrative, sql, chart_type, assumptions, status,
             correction_note, created_at, verified_at, use_count, search_text,
             embedding, embedding_sha)
          VALUES
            (${o.id}, ${o.question}, ${o.narrative}, ${o.sql}, ${o.chart_type},
             ${o.assumptions ?? []}, ${o.status}, ${o.correction_note ?? null},
             ${o.created_at}, ${o.verified_at}, ${o.use_count},
             ${search_text}, ${'[' + v.join(',') + ']'}::vector, ${sha256(search_text)})
          ON CONFLICT (id) DO NOTHING
        `;
      }
    }
  }

  // Archive the blob.
  console.log('Archiving original blob…');
  const blobJson = JSON.stringify(old, null, 2);
  await put(ARCHIVED_PATH, blobJson, {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  // Now delete the active blob (do NOT delete the archived one).
  const { blobs } = await list({ prefix: BLOB_PATH });
  for (const b of blobs) {
    if (b.pathname === BLOB_PATH) await del(b.url);
  }

  const finalCount = await sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM golden_examples`;
  console.log(`Migration complete. ${finalCount[0]?.n} rows in golden_examples; archived blob kept for 30 days.`);
  await sql.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 6.2: Add npm script**

Modify `package.json` "scripts":

```json
"migrate-golden-examples": "tsx scripts/migrate-golden-examples.ts",
```

- [ ] **Step 6.3: Run migration**

```bash
npm run migrate-golden-examples
```

Expected: prints found count, prints embedded count, archives blob, prints final DB count. If the blob is empty/non-existent: prints "Nothing to migrate. Exiting."

- [ ] **Step 6.4: Verify**

```bash
psql "$SUPABASE_DB_URL" -c "SELECT id, question, status FROM golden_examples LIMIT 3;"
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM golden_examples WHERE embedding IS NOT NULL;"
```

Expected: rows present (or empty if blob was empty); embedded count matches inserted count.

- [ ] **Step 6.5: Stage**

```bash
git add scripts/migrate-golden-examples.ts package.json
git status
```

---

## Task 7: Entity index helper + ingest hook

**Files:**
- Create: `src/lib/entity-index.ts`
- Create: `src/lib/entity-index.test.ts`
- Modify: `src/app/api/data/ingest/route.ts`
- Create: `scripts/seed-entity-index.ts`
- Modify: `package.json`

- [ ] **Step 7.1: Write failing tests**

Create `src/lib/entity-index.test.ts`:

```ts
import { ENTITY_KIND_BY_COLUMN, isEntityColumn } from './entity-index';

describe('entity-index', () => {
  describe('column → kind mapping', () => {
    it('maps known columns', () => {
      expect(ENTITY_KIND_BY_COLUMN.item_name).toBe('brand');
      expect(ENTITY_KIND_BY_COLUMN.hq_new).toBe('hq');
      expect(ENTITY_KIND_BY_COLUMN.dr_name).toBe('doctor');
      expect(ENTITY_KIND_BY_COLUMN.seg).toBe('segment');
      expect(ENTITY_KIND_BY_COLUMN.zbm).toBe('zbm');
    });

    it('isEntityColumn returns true only for mapped columns', () => {
      expect(isEntityColumn('item_name')).toBe(true);
      expect(isEntityColumn('hq')).toBe(false);
      expect(isEntityColumn('net_sales_')).toBe(false);
    });
  });
});
```

- [ ] **Step 7.2: Run test to confirm it fails**

```bash
npm test -- entity-index.test
```

Expected: FAIL with module not found.

- [ ] **Step 7.3: Write the helper**

Create `src/lib/entity-index.ts`:

```ts
// Refresh entity_values from the canonical `data` table. Called after each
// CSV upload (inside the ingest transaction) and once at bootstrap via
// scripts/seed-entity-index.ts.
//
// Five kinds: brand (family prefix), hq, doctor, segment, zbm. Each kind
// gets one INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE.

import type { Sql } from 'postgres';
import type { CsvColumn } from './schema';

export type EntityKind = 'brand' | 'hq' | 'doctor' | 'segment' | 'zbm';

export const ENTITY_KIND_BY_COLUMN: Partial<Record<CsvColumn, EntityKind>> = {
  item_name: 'brand',
  hq_new:    'hq',
  dr_name:   'doctor',
  seg:       'segment',
  zbm:       'zbm',
};

export function isEntityColumn(col: string): boolean {
  return col in ENTITY_KIND_BY_COLUMN;
}

/**
 * Refresh the entity_values table from the live `data` rows. Idempotent —
 * uses INSERT … ON CONFLICT to update display_count.
 *
 * Pass an existing `Sql` (or a transaction handle from postgres-js).
 */
export async function refreshEntityIndex(sql: Sql): Promise<void> {
  // 1. Brand families (uppercase prefix of item_name; INACTIVE excluded).
  await sql`
    INSERT INTO entity_values (kind, value, display_count)
    SELECT 'brand',
           UPPER(substring(item_name from '^[A-Za-z][A-Za-z0-9]*')),
           COUNT(*)
    FROM data
    WHERE item_name IS NOT NULL
      AND item_name NOT LIKE '(INACTIVE)%'
      AND substring(item_name from '^[A-Za-z][A-Za-z0-9]*') <> ''
    GROUP BY UPPER(substring(item_name from '^[A-Za-z][A-Za-z0-9]*'))
    ON CONFLICT (kind, value) DO UPDATE SET display_count = EXCLUDED.display_count
  `;
  // 2. HQs.
  await sql`
    INSERT INTO entity_values (kind, value, display_count)
    SELECT 'hq', hq_new, COUNT(*)
    FROM data WHERE hq_new IS NOT NULL AND TRIM(hq_new) <> ''
    GROUP BY hq_new
    ON CONFLICT (kind, value) DO UPDATE SET display_count = EXCLUDED.display_count
  `;
  // 3. Doctors.
  await sql`
    INSERT INTO entity_values (kind, value, display_count)
    SELECT 'doctor', dr_name, COUNT(*)
    FROM data WHERE dr_name IS NOT NULL AND TRIM(dr_name) <> ''
    GROUP BY dr_name
    ON CONFLICT (kind, value) DO UPDATE SET display_count = EXCLUDED.display_count
  `;
  // 4. Segments.
  await sql`
    INSERT INTO entity_values (kind, value, display_count)
    SELECT 'segment', seg, COUNT(*)
    FROM data WHERE seg IS NOT NULL AND TRIM(seg) <> ''
    GROUP BY seg
    ON CONFLICT (kind, value) DO UPDATE SET display_count = EXCLUDED.display_count
  `;
  // 5. ZBMs.
  await sql`
    INSERT INTO entity_values (kind, value, display_count)
    SELECT 'zbm', zbm, COUNT(*)
    FROM data WHERE zbm IS NOT NULL AND TRIM(zbm) <> ''
    GROUP BY zbm
    ON CONFLICT (kind, value) DO UPDATE SET display_count = EXCLUDED.display_count
  `;
}
```

- [ ] **Step 7.4: Run test**

```bash
npm test -- entity-index.test
```

Expected: PASS.

- [ ] **Step 7.5: Hook into ingest route**

Modify `src/app/api/data/ingest/route.ts` to call `refreshEntityIndex` immediately after the typed-INSERT step, inside the same transaction. Find the existing transaction block and add:

```ts
import { refreshEntityIndex } from '@/lib/entity-index';

// … inside the transaction, after the INSERT INTO data … FROM data_raw …
await refreshEntityIndex(tx);
// … before the final TRUNCATE data_raw
```

(`tx` is the transaction handle as already used in the route — adjust to match the actual variable name in the file.)

- [ ] **Step 7.6: Write seed script**

Create `scripts/seed-entity-index.ts`:

```ts
#!/usr/bin/env node
// One-shot: populate entity_values from existing `data` rows, without re-uploading.

import 'dotenv/config';
import sql from '../src/lib/db';
import { refreshEntityIndex } from '../src/lib/entity-index';

async function main(): Promise<void> {
  console.log('Refreshing entity_values from data…');
  await refreshEntityIndex(sql as never);
  const counts = await sql<{ kind: string; n: string }[]>`
    SELECT kind, COUNT(*)::text AS n FROM entity_values GROUP BY kind ORDER BY kind
  `;
  for (const c of counts) console.log(`  ${c.kind}: ${c.n}`);
  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 7.7: Add npm script**

Modify `package.json`:

```json
"seed-entity-index": "tsx scripts/seed-entity-index.ts",
```

- [ ] **Step 7.8: Run seed**

```bash
npm run seed-entity-index
```

Expected output: counts for each kind. Brand should be ~50, hq ~30, doctor varies, segment ~7, zbm ~5.

- [ ] **Step 7.9: Verify pg_trgm fuzzy match works**

```bash
psql "$SUPABASE_DB_URL" -c "SELECT value, similarity(value, 'crockin') AS sim FROM entity_values WHERE kind='brand' AND value % 'crockin' ORDER BY sim DESC LIMIT 5;"
```

Expected: CROCIN (or whichever exists) appears with reasonable similarity score.

- [ ] **Step 7.10: Stage**

```bash
git add src/lib/entity-index.ts src/lib/entity-index.test.ts src/app/api/data/ingest/route.ts scripts/seed-entity-index.ts package.json
git status
```

---

## Task 8: Retrieval layer (`src/lib/retrieval.ts`)

**Files:**
- Create: `src/lib/retrieval.ts`
- Create: `src/lib/retrieval.test.ts`
- Create: `tests/fixtures/seed-rag.sql`
- Create: `src/lib/embeddings.test-mock.ts`

This task uses testcontainers Postgres + a deterministic embedding mock. Confirm Project 1's testcontainers setup is already wired before starting.

- [ ] **Step 8.1: Write the deterministic mock**

Create `src/lib/embeddings.test-mock.ts`:

```ts
// Deterministic, plausible-semantic 1536-dim embedding for tests.
// Token-overlap-based: shared tokens raise cosine similarity. Not realistic,
// but consistent across runs and good enough to exercise the dense leg.

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
  // L2 normalize so cosine == dot product, and unit-length stays sane.
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}
```

- [ ] **Step 8.2: Write seed fixture**

Create `tests/fixtures/seed-rag.sql` (just schema-side; embeddings are inserted from TS in the test setup using the mock):

```sql
-- Test fixtures: seeded golden examples and report anchors.
-- Embeddings are inserted from TS using mockEmbed(), not as literals.

INSERT INTO golden_examples
  (id, question, narrative, sql, chart_type, status, search_text)
VALUES
  ('ge_test_1', 'Top brands by primary sales', 'Returns top brands by net primary sales.',
   'SELECT brand_family, SUM(net_sales_) FROM data GROUP BY brand_family ORDER BY 2 DESC LIMIT 10',
   'hbar', 'verified', 'Top brands by primary sales'),
  ('ge_test_2', 'Monthly trend of secondary sales', 'Monthly secondary sales line chart.',
   'SELECT yyyymm, SUM(sales_valu) FROM data GROUP BY 1 ORDER BY 1',
   'line', 'verified', 'Monthly trend of secondary sales'),
  ('ge_test_3', 'HQ achievement vs target', 'HQ-wise primary achievement %.',
   'SELECT hq_new, ROUND(SUM(net_sales_)/NULLIF(SUM(tgt_val_p),0)*100,1) FROM data GROUP BY 1',
   'hbar', 'corrected', 'HQ achievement vs target'),
  ('ge_test_4', 'DOLO-650 sales last quarter', 'DOLO-650 SKU sales for the last quarter.',
   'SELECT yyyymm, SUM(net_sales_) FROM data WHERE item_name LIKE ''%DOLO-650%'' GROUP BY 1',
   'line', 'verified', 'DOLO-650 sales last quarter');

INSERT INTO report_anchors
  (report_id, name, group_name, anchor_question, source_sql, search_text)
VALUES
  ('r_test_a', 'Sales Analysis', 'Sales',
   'What are the primary sale, primary return, net primary by ZBM, ABM, HQ?',
   'SELECT zbm, abm, hq_new, SUM(net_sales_) AS net_primary FROM data GROUP BY 1,2,3',
   'sales analysis primary sale net primary by zbm abm hq'),
  ('r_test_b', 'Item Wise Returns', 'Item-Wise',
   'What are the return qty and return value by item?',
   'SELECT item_name, SUM(gri_qty), SUM(gri_sales) FROM data GROUP BY 1',
   'item wise returns return qty return value by item');

INSERT INTO entity_values (kind, value, display_count) VALUES
  ('brand', 'CROCIN', 1200),
  ('brand', 'DOLO',   980),
  ('brand', 'AZITHRO', 540),
  ('hq',    'DEL-04', 8500),
  ('hq',    'MUM-02', 7200),
  ('doctor','Dr. Sharma A', 320),
  ('segment','NEURO', 15000),
  ('zbm',   'ZBM-NORTH', 30000);
```

- [ ] **Step 8.3: Write the failing tests**

Create `src/lib/retrieval.test.ts`:

```ts
import { rrfFuse, retrieveGoldenExamples, retrieveReportAnchors, retrieveEntities, retrieveAll } from './retrieval';
import { mockEmbed } from './embeddings.test-mock';

// Replace embedQuery with mockEmbed for the duration of these tests.
jest.mock('./embeddings', () => {
  const actual = jest.requireActual('./embeddings');
  return {
    ...actual,
    embedQuery: (text: string) => Promise.resolve(require('./embeddings.test-mock').mockEmbed(text)),
    embedText:  (text: string) => Promise.resolve(require('./embeddings.test-mock').mockEmbed(text)),
  };
});

describe('rrfFuse', () => {
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
});

// Integration tests against testcontainers Postgres go below.
// They depend on the existing testcontainers Jest setup from Project 1.

describe('retrieve* (integration)', () => {
  // Setup: seed-rag.sql fixtures + insert mock embeddings.
  // Assumes globalSetup has applied 0001 + 0002 schemas.

  beforeAll(async () => {
    const sql = (await import('./db')).default;
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const seedSql = await fs.readFile(path.join(process.cwd(), 'tests/fixtures/seed-rag.sql'), 'utf8');
    await sql.unsafe(seedSql);

    // Update embeddings from mock for the seeded rows.
    const goldens = await sql`SELECT id, search_text FROM golden_examples`;
    for (const g of goldens) {
      const v = mockEmbed(g.search_text as string);
      await sql.unsafe(
        `UPDATE golden_examples SET embedding = $1::vector WHERE id = $2`,
        ['[' + v.join(',') + ']', g.id as string],
      );
    }
    const anchors = await sql`SELECT report_id, search_text FROM report_anchors`;
    for (const a of anchors) {
      const v = mockEmbed(a.search_text as string);
      await sql.unsafe(
        `UPDATE report_anchors SET embedding = $1::vector WHERE report_id = $2`,
        ['[' + v.join(',') + ']', a.report_id as string],
      );
    }
  });

  it('retrieveGoldenExamples returns ranked results', async () => {
    const r = await retrieveGoldenExamples('top brands sales', { k: 3 });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].id).toBe('ge_test_1');
  });

  it('retrieveGoldenExamples surfaces a corrected example via boost', async () => {
    const r = await retrieveGoldenExamples('hq achievement', { k: 3 });
    // ge_test_3 is corrected; should be the top match.
    expect(r[0].id).toBe('ge_test_3');
  });

  it('BM25 leg surfaces rare-token queries', async () => {
    const r = await retrieveGoldenExamples('DOLO-650', { k: 3 });
    expect(r.map(x => x.id)).toContain('ge_test_4');
  });

  it('retrieveReportAnchors returns ranked results', async () => {
    const r = await retrieveReportAnchors('returns by item', { k: 3 });
    expect(r[0].report_id).toBe('r_test_b');
  });

  it('retrieveEntities does pg_trgm fuzzy match', async () => {
    const r = await retrieveEntities('brand', 'crockin', 5);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].value).toBe('CROCIN');
  });

  it('retrieveAll returns embedding + golden + anchors', async () => {
    const r = await retrieveAll('top brands sales', { goldenK: 2, anchorsK: 1 });
    expect(r.embedding).toHaveLength(1536);
    expect(r.golden.length).toBeLessThanOrEqual(2);
    expect(r.anchors.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 8.4: Run tests to verify they fail**

```bash
npm test -- retrieval.test
```

Expected: FAIL with module not found.

- [ ] **Step 8.5: Write the retrieval layer**

Create `src/lib/retrieval.ts`:

```ts
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
import { embedQuery as _embedQuery, embedText as _embedText } from './embeddings';
import type { EntityKind } from './entity-index';

export const embedQuery = _embedQuery;
export const embedText  = _embedText;

const RRF_K = 60;
const STAGE_LIMIT = 30;

// ── Pure RRF (used by tests + as a sanity mirror of the SQL CTE) ──────

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
  rrf: number;
}

export async function retrieveGoldenExamples(
  question: string,
  opts: { k?: number; embedding?: number[] } = {},
): Promise<GoldenRow[]> {
  const k = opts.k ?? 5;
  const embedding = opts.embedding ?? await embedQuery(question);
  const vec = '[' + embedding.join(',') + ']';
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
      SELECT id, SUM(1.0 / (${RRF_K} + rnk)) AS rrf
      FROM (SELECT id, rnk FROM dense UNION ALL SELECT id, rnk FROM sparse) r
      GROUP BY id
    )
    SELECT g.id, g.question, g.narrative, g.sql, g.chart_type, g.status,
           g.correction_note, g.use_count, f.rrf
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
  const vec = '[' + embedding.join(',') + ']';
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
      SELECT report_id, SUM(1.0 / (${RRF_K} + rnk)) AS rrf
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
    SELECT value, similarity(value, $1) AS sim, display_count
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
```

- [ ] **Step 8.6: Run tests**

```bash
npm test -- retrieval.test
```

Expected: PASS for `rrfFuse` immediately. Integration tests require testcontainers — they should also pass once the Postgres test container is up.

- [ ] **Step 8.7: Stage**

```bash
git add src/lib/retrieval.ts src/lib/retrieval.test.ts src/lib/embeddings.test-mock.ts tests/fixtures/seed-rag.sql
git status
```

---

## Task 9: Tool surface rewrite (`src/lib/agent/tools.ts`)

**Files:**
- Modify: `src/lib/agent/tools.ts`
- Modify: `src/lib/agent/tools.test.ts`

- [ ] **Step 9.1: Update tools.ts**

Find these in `src/lib/agent/tools.ts`:

1. The `get_golden_examples` ToolDefinition (lines 64-76 area). REPLACE with a `retrieve` ToolDefinition.
2. The `getGoldenExamplesTool` function (~lines 191-210). REPLACE with `retrieveTool`.
3. The dispatch in `executeTool` (~line 121). UPDATE the case.
4. The `searchValues` function (~lines 144-158). UPGRADE to two-tier (entity_values then ILIKE).

Apply these edits:

```ts
// In TOOL_DEFINITIONS, replace the get_golden_examples block with:
{
  name: 'retrieve',
  description:
    'Retrieve additional team-verified Q→SQL pairs and/or expert ReportDef SQL templates that match a refined question. Top-K of each is already in the system prompt; call this when the upfront slice felt off-topic.',
  parameters: {
    type: 'object',
    properties: {
      query:  { type: 'string', description: 'natural-language question to match patterns against' },
      corpus: { type: 'string', description: 'one of: golden, reports, all (default: all)' },
      k:      { type: 'integer', description: 'how many examples (default 5; for corpus=all, k goldens + ceil(k*0.6) anchors)' },
    },
    required: ['query'],
  },
},
```

```ts
// At the top of the file, alongside the existing CSV_COLUMNS import:
import { isEntityColumn, ENTITY_KIND_BY_COLUMN } from '../entity-index';
import { retrieveGoldenExamples, retrieveReportAnchors, retrieveAll, retrieveEntities } from '../retrieval';
```

```ts
// REPLACE getGoldenExamplesTool with:
async function retrieveTool(args: Record<string, unknown>, _ctx: ToolContext): Promise<unknown> {
  try {
    const query = String(args.query ?? '').trim();
    const corpus = String(args.corpus ?? 'all') as 'golden' | 'reports' | 'all';
    const k = clampInt(args.k, 1, 10, 5);
    if (!query) return { error: 'query required' };
    if (corpus === 'golden') {
      const examples = await retrieveGoldenExamples(query, { k });
      return { golden: examples.map(e => ({
        question: e.question, sql: e.sql, status: e.status,
        correction_note: e.correction_note, narrative: e.narrative,
      })) };
    }
    if (corpus === 'reports') {
      const anchors = await retrieveReportAnchors(query, { k });
      return { anchors: anchors.map(a => ({
        name: a.name, group: a.group_name,
        anchor_question: a.anchor_question, sql: a.source_sql,
      })) };
    }
    // corpus === 'all'
    const r = await retrieveAll(query, { goldenK: k, anchorsK: Math.ceil(k * 0.6) });
    return {
      golden: r.golden.map(e => ({
        question: e.question, sql: e.sql, status: e.status,
        correction_note: e.correction_note, narrative: e.narrative,
      })),
      anchors: r.anchors.map(a => ({
        name: a.name, group: a.group_name,
        anchor_question: a.anchor_question, sql: a.source_sql,
      })),
    };
  } catch (e) {
    return { error: String(e) };
  }
}
```

```ts
// In executeTool, replace the get_golden_examples case with:
case 'retrieve': return retrieveTool(call.args, ctx);
```

```ts
// REPLACE searchValues with:
async function searchValues(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  try {
    const column = requireColumn(args.column);
    const pattern = String(args.pattern ?? '').trim();
    if (!pattern) return { error: 'pattern required' };
    const limit = clampInt(args.limit, 1, 100, 20);

    // Tier 1: pg_trgm over entity_values, if column is mapped.
    if (isEntityColumn(column)) {
      const kind = ENTITY_KIND_BY_COLUMN[column as keyof typeof ENTITY_KIND_BY_COLUMN]!;
      const matches = await retrieveEntities(kind, pattern, limit);
      if (matches.length > 0) {
        return { values: matches.map(m => m.value), rowCount: matches.length, source: 'entity_index' };
      }
    }

    // Tier 2: ILIKE on data — fallback or non-mapped columns.
    const safePattern = pattern.replace(/'/g, "''");
    const sql = `SELECT DISTINCT ${column} AS value FROM data WHERE ${column} ILIKE '%${safePattern}%' AND ${column} IS NOT NULL AND TRIM(${column}) <> '' ORDER BY ${column} LIMIT ${limit}`;
    const result = await ctx.db.runTrusted(sql);
    if (result.error) return { error: result.error };
    return { values: result.rows.map(r => r.value), rowCount: result.rowCount, source: 'data_ilike' };
  } catch (e) {
    return { error: String(e) };
  }
}
```

Also remove the unused `extractTags` import (no longer called from this file).

- [ ] **Step 9.2: Update tools.test.ts**

Replace the `get_golden_examples` test with retrieve-tool tests. Add a search_values entity-index test. Sample additions:

```ts
// In src/lib/agent/tools.test.ts, REPLACE the get_golden_examples describe block with:
describe('retrieve tool', () => {
  it('rejects missing query', async () => {
    const r = await executeTool({ id: 't1', name: 'retrieve', args: {} } as never, mockCtx);
    expect((r as { error: string }).error).toMatch(/query required/i);
  });
  it('default corpus is all → returns golden + anchors', async () => {
    // mockCtx will need to mock retrieveAll; or seed testcontainers fixtures.
    // For unit-level: jest.mock('../retrieval').
  });
});

// In the search_values describe block, ADD:
it('falls back to ILIKE when entity_index has no match', async () => {
  // mock retrieveEntities to return empty; mock db.runTrusted to return rows.
  // assert source: 'data_ilike' in result.
});
```

(Adjust to match the actual mocking style in the existing test file.)

- [ ] **Step 9.3: Run tests**

```bash
npm test -- tools.test
```

Expected: PASS.

- [ ] **Step 9.4: Stage**

```bash
git add src/lib/agent/tools.ts src/lib/agent/tools.test.ts
git status
```

---

## Task 10: Loop integration (`src/lib/agent/loop.ts`)

**Files:**
- Modify: `src/lib/agent/loop.ts`
- Modify: `src/lib/agent/loop.test.ts`

- [ ] **Step 10.1: Update loop.ts**

In `src/lib/agent/loop.ts`:

1. Replace this:
```ts
import { extractTags } from '../golden-examples';
// …
const tags = extractTags(userMessage, deps.db.dictionary);
const goldenExamples = await deps.goldenStore.topK(tags, 5);
```

with:

```ts
import { retrieveAll } from '../retrieval';
// …
const { golden: goldenExamples, anchors } = await retrieveAll(userMessage, {
  goldenK: 5, anchorsK: 3,
});
```

2. Update the `buildSystemPrompt({ ... })` call to include the new `anchors`:

```ts
const systemPrompt = buildSystemPrompt({
  dictionary: deps.db.dictionary,
  goldenExamples,
  anchors,
  history,
});
```

3. Remove the `goldenStore` field from `RunAgentDeps` if no other call site needs it. Confirm by grepping `goldenStore` references in this file. Keep it if `tools.ts` or anything else still uses it.

- [ ] **Step 10.2: Update loop.test.ts**

Replace mock target from `goldenStore.topK` to `retrieveAll`:

```ts
// At top of test file:
jest.mock('../retrieval', () => ({
  retrieveAll: jest.fn(async () => ({
    embedding: new Array(1536).fill(0),
    golden: [],
    anchors: [],
  })),
  retrieveGoldenExamples: jest.fn(async () => []),
  retrieveReportAnchors: jest.fn(async () => []),
}));
```

Existing tool-loop assertions stay unchanged.

- [ ] **Step 10.3: Run test**

```bash
npm test -- loop.test
```

Expected: PASS.

- [ ] **Step 10.4: Stage**

```bash
git add src/lib/agent/loop.ts src/lib/agent/loop.test.ts
git status
```

---

## Task 11: System prompt assembly (`src/lib/agent/prompt.ts`)

**Files:**
- Modify: `src/lib/agent/prompt.ts`
- Modify: `src/lib/agent/prompt.test.ts`

- [ ] **Step 11.1: Refactor prompt.ts**

Apply the following edits:

1. Add new imports at top:

```ts
import { COLUMN_DESCRIPTIONS } from '../column-descriptions';
import { POWER_PROMPT } from './power-prompt';
import type { AnchorRow } from '../retrieval';
```

2. **Delete** the constants `FORMULA_DICTIONARY` (lines 9-35) and `BEHAVIORAL_RULES` (lines 37-68). Their content is now in `power-prompt.md`.

3. Add a new helper that renders the column dictionary block:

```ts
function summarizeColumnDictionary(): string {
  const lines = (Object.keys(COLUMN_DESCRIPTIONS) as Array<keyof typeof COLUMN_DESCRIPTIONS>)
    .map(col => `- \`${col}\`: ${COLUMN_DESCRIPTIONS[col]}`)
    .join('\n');
  return `COLUMN DICTIONARY (full schema with semantics — cross-check before writing SQL):\n${lines}`;
}
```

4. Add a new helper that renders the retrieved anchors block:

```ts
function summarizeAnchors(anchors: AnchorRow[]): string {
  if (anchors.length === 0) return 'REPORT TEMPLATES: (none retrieved)';
  const lines = anchors.map((a, i) =>
    `[Template ${i + 1}] ${a.name} (${a.group_name})\n  Anchor: ${a.anchor_question}\n  SQL: ${a.source_sql}`,
  ).join('\n\n');
  return `REPORT TEMPLATES (expert-authored SQL — adapt these):\n\n${lines}`;
}
```

5. Update `BuildPromptInput`:

```ts
export interface BuildPromptInput {
  dictionary: DataDictionary;
  goldenExamples: GoldenExample[];
  anchors: AnchorRow[];          // NEW
  history: ConversationTurn[];
}
```

6. Rewrite `buildSystemPrompt`:

```ts
export function buildSystemPrompt(input: BuildPromptInput): string {
  const { dictionary, goldenExamples, anchors, history } = input;
  const schemaLine = `SCHEMA: Single table 'data' with columns: ${CSV_COLUMNS.join(', ')}`;
  return [
    'You are a senior pharma-sales data analyst for Shomed Remedies MIS.',
    'Your job is to answer the user\'s question ACCURATELY using the Postgres `data` table.',
    'Be decisive. If ambiguous, ask ONE targeted question instead of guessing.',
    '',
    schemaLine,
    '',
    summarizeColumnDictionary(),
    '',
    POWER_PROMPT,
    '',
    summarizeDictionary(dictionary),
    '',
    summarizeGoldenExamples(goldenExamples),
    '',
    summarizeAnchors(anchors),
    '',
    summarizeHistory(history),
    '',
    OUTPUT_CONTRACT,
  ].join('\n');
}
```

7. The `OUTPUT_CONTRACT` constant stays. Update its `respond_with_clarification` description to mention the `retrieve` tool exists if it does not already (cosmetic).

- [ ] **Step 11.2: Update prompt.test.ts**

Add assertions that the new sections appear:

```ts
it('includes the full column dictionary', () => {
  const out = buildSystemPrompt({
    dictionary: { /* … minimal … */ } as DataDictionary,
    goldenExamples: [],
    anchors: [],
    history: [],
  });
  expect(out).toMatch(/COLUMN DICTIONARY/);
  expect(out).toMatch(/`net_sales_`/);
  expect(out).toMatch(/`gri_sales`/);
});

it('includes the power prompt content', () => {
  const out = buildSystemPrompt({ /* … */ } as never);
  expect(out).toMatch(/DECISION FLOW/);
  expect(out).toMatch(/ANTI-HALLUCINATION TRAPS/);
});

it('includes retrieved anchors when provided', () => {
  const out = buildSystemPrompt({
    dictionary: {} as DataDictionary,
    goldenExamples: [],
    anchors: [{
      report_id: 'r_x', name: 'Foo', group_name: 'Sales',
      anchor_question: 'foo?', source_sql: 'SELECT 1', rrf: 0.5,
    }],
    history: [],
  });
  expect(out).toMatch(/REPORT TEMPLATES/);
  expect(out).toMatch(/Foo/);
});
```

(Update existing tests that previously asserted `BEHAVIORAL_RULES` or `FORMULA_DICTIONARY` — those constants no longer exist; assert against `POWER_PROMPT` content instead.)

- [ ] **Step 11.3: Run test**

```bash
npm test -- prompt.test
```

Expected: PASS.

- [ ] **Step 11.4: Stage**

```bash
git add src/lib/agent/prompt.ts src/lib/agent/prompt.test.ts
git status
```

---

## Task 12: Golden store rewrite (`src/lib/golden-examples.ts`)

**Files:**
- Modify: `src/lib/golden-examples.ts`
- Modify: `src/lib/golden-examples.test.ts`

- [ ] **Step 12.1: Rewrite golden-examples.ts**

The new file is much smaller. Keep these exports:
- `GoldenExample`, `GoldenStatus`, `NewGoldenExampleInput` types
- `normalizeSql`, `findDuplicate`, `generateExampleId` pure helpers
- `createStore(provider)` and `GoldenExamplesStore` type
- A new Postgres provider

Delete:
- `vercelBlobGoldenProvider`, `BLOB_PATH`, `EXPIRY_MONTHS`
- `METRIC_KEYWORDS`, `PERIOD_KEYWORDS`, `BREAKDOWN_KEYWORDS`
- `extractTags`, `rankExamples`, `pruneExpired`
- The `topK(tags, k)` method on the store (replaced by `retrieveGoldenExamples` directly)

Sample new file:

```ts
// Golden-examples store. Team-verified Q→SQL pairs persisted in Postgres.
// Embedding happens on `add()`; retrieval lives in src/lib/retrieval.ts.

import sql from './db';
import { embedText, sha256 } from './embeddings';

export type GoldenStatus = 'verified' | 'corrected';

export interface GoldenExample {
  id: string;
  question: string;
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

interface Row extends GoldenExample {}

const goldenStore = {
  async list(): Promise<GoldenExample[]> {
    const rows = await sql<Row[]>`
      SELECT id, question, narrative, sql, chart_type, assumptions, status,
             correction_note, created_at::text, verified_at::text, use_count
      FROM golden_examples
      ORDER BY verified_at DESC
    `;
    return rows.map(r => ({ ...r }));
  },

  async add(input: NewGoldenExampleInput): Promise<GoldenExample> {
    // Dedup: same question + same SQL → bump use_count.
    const all = await this.list();
    const dup = findDuplicate(all, input.question, input.sql);
    if (dup) {
      await sql`
        UPDATE golden_examples
           SET use_count = use_count + 1, verified_at = now()
         WHERE id = ${dup.id}
      `;
      return { ...dup, use_count: dup.use_count + 1, verified_at: new Date().toISOString() };
    }

    const id = generateExampleId();
    const search_text = input.question;
    const embedding = await embedText(search_text);
    const vec = '[' + embedding.join(',') + ']';
    await sql`
      INSERT INTO golden_examples
        (id, question, narrative, sql, chart_type, assumptions, status,
         correction_note, search_text, embedding, embedding_sha)
      VALUES
        (${id}, ${input.question}, ${input.narrative}, ${input.sql}, ${input.chart_type},
         ${input.assumptions ?? []}, ${input.status ?? 'verified'},
         ${input.correction_note ?? null}, ${search_text},
         ${sql.unsafe(`'${vec}'::vector`)}, ${sha256(search_text)})
    `;
    const inserted = await sql<Row[]>`
      SELECT id, question, narrative, sql, chart_type, assumptions, status,
             correction_note, created_at::text, verified_at::text, use_count
      FROM golden_examples WHERE id = ${id}
    `;
    return inserted[0];
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
```

- [ ] **Step 12.2: Rewrite golden-examples.test.ts**

Drop the deleted-helpers tests (extractTags, rankExamples, pruneExpired, METRIC_KEYWORDS). Keep dedup, normalizeSql, generateExampleId. Add testcontainers-based add/list/remove tests.

- [ ] **Step 12.3: Run tests**

```bash
npm test -- golden-examples.test
```

Expected: PASS.

- [ ] **Step 12.4: Stage**

```bash
git add src/lib/golden-examples.ts src/lib/golden-examples.test.ts
git status
```

---

## Task 13: Wire the new golden-examples API route + chat callsites

**Files:**
- Modify: `src/app/api/golden-examples/route.ts` (and any related routes)
- Modify: `src/app/api/chat/route.ts` (drop `goldenStore` from deps if unused)

- [ ] **Step 13.1: Update API routes**

Find any imports of `vercelBlobGoldenProvider`, `createStore`, `extractTags` in `src/app/api/**`. Replace usages:

```ts
// Before:
import { createStore, vercelBlobGoldenProvider } from '@/lib/golden-examples';
const store = createStore(vercelBlobGoldenProvider);

// After:
import goldenStore from '@/lib/golden-examples';
// use goldenStore directly
```

- [ ] **Step 13.2: Run all tests**

```bash
npm test
```

Expected: full test suite passes.

- [ ] **Step 13.3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 13.4: Stage**

```bash
git add src/app/api/golden-examples src/app/api/chat
git status
```

---

## Task 14: Local manual smoke test

**Files:**
- (no edits) — runs the dev server and exercises the chat path manually

- [ ] **Step 14.1: Start dev server (user runs)**

User must run this themselves; agent should NOT kill/restart per project brief:

```bash
npm run dev
```

- [ ] **Step 14.2: Exercise the chat**

Open http://localhost:3000/chat and ask three questions exercising different paths:

1. "Top 5 brands by net primary sales for FY 2025-26" — should return an answer card with a table/chart.
2. "Crockin sales last quarter" (intentional misspelling) — agent should call `search_values`, get pg_trgm fuzzy match to CROCIN, ask for clarification, OR proceed with the family.
3. "What are doctor visits doing?" (vague) — agent should call `respond_with_clarification`.

Record any failures. Failed cases either need a power-prompt trap addition or a retrieval-bench expansion (Task 15).

- [ ] **Step 14.3: Verify SSE trace shows new tool**

In the streamed agent trace, confirm calls to `retrieve` appear (not `get_golden_examples`).

---

## Task 15: Retrieval quality bench

**Files:**
- Create: `tests/fixtures/retrieval-bench.json`
- Create: `scripts/retrieval-bench.ts`
- Modify: `package.json`

- [ ] **Step 15.1: Author the bench fixtures**

Create `tests/fixtures/retrieval-bench.json` with ~10 starter cases. The expected_top_3 must reference real `report_id` or `golden_examples.id` values from the live DB after Task 5/6 ran.

```json
[
  {
    "question": "Top HQs by primary achievement",
    "expect_in_top_3_anchors": ["r13", "r17"]
  },
  {
    "question": "Returning expired stock breakdown",
    "expect_in_top_3_anchors": ["r3"]
  },
  {
    "question": "Item-wise monthly trend",
    "expect_in_top_3_anchors": ["r9"]
  },
  {
    "question": "Patient counts PAP DCPP",
    "expect_in_top_3_anchors": ["r21", "r23"]
  },
  {
    "question": "Stock closing value by HQ",
    "expect_in_top_3_anchors": ["r20"]
  }
]
```

- [ ] **Step 15.2: Write the bench script**

Create `scripts/retrieval-bench.ts`:

```ts
#!/usr/bin/env node
import 'dotenv/config';
import sql from '../src/lib/db';
import { retrieveAll } from '../src/lib/retrieval';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Case {
  question: string;
  expect_in_top_3_anchors?: string[];
  expect_in_top_3_goldens?: string[];
}

async function main(): Promise<void> {
  const cases: Case[] = JSON.parse(
    readFileSync(join(process.cwd(), 'tests/fixtures/retrieval-bench.json'), 'utf8'),
  );
  let pass = 0, fail = 0;
  for (const c of cases) {
    const r = await retrieveAll(c.question, { goldenK: 5, anchorsK: 5 });
    const topAnchors = r.anchors.map(a => a.report_id);
    const topGoldens = r.golden.map(g => g.id);
    const missing: string[] = [];
    if (c.expect_in_top_3_anchors) {
      for (const id of c.expect_in_top_3_anchors) {
        if (!topAnchors.slice(0, 3).includes(id)) missing.push(`anchor:${id}`);
      }
    }
    if (c.expect_in_top_3_goldens) {
      for (const id of c.expect_in_top_3_goldens) {
        if (!topGoldens.slice(0, 3).includes(id)) missing.push(`golden:${id}`);
      }
    }
    if (missing.length === 0) {
      pass++;
      console.log(`  PASS  "${c.question}" → anchors=${topAnchors.slice(0, 3).join(',')}`);
    } else {
      fail++;
      console.log(`  FAIL  "${c.question}" missing=${missing.join(',')} got=anchors=${topAnchors.slice(0, 3).join(',')}, goldens=${topGoldens.slice(0, 3).join(',')}`);
    }
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  await sql.end();
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 15.3: Add npm script**

`package.json`:

```json
"retrieval-bench": "tsx scripts/retrieval-bench.ts",
```

- [ ] **Step 15.4: Run the bench**

```bash
npm run retrieval-bench
```

Expected: ≥80% pass rate. Failing cases:
- If anchor question generator phrasing is off → add `/** @anchor … */` JSDoc to the offending ReportDef and re-run `npm run reindex-anchors`.
- If a question really doesn't have a good match → remove the case (not all questions need a perfect template match).

- [ ] **Step 15.5: Stage**

```bash
git add tests/fixtures/retrieval-bench.json scripts/retrieval-bench.ts package.json
git status
```

---

## Final verification

- [ ] **Step F.1: Run full test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step F.2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step F.3: Lint**

```bash
npm run lint
```

Expected: 0 errors.

- [ ] **Step F.4: Manual chat smoke (Task 14 redux)**

Confirm again with three questions in the live UI:
- A clear question — answer card returns.
- A misspelled-entity question — `search_values` resolves via pg_trgm.
- An ambiguous question — agent asks for clarification.

- [ ] **Step F.5: Final stage summary**

```bash
git status
git diff --stat HEAD
```

Hand the staged set to the user for commit; agent does not commit.

---

## Phase 5 (deferred 30 days)

After 30 days post-cutover, run cleanup:

- Delete `golden_examples.json.archived` blob:
  ```bash
  npx -y tsx -e "
    import('@vercel/blob').then(async ({ list, del }) => {
      const { blobs } = await list({ prefix: 'golden_examples.json.archived' });
      for (const b of blobs) await del(b.url);
      console.log('Deleted', blobs.length, 'archived blob(s)');
    });
  "
  ```
- Optional follow-up: enable Gemini explicit prompt caching for the static prefix (column dictionary + power prompt). Separate small project.

---

## Summary of what changed

**New files (15):** `0002_rag.sql`, `embeddings.ts`/`.test.ts`, `column-descriptions.ts`/`.test.ts`, `power-prompt.md`/`.ts`/`.test.ts`, `anchor-generator.ts`/`.test.ts`, `retrieval.ts`/`.test.ts`, `entity-index.ts`/`.test.ts`, `embeddings.test-mock.ts`, `seed-rag.sql`, `retrieval-bench.json`, `reindex-anchors.ts`, `migrate-golden-examples.ts`, `seed-entity-index.ts`, `retrieval-bench.ts`.

**Modified (~10):** `golden-examples.ts`/`.test.ts`, `prompt.ts`/`.test.ts`, `loop.ts`/`.test.ts`, `tools.ts`/`.test.ts`, `api/data/ingest/route.ts`, `api/golden-examples/route.ts`, `api/chat/route.ts`, `package.json`.

**Deleted code:** `extractTags`/`rankExamples`/`pruneExpired`, `vercelBlobGoldenProvider`, `BEHAVIORAL_RULES`/`FORMULA_DICTIONARY` constants. (Whole files preserved; their internals shrink.)

**Net token change to system prompt:** +3,000 (column dictionary +2,250; anchors +600; power prompt +200 net of removed BEHAVIORAL_RULES/FORMULA_DICTIONARY).
