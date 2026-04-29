// Golden-examples learning store. Team-verified Q→SQL pairs persist across
// conversations. Retrieved by tag-overlap ranking and injected into the
// agent's system prompt on every turn.
//
// Two pieces:
//   1. Provider abstraction (blob in prod, in-memory in tests).
//   2. Pure logic: tag extraction, ranking, record construction.

import { list, put } from '@vercel/blob';
import type { DataDictionary } from './server-db';

const BLOB_PATH = 'golden_examples.json';
const EXPIRY_MONTHS = 18;

export type GoldenStatus = 'verified' | 'corrected';

export interface GoldenExample {
  id: string;
  question: string;
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
  /** Optional override — normally computed from question text. */
  tags?: string[];
  dictionary?: DataDictionary;
}

export interface GoldenExamplesProvider {
  read(): Promise<GoldenExample[]>;
  write(examples: GoldenExample[]): Promise<void>;
}

// ── Tag extraction ────────────────────────────────────────────────────────

const METRIC_KEYWORDS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'metric:net_primary',    patterns: [/\bnet\s+primary\b/i, /\bnet\s+sales\b/i, /\bnet_sales_\b/i] },
  { tag: 'metric:primary',        patterns: [/\bprimary\s+sales\b/i, /\bprimary\s+target\b/i, /\bprimary\s+ach/i] },
  { tag: 'metric:secondary',      patterns: [/\bsecondary\b/i, /\bsales_valu\b/i] },
  { tag: 'metric:achievement',    patterns: [/\bach\s*%|\bachievement\b|\bach%/i] },
  { tag: 'metric:target',         patterns: [/\btarget\b|\btgt\b/i] },
  { tag: 'metric:expense',        patterns: [/\bexpense|\bsample\s+exp|\bmarketing\b|\bcamp\s*exp/i] },
  { tag: 'metric:return',         patterns: [/\breturn|\bgri\b|\brdsi\b/i] },
  { tag: 'metric:expiry',         patterns: [/\bexpir|\bnear\s*(3|6|9)\b/i] },
  { tag: 'metric:foc',            patterns: [/\bfoc\b|\bfree\s+of\s+cost\b/i] },
  { tag: 'metric:patient',        patterns: [/\bpatient|\bpap\b|\bdcpp\b/i] },
];

const PERIOD_KEYWORDS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'period:current_fy', patterns: [/\bthis\s+year\b/i, /\bcurrent\s+(fy|year)\b/i, /\bfy\s*2025-?2026\b/i, /\bfy\s*25-?26\b/i] },
  { tag: 'period:last_fy',    patterns: [/\blast\s+year\b/i, /\bprev(ious)?\s+(fy|year)\b/i, /\bfy\s*2024-?2025\b/i, /\bfy\s*24-?25\b/i] },
  { tag: 'period:monthly',    patterns: [/\bmonthly\b|\bmonth[- ]?wise\b|\bper\s+month\b|\btrend\b/i] },
  { tag: 'period:quarterly',  patterns: [/\bquarter|\bqtr\b|\bq[1-4]\b/i] },
  { tag: 'period:ytd',        patterns: [/\bytd\b|\byear[- ]?to[- ]?date\b/i] },
];

const BREAKDOWN_KEYWORDS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'dim:hq',       patterns: [/\bhq\b|\bby\s+hq\b|\bhq[- ]?wise\b/i] },
  { tag: 'dim:segment',  patterns: [/\bseg(ment)?\b|\bby\s+segment\b/i] },
  { tag: 'dim:zbm',      patterns: [/\bzbm\b|\bzone\b/i] },
  { tag: 'dim:brand',    patterns: [/\bbrand|\bitem\b|\bsku\b|\bproduct\b/i] },
  { tag: 'dim:doctor',   patterns: [/\bdoctor|\bdr\.?\b|\bprescriber\b/i] },
];

/**
 * Extract normalized tags from a natural-language question. Deterministic —
 * no LLM call. Tags are used purely for retrieval ranking; false positives
 * only slightly worsen ranking, they don't cause wrong answers.
 *
 * If a `dictionary` is passed, brand-family names mentioned in the question
 * become brand-specific tags like `brand:SHOVERT`.
 */
export function extractTags(question: string, dictionary?: DataDictionary): string[] {
  const tags = new Set<string>();
  const haystack = question.toLowerCase();

  for (const group of [METRIC_KEYWORDS, PERIOD_KEYWORDS, BREAKDOWN_KEYWORDS]) {
    for (const { tag, patterns } of group) {
      if (patterns.some(p => p.test(haystack))) tags.add(tag);
    }
  }

  // Brand family detection via dictionary.
  if (dictionary) {
    for (const family of Object.keys(dictionary.brand_families)) {
      const re = new RegExp(`\\b${family.toLowerCase()}\\b`, 'i');
      if (re.test(haystack)) tags.add(`brand:${family}`);
    }
    // Segment detection.
    for (const seg of dictionary.segments) {
      if (haystack.includes(seg.toLowerCase())) tags.add(`segment:${seg}`);
    }
    // HQ detection (only for unambiguous matches — word boundary).
    for (const hq of dictionary.hqs) {
      const re = new RegExp(`\\b${hq.toLowerCase()}\\b`, 'i');
      if (re.test(haystack)) tags.add(`hq:${hq}`);
    }
  }

  return [...tags].sort();
}

// ── Ranking ───────────────────────────────────────────────────────────────

export interface ScoredExample {
  example: GoldenExample;
  score: number;
  overlap: number;
}

