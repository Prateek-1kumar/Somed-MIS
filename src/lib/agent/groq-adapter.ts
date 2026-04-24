// Groq model adapter — last-resort fallback when Gemini quota is exhausted.
//
// Uses Groq's OpenAI-compatible chat completions API with tool_calls support.
// Model: llama-3.3-70b-versatile (has reasonable tool-use reliability).

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
  const modelName = opts.model ?? 'llama-3.3-70b-versatile';

  // Groq API is stateless — we manage the message history manually.
  let messages: GroqMessage[] = [];
  let tools: ReturnType<typeof toGroqTool>[] = [];

  async function complete(): Promise<ModelRoundTrip> {
    const resp = await client.chat.completions.create({
      model: modelName,
      messages: messages as never, // SDK types are narrower than our union
      tools,
      tool_choice: 'auto',
      max_tokens: 1024,
    });
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
