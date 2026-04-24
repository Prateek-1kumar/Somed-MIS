// Builds the ModelAdapter chain: Gemini 2.5 Pro → Gemini 2.0 Flash → Groq.
//
// Design: the chain switches at **start** time only. Once an adapter has
// handled the first turn successfully, we stick with it through the whole
// agent loop — switching mid-loop means losing function-call history and
// re-running tools.

import type { ModelAdapter, ModelRoundTrip, ToolResultForModel } from './types';
import { createGeminiAdapter, isQuotaOrRateLimitError } from './gemini-adapter';
import { createGroqAdapter } from './groq-adapter';
import {
  createCerebrasAdapter,
  createOpenRouterAdapter,
  createXaiAdapter,
} from './openai-compatible-adapter';

export interface ModelFactoryOptions {
  geminiApiKey?: string;
  groqApiKey?: string;
  cerebrasApiKey?: string;
  openrouterApiKey?: string;
  xaiApiKey?: string;
  onFallback?: (from: string, to: string, reason: string) => void;
}

interface ChainStep {
  label: string;
  build: () => ModelAdapter;
}

export function createModelFactory(opts: ModelFactoryOptions): () => ModelAdapter {
  const steps: ChainStep[] = [];

  // Tier 1 — paid-grade reasoning (Gemini's free tier is thin but the
  // model is strong when quota exists).
  if (opts.geminiApiKey) {
    steps.push({
      label: 'gemini-2.5-pro',
      build: () => createGeminiAdapter({ apiKey: opts.geminiApiKey!, model: 'gemini-2.5-pro' }),
    });
    steps.push({
      label: 'gemini-2.0-flash',
      build: () => createGeminiAdapter({ apiKey: opts.geminiApiKey!, model: 'gemini-2.0-flash' }),
    });
  }

  // Tier 2 — Cerebras (fastest Llama 4 inference in the industry; generous
  // free daily quota; OpenAI-compatible tool calls work cleanly).
  if (opts.cerebrasApiKey) {
    steps.push({
      label: 'cerebras-llama-4-scout',
      build: () => createCerebrasAdapter({ apiKey: opts.cerebrasApiKey!, model: 'llama-4-scout-17b-16e-instruct' }),
    });
    steps.push({
      label: 'cerebras-llama-4-maverick',
      build: () => createCerebrasAdapter({ apiKey: opts.cerebrasApiKey!, model: 'llama-4-maverick-17b-128e-instruct' }),
    });
  }

  // Tier 3 — OpenRouter (aggregator; free tier on several strong models,
  // DeepSeek V3 in particular is solid at tool use).
  if (opts.openrouterApiKey) {
    steps.push({
      label: 'openrouter-deepseek-v3',
      build: () => createOpenRouterAdapter({
        apiKey: opts.openrouterApiKey!,
        model: 'deepseek/deepseek-chat-v3-0324:free',
      }),
    });
    steps.push({
      label: 'openrouter-llama-3.3-70b',
      build: () => createOpenRouterAdapter({
        apiKey: opts.openrouterApiKey!,
        model: 'meta-llama/llama-3.3-70b-instruct:free',
      }),
    });
  }

  // Tier 4 — Groq (fastest inference; multiple model architectures so
  // tool-call failure modes differ and at least one usually handles the turn).
  if (opts.groqApiKey) {
    steps.push({
      label: 'groq-openai-gpt-oss-20b',
      build: () => createGroqAdapter({ apiKey: opts.groqApiKey!, model: 'openai/gpt-oss-20b' }),
    });
    steps.push({
      label: 'groq-openai-gpt-oss-120b',
      build: () => createGroqAdapter({ apiKey: opts.groqApiKey!, model: 'openai/gpt-oss-120b' }),
    });
    steps.push({
      label: 'groq-llama-3.3-70b',
      build: () => createGroqAdapter({ apiKey: opts.groqApiKey!, model: 'llama-3.3-70b-versatile' }),
    });
  }

  // Tier 5 — xAI Grok (if user has a key; free tier has been generous).
  if (opts.xaiApiKey) {
    steps.push({
      label: 'xai-grok-4-fast',
      build: () => createXaiAdapter({ apiKey: opts.xaiApiKey!, model: 'grok-4-fast' }),
    });
  }

  if (steps.length === 0) {
    throw new Error(
      'No model credentials configured. Set at least one of: '
      + 'GEMINI_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, XAI_API_KEY',
    );
  }

  return () => new ChainedAdapter(steps, opts.onFallback);
}

/**
 * Wraps multiple adapters into a single ModelAdapter that retries `start`
 * down the chain on quota / rate-limit errors, then sticks with whichever
 * one answered first for the rest of the turn.
 */
class ChainedAdapter implements ModelAdapter {
  private active: { label: string; adapter: ModelAdapter } | null = null;

  constructor(
    private readonly steps: ChainStep[],
    private readonly onFallback?: (from: string, to: string, reason: string) => void,
  ) {}

  async start(input: Parameters<ModelAdapter['start']>[0]): Promise<ModelRoundTrip> {
    let lastError: unknown;
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      try {
        const adapter = step.build();
        const result = await tryWithRetry(() => adapter.start(input));
        this.active = { label: step.label, adapter };
        return result;
      } catch (e) {
        lastError = e;
        // On any start-time failure, try the next step. Transient 5xx /
        // timeout already got one retry via tryWithRetry; don't burn a
        // whole tier of latency on the primary if it's down.
        const nextLabel = this.steps[i + 1]?.label;
        if (nextLabel) {
          this.onFallback?.(step.label, nextLabel, String(e).slice(0, 300));
        }
      }
    }
    throw lastError ?? new Error('no models available');
  }

  async continueWithToolResults(results: ToolResultForModel[]): Promise<ModelRoundTrip> {
    if (!this.active) throw new Error('continueWithToolResults called before start');
    return this.active.adapter.continueWithToolResults(results);
  }

  get activeLabel(): string | null {
    return this.active?.label ?? null;
  }

  // Expose for tests.
  static {
    void isQuotaOrRateLimitError;
  }
}

/**
 * Retry a single model start() call ONCE on transient failures: network
 * errors, 5xx, and short timeouts. Quota / rate-limit / tool_use_failed
 * errors aren't transient — skip straight to the next chain step for those.
 */
async function tryWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = String((e as { message?: string } | undefined)?.message ?? e ?? '').toLowerCase();
    const transient =
      /network|timeout|fetch failed|econnreset|econnrefused|5\d\d/.test(msg)
      && !/429|quota|rate.?limit|tool_use_failed/.test(msg);
    if (!transient) throw e;
    // Brief pause, then a single retry — avoids thundering-herd on a
    // just-recovered provider.
    await new Promise(r => setTimeout(r, 400));
    return fn();
  }
}
