// Groq model adapter — last-resort fallback when Gemini quota is exhausted.
//
// Uses Groq's OpenAI-compatible chat completions API with tool_calls support.
// Default model: `openai/gpt-oss-120b` — trained specifically for proper
// OpenAI-format tool calling. Llama 3.3 70B has a known failure mode where
// it emits <function=name{args}> pseudo-XML that Groq's server rejects with
// tool_use_failed. gpt-oss avoids this.

import Groq from 'groq-sdk';
import type {
  ModelAdapter,
  ModelRoundTrip,
  ToolDefinition,
  ToolCall,
  ToolResultForModel,
  ConversationTurn,
} from './types';

type GroqMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
};

function toGroqTool(tool: ToolDefinition) {
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

function historyToGroq(turns: ConversationTurn[]): GroqMessage[] {
  return turns.map(t => ({
    role: t.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: t.content,
  }));
}

function parseToolCallsFromGroq(
  toolCalls: NonNullable<GroqMessage['tool_calls']>,
): ToolCall[] {
  return toolCalls.map(tc => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      // Arguments weren't valid JSON. Surface the raw string so tools can
      // at least fail with an informative error (rather than silently).
      args = { _raw_arguments: tc.function.arguments };
    }
    return {
      id: tc.id,
      name: tc.function.name,
      args,
    };
  });
}

export interface GroqAdapterOptions {
  apiKey: string;
  model?: string;
}

export function createGroqAdapter(opts: GroqAdapterOptions): ModelAdapter {
  const client = new Groq({ apiKey: opts.apiKey });
  const modelName = opts.model ?? 'openai/gpt-oss-120b';

  // Groq API is stateless — we manage the message history manually.
  let messages: GroqMessage[] = [];
  let tools: ReturnType<typeof toGroqTool>[] = [];

  async function complete(): Promise<ModelRoundTrip> {
    let resp;
    try {
      resp = await client.chat.completions.create({
        model: modelName,
        messages: messages as never, // SDK types are narrower than our union
        tools,
        tool_choice: 'auto',
        max_tokens: 1024,
      });
    } catch (e) {
      // Groq returns 400 with code: tool_use_failed when the model emits
      // malformed tool calls (e.g., <function=name{args}> pseudo-XML from
      // some Llama variants). Re-throw with a diagnosis so the outer chain
      // can classify + the friendly-error mapper in the route picks it up.
      const msg = String((e as { message?: string } | undefined)?.message ?? e ?? '');
      if (/tool_use_failed|tool call validation/i.test(msg)) {
        throw new Error(
          `Groq model ${modelName} emitted malformed tool calls (tool_use_failed). `
          + `If this keeps happening on ${modelName}, try another model via `
          + `createGroqAdapter({ model: 'openai/gpt-oss-20b' }). Raw: ${msg.slice(0, 300)}`,
        );
      }
      throw e;
    }
    const choice = resp.choices[0];
    const msg = choice?.message;
    if (!msg) return { kind: 'text', text: '' };

    // Append the assistant turn to history for the next call.
    messages.push({
      role: 'assistant',
      content: msg.content ?? null,
      tool_calls: msg.tool_calls,
    });

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      return { kind: 'tool_calls', calls: parseToolCallsFromGroq(msg.tool_calls) };
    }
    return { kind: 'text', text: msg.content ?? '' };
  }

  return {
    async start(input): Promise<ModelRoundTrip> {
      tools = input.tools.map(toGroqTool);
      messages = [
        { role: 'system', content: input.systemPrompt },
        ...historyToGroq(input.history),
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
