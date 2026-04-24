# Smart Chat Agent — Design Spec

**Date:** 2026-04-24
**Project:** Shomed Remedies MIS
**Author:** Prateek Kumar (with AI collaborator)
**Status:** Approved by user, ready for implementation plan

**Constraints:** No file or code deletion during implementation (user policy). Old routes are deprecated, not removed.

## 1. Problem

The existing "Chat with your data" feature was tested by the team and ridiculed.
Concrete failure modes observed:

- **Wrong SQL / wrong numbers** — model writes queries blind, uses wrong columns or formulas.
- **Amnesia between turns** — every question is treated independently; follow-ups like
  "now filter to NEURO" don't work.
- **Domain jargon misunderstood** — natural language like "Shovert", "PAP", "MP zone" is
  not mapped to the right columns / item names.
- **No narrative, wrong chart** — results dumped as a table with a hardcoded bar chart that
  is often visually wrong for the data shape.
- **Hallucinated values** — brand / HQ / FY values that don't exist in the data.
- **No error recovery** — when SQL fails, the user sees a raw error; agent doesn't self-correct.

Root cause: the current flow is a single `NL → SQL → execute → show table` pipeline with no
grounding, no memory, no tool use, no self-correction. It is architecturally incapable of
fixing the failures above.

## 2. Goals

Rebuild the chat as an **agent loop** that is:

1. **Accurate** — grounded in real values from the data, self-corrects SQL errors, uses verified
   examples from prior corrections.
2. **Conversational** — carries a 6-turn memory; follow-ups reference prior scope.
3. **Transparent** — streams tool calls live; shows SQL + assumptions; easy to inspect and correct.
4. **Human-in-the-loop** — every answer can be ✓ Verified, ✎ Corrected, or 🚩 Flagged.
5. **Measurably smarter over time** — verified Q→SQL pairs persist as "golden examples" and are
   retrieved for similar future questions.

Non-goals (v1):

- Auth, multi-user, per-user learning.
- Cross-session conversation resumption (sessionStorage only).
- Migrating data off Vercel Blob / out of DuckDB.
- Embedding-based retrieval (tag-overlap first; upgrade later if needed).
- Any writes to the data (SELECT-only agent).

## 3. Core Decisions

| Decision | Choice | Reason |
|---|---|---|
| Primary model | Gemini 2.5 Pro with function calling | User's existing key; acceptable tool-use quality |
| Fallback models | Gemini 2.0 Flash → Groq Llama 3.3 70B | Graceful degradation when primary fails |
| SQL execution | Server-side DuckDB (native `@duckdb/node-api`) | Clean agent-loop tool calls; no browser round-trips |
| Browser DuckDB-WASM | Kept unchanged for dashboard / reports / upload | Zero regression on existing surfaces |
| Interaction model | Direct-answer with aggressive clarification when uncertain | Speed + safety |
| HITL | ✓ Verified / ✎ Correct / 🚩 Flag on every agent answer | User requirement: team-educated review |
| Learning store | `golden_examples.json` on Vercel Blob | Persists across conversations; retrieved by tag overlap |
| Auth | None | Single-user SaaS |
| Chat persistence | sessionStorage (fresh on new browser session) | User requirement |
| Streaming | Server-Sent Events with live tool-call trace | Perceived speed; transparency for correction |

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER                                                      │
│  ┌─────────────────┐        ┌──────────────────────────────┐ │
│  │ /chat           │        │ /dashboard, /reports,        │ │
│  │ (rewritten)     │        │ /my-reports, /upload         │ │
│  │ - sessionStorage│        │ (unchanged — browser DuckDB) │ │
│  │ - SSE client    │        │                              │ │
│  │ - HITL UI       │        │                              │ │
│  └────────┬────────┘        └──────────────────────────────┘ │
└───────────┼──────────────────────────────────────────────────┘
            │ POST /api/chat (SSE stream)
            ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVER (Vercel Node function, runtime: 'nodejs')             │
│                                                               │
│   Chat Agent  ─┬─ tools: search_values, list_distinct_values, │
│                │         run_sql, get_golden_examples          │
│                │                                               │
│                ├─ memory: last 6 turns from request body       │
│                │                                               │
│                └─ retrieval: golden_examples.json (tag match) │
│                                                               │
│   @duckdb/node-api singleton (module-scoped)                  │
│     ↑ loads accumulated.csv → /tmp → CREATE TABLE data        │
│     ↑ invalidated on dataVersion bump                         │
└───────────────────────────┬──────────────────────────────────┘
                            │
                   ┌────────┴──────────────────────────┐
                   │ Vercel Blob                         │
                   │  - accumulated.csv                  │
                   │  - saved_queries.json   (existing)  │
                   │  - data_dictionary.json (NEW)       │
                   │  - data_meta.json       (NEW)       │
                   │  - golden_examples.json (NEW)       │
                   └─────────────────────────────────────┘