/**
 * Rank examples by tag overlap, then by a recency+use-count bonus. The
 * ranking formula is deliberately simple so we can debug why an example
 * was (or wasn't) retrieved.
 *
 * Formula: score = overlap * 10 + recency_bonus + use_count_bonus + corrected_bonus
 *   recency_bonus = max(0, 1 - age_days/365)        # 0..1, fresh wins
 *   use_count_bonus = log2(use_count + 1) * 0.5      # diminishing returns
 *   corrected_bonus = +5 if status == 'corrected'    # lessons beat defaults
 */
export function rankExamples(
  examples: GoldenExample[],
  questionTags: string[],
  now: Date = new Date(),
): ScoredExample[] {
  const tagSet = new Set(questionTags);
  return examples
    .map(example => {
      const overlap = example.question_tags.filter(t => tagSet.has(t)).length;
      const ageDays = (now.getTime() - new Date(example.created_at).getTime()) / 86_400_000;
      const recency = Math.max(0, 1 - ageDays / 365);
      const useCountBonus = Math.log2(example.use_count + 1) * 0.5;
      const correctedBonus = example.status === 'corrected' ? 5 : 0;
      const score = overlap * 10 + recency + useCountBonus + correctedBonus;
      return { example, score, overlap };
    })
    .filter(s => s.overlap > 0 || s.score >= 5) // keep corrected even with zero overlap
    .sort((a, b) => b.score - a.score);
}

/** Filter out records older than EXPIRY_MONTHS unless re-verified recently. */
export function pruneExpired(examples: GoldenExample[], now: Date = new Date()): GoldenExample[] {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - EXPIRY_MONTHS);
  return examples.filter(e => new Date(e.verified_at) >= cutoff);
}

// ── Deduplication ─────────────────────────────────────────────────────────

/** Two SQL strings are "identical" if their normalized forms match. */
export function normalizeSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, ' ').replace(/\s*;+\s*$/, '').trim();
}

export function findDuplicate(
  examples: GoldenExample[],
  question: string,
  sql: string,
): GoldenExample | undefined {
  const q = question.trim().toLowerCase();
  const s = normalizeSql(sql);
  return examples.find(e =>
    e.question.trim().toLowerCase() === q && normalizeSql(e.sql) === s,
  );
}

// ── ID generation ─────────────────────────────────────────────────────────

export function generateExampleId(now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 6);
  return `ge_${date}_${rand}`;
}

// ── Store (uses provider) ─────────────────────────────────────────────────

export function createStore(provider: GoldenExamplesProvider) {
  return {
    async list(): Promise<GoldenExample[]> {
      return provider.read();
    },

    async add(input: NewGoldenExampleInput): Promise<GoldenExample> {
      const examples = await provider.read();
      // Dedupe: same question + same SQL → bump use_count instead of adding.
      const dup = findDuplicate(examples, input.question, input.sql);
      if (dup) {
        dup.use_count += 1;
        dup.verified_at = new Date().toISOString();
        await provider.write(examples);
        return dup;
      }
      const now = new Date().toISOString();
      const tags = input.tags ?? extractTags(input.question, input.dictionary);
      const example: GoldenExample = {
        id: generateExampleId(),
        question: input.question,
        question_tags: tags,
        narrative: input.narrative,
        sql: input.sql,
        chart_type: input.chart_type,
        assumptions: input.assumptions ?? [],
        status: input.status ?? 'verified',
        correction_note: input.correction_note,
        created_at: now,
        verified_at: now,
        use_count: 0,
      };
      examples.push(example);
      await provider.write(examples);
      return example;
    },

    async remove(id: string): Promise<void> {
      const examples = await provider.read();
      const next = examples.filter(e => e.id !== id);
      await provider.write(next);
    },

    async unVerify(id: string): Promise<void> {
      // Same as remove — an un-verified record has no authority over future turns.
      return this.remove(id);
    },

    async incrementUseCount(id: string): Promise<void> {
      const examples = await provider.read();
      const match = examples.find(e => e.id === id);
      if (!match) return;
      match.use_count += 1;
      await provider.write(examples);
    },

    /**
     * Retrieve top-K examples ranked by tag overlap + recency + use count.
     * `questionTags` should be pre-extracted (callers typically compute them
     * once per turn and reuse).
     */
    async topK(questionTags: string[], k = 5): Promise<GoldenExample[]> {
      const examples = pruneExpired(await provider.read());
      const ranked = rankExamples(examples, questionTags);
      return ranked.slice(0, k).map(r => r.example);
    },
  };
}

export type GoldenExamplesStore = ReturnType<typeof createStore>;

// ── Vercel Blob provider (production) ─────────────────────────────────────

export const vercelBlobGoldenProvider: GoldenExamplesProvider = {
  async read() {
    try {
      const { blobs } = await list({ prefix: BLOB_PATH });
      const blob = blobs.find(b => b.pathname === BLOB_PATH);
      if (!blob) return [];
      const res = await fetch(blob.url, {
        headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      });
      if (!res.ok) return [];
      const json = await res.json() as unknown;
      if (!Array.isArray(json)) return [];
      return json as GoldenExample[];
    } catch {
      return [];
    }
  },

  async write(examples) {
    await put(BLOB_PATH, JSON.stringify(examples, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  },
};

/** Convenience: in-memory provider for tests. */
export function createInMemoryProvider(initial: GoldenExample[] = []): GoldenExamplesProvider {
  let examples: GoldenExample[] = [...initial];
  return {
    async read() { return [...examples]; },
    async write(next) { examples = [...next]; },
  };
}
