// Generic OpenAI-compatible chat-completions adapter.
//
// Works against any provider that speaks the OpenAI /v1/chat/completions
// protocol with tool_calls — Cerebras, OpenRouter, xAI, Together, Fireworks,
// and so on. Plain fetch(); no per-provider SDK needed.
//
// Why this is separate from groq-adapter.ts: Groq has some quirks (explicit
// max_tokens floor, specific tool_choice enum, stricter JSON) that the Groq
// SDK normalizes for us. For the generic case we own the wire format.

import type {
  ModelAdapter,
  ModelRoundTrip,
  ToolDefinition,
  ToolCall,
  ToolResultForModel,
  ConversationTurn,
} from './types';

interface OaiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OaiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OaiToolCall[];
}

interface OaiChoice {
  index: number;
  finish_reason: string | null;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: OaiToolCall[];
  };
}

interface OaiResponse {
  choices?: OaiChoice[];
  error?: { message: string; type?: string; code?: string };
}

export interface OpenAICompatibleOptions {
  apiKey: string;
  /** Full base URL ending at /v1, e.g. https://api.cerebras.ai/v1 */
  baseUrl: string;
  model: string;
  /** Human-readable label for error messages and telemetry. */
  providerLabel: string;
  /** Extra headers (OpenRouter wants HTTP-Referer + X-Title). */
  extraHeaders?: Record<string, string>;
  /** Timeout per HTTP call (ms). Defaults to 30s. */
  timeoutMs?: number;
  /** Max completion tokens. Defaults to 2048. */
  maxTokens?: number;
}

function toToolSpec(tool: ToolDefinition) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    },
  };
}

function historyToOai(turns: ConversationTurn[]): OaiMessage[] {
  return turns.map(t => ({
    role: t.role === 'user' ? 'user' as const : 'assistant' as const,
    content: t.content,
  }));
}

function parseToolCalls(toolCalls: OaiToolCall[]): ToolCall[] {
  return toolCalls.map(tc => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      args = { _raw_arguments: tc.function.arguments };
    }
    return { id: tc.id, name: tc.function.name, args };
  });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createOpenAICompatibleAdapter(
  opts: OpenAICompatibleOptions,
): ModelAdapter {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxTokens = opts.maxTokens ?? 2048;

  let messages: OaiMessage[] = [];
  let tools: ReturnType<typeof toToolSpec>[] = [];

  async function complete(): Promise<ModelRoundTrip> {
    const body = {
      model: opts.model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: maxTokens,
    };

    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${opts.apiKey}`,
            ...(opts.extraHeaders ?? {}),
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
      );
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') {
        throw new Error(`${opts.providerLabel}: timeout after ${timeoutMs}ms`);
      }
      throw new Error(`${opts.providerLabel}: network error — ${String(e)}`);
    }

    if (!res.ok) {
      let detail = `${res.status}`;
      try {
        const errBody = await res.json() as OaiResponse;
        if (errBody.error?.message) detail += ` — ${errBody.error.message}`;
        if (errBody.error?.code) detail += ` (${errBody.error.code})`;
      } catch {
        try { detail += ` — ${await res.text()}`; } catch { /* ignore */ }
      }
      // Normalize quota / tool-call errors into messages the chain recognizes.
      if (res.status === 429 || /quota|rate.?limit|insufficient|exceeded/i.test(detail)) {
        throw new Error(`${opts.providerLabel}: rate limit / quota (${detail})`);
      }
      if (/tool_use_failed|tool call validation|parse tool call/i.test(detail)) {
        throw new Error(`${opts.providerLabel}: tool_use_failed (${detail})`);
      }
      throw new Error(`${opts.providerLabel}: ${detail}`);
    }

    const json = await res.json() as OaiResponse;
    const choice = json.choices?.[0];
    const msg = choice?.message;
    if (!msg) return { kind: 'text', text: '' };

    messages.push({
      role: 'assistant',
      content: msg.content ?? null,
      tool_calls: msg.tool_calls,
    });

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      return { kind: 'tool_calls', calls: parseToolCalls(msg.tool_calls) };
    }
    return { kind: 'text', text: msg.content ?? '' };
  }

  return {
    async start(input): Promise<ModelRoundTrip> {
      tools = input.tools.map(toToolSpec);
      messages = [
        { role: 'system', content: input.systemPrompt },
        ...historyToOai(input.history),
        { role: 'user', content: input.userMessage },
      ];
      return complete();
    },

    async continueWithToolResults(results: ToolResultForModel[]): Promise<ModelRoundTrip> {
      for (const r of results) {
        messages.push({
          role: 'tool',
          tool_call_id: r.id,
          content: JSON.stringify(r.result),
        });
      }
      return complete();
    },
  };
}

// ── Provider-specific factories ───────────────────────────────────────────

export function createCerebrasAdapter(opts: { apiKey: string; model?: string }): ModelAdapter {
  return createOpenAICompatibleAdapter({
    apiKey: opts.apiKey,
    baseUrl: 'https://api.cerebras.ai/v1',
    // Llama 4 Scout: 17B activated, fast, generous free tier, solid tool use.
    model: opts.model ?? 'llama-4-scout-17b-16e-instruct',
    providerLabel: `cerebras-${opts.model ?? 'llama-4-scout-17b-16e-instruct'}`,
  });
}

export function createOpenRouterAdapter(opts: {
  apiKey: string;
  model?: string;
  siteUrl?: string;
  siteName?: string;
}): ModelAdapter {
  return createOpenAICompatibleAdapter({
    apiKey: opts.apiKey,
    baseUrl: 'https://openrouter.ai/api/v1',
    // DeepSeek V3 Chat (free) — strong reasoning + reliable tool calls on
    // OpenRouter's free tier. Much more consistent than Llama variants.
    model: opts.model ?? 'deepseek/deepseek-chat-v3-0324:free',
    providerLabel: `openrouter-${opts.model ?? 'deepseek-chat-v3:free'}`,
    extraHeaders: {
      'HTTP-Referer': opts.siteUrl ?? 'https://somed.local',
      'X-Title': opts.siteName ?? 'Shomed Remedies MIS',
    },
  });
}

export function createXaiAdapter(opts: { apiKey: string; model?: string }): ModelAdapter {
  return createOpenAICompatibleAdapter({
    apiKey: opts.apiKey,
    baseUrl: 'https://api.x.ai/v1',
    model: opts.model ?? 'grok-4-fast',
    providerLabel: `xai-${opts.model ?? 'grok-4-fast'}`,
  });
}