```

## 5. The Agent Loop

Per user turn, the server:

1. Builds system prompt: static schema + formula dictionary + data-dictionary summary +
   top-K golden examples matching the question tags + last 6 turns + behavioral rules.
2. Calls Gemini 2.5 Pro with the four tools registered. Up to N=8 iterations.
3. Each iteration, the model returns one of: a tool call, a clarifying question, or a final answer.
4. Tool calls execute against the server-side DuckDB or the golden-examples store.
5. Tool results are fed back to the model in the next iteration.
6. Streams SSE events to the browser throughout: `thinking`, `tool_call`, `tool_result`,
   `clarify`, `final`.

### 5.1 Tool surface

```ts
search_values(column: string, pattern: string, limit?: number)
// Fuzzy match. "Shovert" → ["SHOVERT-8 TAB 10S", "SHOVERT-16 TAB 10S", ...]

list_distinct_values(column: string, limit?: number)
// Enumerate a small categorical column when search_values yields nothing.

run_sql(sql: string)
// Execute SELECT against `data`. Returns { rows, rowCount, columns, error? }.
// Validated: SELECT-only, no non-data tables, auto-LIMIT 100K, 10s timeout.

get_golden_examples(question: string, k?: number)
// Return top-K verified Q→SQL patterns matched by tag overlap + recency + use_count.
```

### 5.2 System-prompt behavioral rules

- If any term is ambiguous (metric, period, brand, scope), ask a clarifying question. One at a time.
- Before referencing any named entity in SQL, call `search_values` first.
- Exclude inactive items by default (`item_name NOT LIKE '(INACTIVE)%'`).
- Always `SELECT` with explicit columns. No `SELECT *`.
- Wrap aggregates: `ROUND(..., 2)` for money, `ROUND(..., 1)` for percentages.
- If `search_values` returns zero results for a user-mentioned entity, ask the user — do not guess.

### 5.3 Structured final output

The final turn must conform to:

```json
{
  "kind": "answer" | "clarify",
  "clarify_question": "string (only when kind=clarify)",
  "clarify_choices": ["string", ...],
  "narrative": "one-paragraph English answer",
  "headline": "one-line takeaway for KPI display",
  "sql": "the SQL that produced this result",
  "chart_type": "kpi|line|bar|hbar|pie|stacked_bar|table_only",
  "chart_hints": { "x": "...", "y": "...", "series": "..." },
  "assumptions": ["filter: fy = '2025-2026'", "..."],
  "follow_ups": ["Break down by HQ?", "Compare to FY 2024-25?", "..."]
}
```

Enforced via Gemini's response-schema feature. Frontend renders deterministically.

### 5.4 Conversation history window

Last 6 turns (3 user + 3 agent) included verbatim with role, content, and verified SQL.
Corrections are shown as `[USER CORRECTION: "..."]` so the model sees prior mistakes.
Older turns are summarized into a single context line to preserve scope without bloating tokens.

### 5.5 Model fallback policy

- Iteration 1 fails on Gemini 2.5 Pro → restart whole loop on Gemini 2.0 Flash.
- Gemini 2.0 Flash fails → restart on Groq Llama 3.3 70B with manual tool-call parsing
  (Groq's function-calling is weaker; reserved as last resort).
- No mid-loop model switching.

## 6. Grounding — Two Stores

### 6.1 Store A: Data dictionary (in-memory on server singleton)

Computed by the server DuckDB singleton on every CSV load (cold start + reload).
Cached in module scope; no separate blob file needed.

**Update during implementation:** original design stored `data_dictionary.json` on Vercel Blob
regenerated at upload time. Simplified to in-memory because (a) the server already loads the CSV
on cold start, so dictionary computation is free; (b) the upload flow uses client-direct Vercel
Blob upload via `/api/blob/upload-token` with `onUploadCompleted` as the only server hook — harder
to make reliable than inline computation; (c) removes a failure mode (dictionary blob missing).
A compact summary is still injected into the system prompt on every turn.

```json
{
  "generated_at": "ISO",
  "row_count": 129117,
  "fy_range": ["2022-2023", ...],
  "segments": ["ABX", "GASTRO", "GYNAE", "NEURO", "ORTHO", "WELLNESS"],
  "zbms": [...],
  "hqs": [...],
  "brand_families": {
    "SHOVERT": ["SHOVERT-8 TAB 10S", "SHOVERT-16 TAB 10S", "SHOVERT-30 TAB 10S"],
    ...
  },
  "doctors_top_200": [...],
  "latest_period": "202512",
  "fiscal_year_boundary": "April"
}
```

Brand families grouped by prefix/stem heuristic so "Shovert" maps to all SKUs without a tool call.
A compact summary (top-50 brand families + full HQ/seg/zbm/fy lists) is injected into the system
prompt on every turn.

### 6.2 Store B: Golden examples (runtime, grown by HITL)

`golden_examples.json` in Vercel Blob. Grows as the team verifies and corrects answers.

```json
{
  "id": "ge_2026-04-24_a3f7",
  "question": "How's Shovert doing this year?",
  "question_tags": ["brand:SHOVERT", "metric:net_primary", "period:current_fy"],
  "narrative": "...",
  "sql": "...",
  "chart_type": "line",
  "assumptions": [...],
  "status": "verified | corrected",
  "correction_note": "Team corrected: use net_sales_ not sales_valu",
  "created_at": "ISO",
  "verified_at": "ISO",
  "use_count": 7
}
```

**Creation triggers:**

| Trigger | Effect |
|---|---|
| ✓ Verified click | Save with `status: "verified"` |
| ✎ Correct → agent replies → ✓ Verified on correction | Save with `status: "corrected"` and `correction_note` |
| 🚩 Flag | No save; UI-only rejection |
| Answer matches existing example byte-for-byte | Increment `use_count` on matched record |

**Retrieval (called by `get_golden_examples` tool):**

1. Quick tag extraction from incoming question (one Gemini Flash call, cached per session).
2. Score each stored example by shared-tag count + recency + `use_count`.
3. Return top-K (default K=5) injected into the prompt with any `correction_note` attached.

**Why tag-overlap, not embeddings:** For <500 examples (realistic upper bound at single-user scale),
tag-overlap is faster, free, debuggable, and good enough. Upgrade path to embeddings is clear if
retrieval quality slips.

**Anti-collapse safety:**

- A `corrected` record outranks a `verified` record with identical tags.
- `/learned-patterns` admin page exposes un-verify and delete actions.
- Examples auto-expire after 18 months unless re-verified (pharma data shifts year over year).

## 7. Frontend — `/chat` rewrite

### 7.1 Answer-card anatomy (agent turn)

Top-to-bottom:

1. KPI row (if `chart_type === "kpi"`).
2. Headline (one-line, bold).
3. Narrative (one paragraph).
4. Chart (rendered per `chart_type` + `chart_hints`).
5. Table (scrollable, max-h ~320px).
6. Assumptions (gray caption).
7. HITL bar: `✓ Verified`, `✎ Correct`, `🚩 Flag`, `⋯ Details`.
8. Follow-up chips (click to ask as next turn).
9. Details accordion (SQL + frozen tool-call trace + Save-as-report).

### 7.2 HITL behaviors (precise)

- **✓ Verified** → POST `/api/golden-examples`, stamp message as Verified, button toggles to un-verify.
- **✎ Correct** → inline textarea; submit triggers `/api/chat` with `{type: "correction", original_message_id, correction_text}`; new answer appears **below** original with "Superseded by correction" banner on the old one; if corrected answer is then Verified, saved with `status: "corrected"`.
- **🚩 Flag** → client-only; red "Flagged" banner; nothing stored.

### 7.3 Clarification UI

When agent emits `kind: "clarify"`:

- No chart, no table, no HITL bar.
- Shows the clarifying question as a highlighted card with chip buttons for `clarify_choices`.
- Clicking a chip sends it as the next user message; free-text composer still available.

### 7.4 Streaming trace UI

While SSE events stream, the in-progress agent message shows a live trace:

```
🧠 thinking · Looking up Shovert in brand list...
🔧 search_values(item_name, "Shovert") → 3 results
🧠 thinking · Querying FY 2025-26 monthly...
🔧 run_sql → 12 rows
```

On `final`, trace collapses into `⋯ Details` and the answer card renders above.
A Stop button aborts the stream; half-formed state is discarded.

### 7.5 Session persistence

```
sessionStorage key: "somed_chat_v1"
value: { messages, session_started_at, data_version }
```

- Write on every `messages` state change, debounced 300ms.
- Hydrate on mount.
- If stored `data_version` < current `localStorage.dataVersion` → stale banner with Clear CTA.

### 7.6 `/learned-patterns` admin page

- List of golden examples, newest first.
- Per-row: question, tags, SQL preview, status, `use_count`, verified/corrected timestamp.
- Actions: Un-verify, Delete.
- Search by question or tag; sort by recent / most-used; filter by status.
- Added to `Sidebar.tsx` nav.

### 7.7 Files touched — frontend

```
src/app/chat/page.tsx                        FULL REWRITE
src/app/learned-patterns/page.tsx            NEW
src/components/chat/AnswerCard.tsx           NEW
src/components/chat/StreamingTrace.tsx       NEW
src/components/chat/HitlBar.tsx              NEW
src/components/chat/CorrectionInput.tsx      NEW
src/components/chat/ClarifyCard.tsx          NEW
src/components/chat/FollowUpChips.tsx        NEW
src/components/Sidebar.tsx                   ADD "Learned Patterns" link
src/lib/chatStorage.ts                       NEW (sessionStorage wrapper)
src/lib/chatClient.ts                        NEW (SSE client)
```

## 8. Server — DuckDB, Blob, Routes

### 8.1 Server-side DuckDB singleton

`src/lib/server-duckdb.ts`. Module-scoped. On cold start:

1. Fetch `accumulated.csv` from Vercel Blob (~400-800ms).
2. Write to `/tmp/accumulated.csv` (Vercel scratch, 500MB limit).
3. Open DuckDB in-memory; `CREATE TABLE data AS SELECT * FROM read_csv_auto('/tmp/...')` (~600-1200ms).
4. Stash instance + dataVersion in module scope.
5. All concurrent initializers share one Promise to prevent race.

Warm requests: tool calls <50ms.

**Freshness:** `data_meta.json` tracks `dataVersion`. Agent route checks it (cached 60s); on bump, singleton resets and reloads.

**Warmup:** `GET /api/chat/warmup` triggers `getServerDb()`. Called by the chat page on mount so the first real message hits a warm DB.

### 8.2 Memory / limits

- 129K × 75-col DuckDB table ≈ 40-80 MB.
- Vercel Hobby function RAM: 1024 MB. Comfortable.
- Function timeout: 60s. `maxDuration = 60` on agent routes.

### 8.3 Blob layout

```
accumulated.csv           existing — the data
saved_queries.json        existing — saved report definitions
data_dictionary.json      NEW — upload-time grounding
data_meta.json            NEW — { dataVersion, updatedAt }
golden_examples.json      NEW — runtime learning store
```

All accessed via `@vercel/blob`'s `put() / list() / head()` with `addRandomSuffix: false`.

### 8.4 Upload-flow changes

`POST /api/blob/append`:

1. `put('accumulated.csv', csv, { addRandomSuffix: false })`.
2. Regenerate `data_dictionary.json` using a temp DuckDB over the new CSV.
3. Bump `data_meta.json` → `{ dataVersion: N+1, updatedAt: now }`.
4. Return `{ dataVersion, rowCount, dictionarySummary }`.

Step 2 adds ~1s to upload, once. Browser's `DuckDbContext.reload()` fires as today.

### 8.5 Prerequisite: fix the existing 500 bug

Per `CONTEXT.md:63-70`, two bugs:

- `ACCUMULATED_CSV_URL` hardcoded env var is fragile → replace with `list({ prefix: 'accumulated.csv' })` at read time; delete the env var.
- `BLOB_READ_WRITE_TOKEN` missing locally produces a silent 500 → add a startup check that fails with an actionable message.

Both land as **step 1 of the implementation plan**, before agent work starts.

### 8.6 Routes

```
NEW     /api/chat                           SSE streaming agent loop
NEW     /api/chat/warmup                    GET — warms DuckDB singleton
NEW     /api/golden-examples                GET (list), POST (add), DELETE (remove)
NEW     /api/golden-examples/un-verify      POST { id }

