// Builds the ModelAdapter chain: Gemini 2.5 Pro → Gemini 2.0 Flash → Groq.
//
// Design: the chain switches at **start** time only. Once an adapter has
// handled the first turn successfully, we stick with it through the whole
// agent loop — switching mid-loop means losing function-call history and
// re-running tools.

import type { ModelAdapter, ModelRoundTrip, ToolResultForModel } from './types';
import { createGeminiAdapter, isQuotaOrRateLimitError } from './gemini-adapter';
import { createGroqAdapter } from './groq-adapter';

export interface ModelFactoryOptions {
  geminiApiKey?: string;
  groqApiKey?: string;
  onFallback?: (from: string, to: string, reason: string) => void;
}

interface ChainStep {
  label: string;
  build: () => ModelAdapter;
}

export function createModelFactory(opts: ModelFactoryOptions): () => ModelAdapter {
  const steps: ChainStep[] = [];
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
  if (opts.groqApiKey) {
    // Multiple Groq steps, each a different architecture. Failure modes
    // differ (gpt-oss pretty-prints JSON; llama emits pseudo-XML), so
    // trying multiple increases the chance one handles the turn cleanly.
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

  if (steps.length === 0) {
    throw new Error('No model credentials configured — set GEMINI_API_KEY and/or GROQ_API_KEY');
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
        const result = await adapter.start(input);
        this.active = { label: step.label, adapter };
        return result;
      } catch (e) {
        lastError = e;
        // On quota / rate-limit, immediately try the next step. On other
        // errors, also try the next step — a broken primary shouldn't take
        // the whole session down.
        const nextLabel = this.steps[i + 1]?.label;
        if (nextLabel) {
          this.onFallback?.(step.label, nextLabel, String(e).slice(0, 300));
          // continue to next step
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