MODIFY  /api/blob/append                    fix 500 + regenerate dictionary
MODIFY  /api/blob/read                      use list() not env var

DEPRECATE /api/nl-to-sql                    (keep route file; handler returns 410 Gone with pointer to /api/chat)
DEPRECATE /api/refine-sql                   (keep route file; handler returns 410 Gone with pointer to /api/chat)

UNCHANGED  /api/blob/queries
UNCHANGED  /api/powerbi-to-sql
```

All agent routes declare:

```ts
export const runtime = 'nodejs';
export const maxDuration = 60;
```

### 8.7 Environment variables

```
GEMINI_API_KEY               existing
GROQ_API_KEY                 existing
BLOB_READ_WRITE_TOKEN        existing (must be set locally)
ACCUMULATED_CSV_URL          REMOVE
QUERIES_JSON_URL             REMOVE
```

### 8.8 SQL safety (agent `run_sql` validator)

Before executing any SQL from the agent:

- Parse via DuckDB parser; reject anything that isn't `SELECT` or a CTE resolving to `SELECT`.
- Reject references to any table other than `data`.
- If no explicit `LIMIT`, wrap with `LIMIT 100000`.
- Hard 10s per-query timeout.

Report-page SQL editor is unaffected (separate path, still client-side).

## 9. Error Handling Taxonomy

| Layer | Error | Recovery |
|---|---|---|
| Cold start | CSV fetch fails | 503 + actionable message; frontend shows retry |
| Cold start | CSV parse fails | 503 + offending row number; frontend says re-upload |
| Agent | Gemini 5xx / rate-limit | Restart on Gemini Flash; then Groq; then clean error |
| Agent | Malformed tool call JSON | Feed error back, up to 2 self-corrections; then fallback model |
| Agent | N=8 iterations without `final` | Emit structured "I'm struggling — rephrase?" |
| Agent | >3 clarify questions in one turn | Force `kind: "answer"` with listed assumptions OR surface explicit ask |
| run_sql | Not SELECT / non-data table / no LIMIT | Reject before execute; return error to model for self-correct |
| run_sql | Valid SQL, DuckDB throws | Return error to model; up to 3 retries |
| run_sql | Result >100K rows | Auto `LIMIT 100000`; note "truncated" |
| run_sql | >10s | Kill; return timeout to model |
| search_values | Zero matches | Return `[]`; system prompt rule forces agent to ask user |
| Golden examples | File missing | Treat as empty; no error |
| Golden examples | JSON corrupt | Log; treat as empty; admin page offers restore |
| Frontend | SSE drops | "Connection lost" + retry; in-progress discarded |
| Frontend | sessionStorage quota full | Drop oldest pairs silently |
| Frontend | Stale dataVersion | Stale banner with Clear CTA |

## 10. Testing Strategy

### 10.1 Unit tests (Jest)

```
lib/server-duckdb.test.ts          singleton, invalidation, SQL validator, LIMIT wrap
lib/golden-examples.test.ts        round-trip, ranking, corruption tolerance, dedupe
lib/data-dictionary.test.ts        brand grouping, fy_range, null-column handling
components/chat/AnswerCard.test.tsx chart-type routing, follow-up chips
lib/chat-sse.test.ts               SSE event parsing, reducer correctness
```

### 10.2 Integration tests (Jest + real DuckDB, mocked LLM)

```
api/chat.integration.test.ts       fixture CSV + deterministic tool-call mocks; trace, final shape, retry-on-SQL-error, clarify path
api/upload.integration.test.ts     upload → accumulated + dictionary + meta all updated
```

### 10.3 Eval set (manual / nightly, real LLM)

```
evals/chat-golden-set.ts           30 curated {question, expected_sql_pattern, expected_chart_type}; seed from team's failed questions
```

Not blocking for merge. Feeds prompt tuning.

### 10.4 Manual smoke checklist (pre-deploy)

1. Upload test CSV → dictionary regenerated.
2. "Top 5 brands by net primary FY 2025-26" → correct KPI+table in <3s.
3. "Shovert this year" → 3 SKUs found, answered.
4. "now by HQ" → scope remembered.
5. Correct an answer → appears in `/learned-patterns`.
6. Ask similar question in new session → prior correction retrieved.
7. Flag an answer → nothing server-side.
8. Refresh mid-stream → no ghost messages.
9. Close tab, reopen → chat cleared.
10. Upload new CSV → stale banner in chat.

## 11. Out of Scope (v1)

- Embedding-based golden-example retrieval.
- Auth / multi-user / per-user learning.
- Cross-session conversation resumption.
- Conversation export.
- Voice input / audio answers.
- Mobile-specific responsive work beyond current chat.
- Postgres / Neon migration.
- Auto-prompt-tuning from eval failures.
- Any data mutation (INSERT / UPDATE / DELETE) from agent.

## 12. Performance Targets

- Warm agent turn (typical question): **≤ 2 seconds end-to-end**.
- Cold start penalty: **≤ 2 seconds**, hidden by warmup ping on chat-page mount.
- Tool call latency (warm): **< 50ms**.
- Golden-example retrieval: **< 10ms**.
- Upload-time dictionary regeneration: **< 2 seconds** for 130K rows.

## 13. Open Questions / Future

- If >500 golden examples accumulate, swap tag-overlap retrieval for embeddings.
- If team grows beyond one user, add name tagging on Verified stamps and minimal auth.
- If CSV grows past ~1M rows, consider splitting per-FY blobs or migrating to Neon Postgres
  (still keep browser DuckDB for reports).
- Eval-driven prompt-tuning pipeline if prompt quality regresses over time.
