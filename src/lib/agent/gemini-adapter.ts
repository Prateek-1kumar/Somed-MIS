// Gemini model adapter — wraps the chat session + function-calling API into
// the ModelAdapter interface.
//
// Fallback chain: Gemini 2.5 Pro → Gemini 2.0 Flash → (Groq adapter TBD).
// Per-turn only: if Gemini 2.5 Pro fails on start, we restart on Flash;
// we don't switch models mid-loop.

import {
  GoogleGenerativeAI,
  SchemaType,
  FunctionCallingMode,
  type ChatSession,
  type FunctionDeclaration,
  type FunctionCall,
  type Part,
  type Content,
  type Schema,
} from '@google/generative-ai';
import type {
  ModelAdapter,
  ModelRoundTrip,
  ToolDefinition,
  ToolCall,
  ToolResultForModel,
  ConversationTurn,
} from './types';

function toPropertySchema(spec: { type: string; description?: string }): Schema {
  switch (spec.type) {
    case 'number':
      return { type: SchemaType.NUMBER, description: spec.description };
    case 'integer':
      return { type: SchemaType.INTEGER, description: spec.description };
    case 'boolean':
      return { type: SchemaType.BOOLEAN, description: spec.description };
    case 'string':
    default:
      return { type: SchemaType.STRING, description: spec.description };
  }
}

function toGeminiDeclaration(tool: ToolDefinition): FunctionDeclaration {
  const properties: Record<string, Schema> = {};
  for (const [name, spec] of Object.entries(tool.parameters.properties)) {
    properties[name] = toPropertySchema(spec);
  }
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties,
      required: tool.parameters.required,
    },
  };
}

function toolCallsFromParts(parts: Part[]): ToolCall[] {
  const calls: ToolCall[] = [];
  let i = 0;
  for (const part of parts) {
    if ('functionCall' in part && part.functionCall) {
      const fc = part.functionCall as FunctionCall;
      calls.push({
        id: `call_${Date.now()}_${i++}`,
        name: fc.name,
        args: (fc.args as Record<string, unknown>) ?? {},
      });
    }
  }
  return calls;
}

function textFromParts(parts: Part[]): string {
  return parts
    .filter(p => 'text' in p && typeof p.text === 'string')
    .map(p => (p as { text: string }).text)
    .join('\n')
    .trim();
}

function historyToGeminiContent(turns: ConversationTurn[]): Content[] {
  return turns.map(turn => ({
    role: turn.role === 'user' ? 'user' : 'model',
    parts: [{ text: turn.content }],
  }));
}

export interface GeminiAdapterOptions {
  apiKey: string;
  model?: string;
}

export function createGeminiAdapter(opts: GeminiAdapterOptions): ModelAdapter {
  const client = new GoogleGenerativeAI(opts.apiKey);
  const modelName = opts.model ?? 'gemini-2.5-pro';
  let chat: ChatSession | null = null;

  return {
    async start(input): Promise<ModelRoundTrip> {
      const model = client.getGenerativeModel({
        model: modelName,
        systemInstruction: input.systemPrompt,
        tools: [{ functionDeclarations: input.tools.map(toGeminiDeclaration) }],
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingMode.AUTO },
        },
      });
      chat = model.startChat({ history: historyToGeminiContent(input.history) });
      const result = await chat.sendMessage(input.userMessage);
      const candidates = result.response.candidates ?? [];
      const parts = (candidates[0]?.content?.parts ?? []) as Part[];
      const calls = toolCallsFromParts(parts);
      if (calls.length > 0) return { kind: 'tool_calls', calls };
      return { kind: 'text', text: textFromParts(parts) };
    },

    async continueWithToolResults(results: ToolResultForModel[]): Promise<ModelRoundTrip> {
      if (!chat) throw new Error('continueWithToolResults called before start');
      const parts: Part[] = results.map(r => ({
        functionResponse: { name: r.name, response: { result: r.result } },
      }));
      const result = await chat.sendMessage(parts);
      const candidates = result.response.candidates ?? [];
      const responseParts = (candidates[0]?.content?.parts ?? []) as Part[];
      const calls = toolCallsFromParts(responseParts);
      if (calls.length > 0) return { kind: 'tool_calls', calls };
      return { kind: 'text', text: textFromParts(responseParts) };
    },
  };
}

/** Factory with automatic primary→fallback model switching at start time. */
export function createGeminiWithFallback(apiKey: string): () => ModelAdapter {
  return () => {
    const primary = createGeminiAdapter({ apiKey, model: 'gemini-2.5-pro' });
    let switched = false;
    return {
      async start(input) {
        try {
          return await primary.start(input);
        } catch (e) {
          if (switched) throw e;
          switched = true;
          const fallback = createGeminiAdapter({ apiKey, model: 'gemini-2.0-flash' });
          Object.assign(this, fallback);
          return fallback.start(input);
        }
      },
      async continueWithToolResults(results) {
        return primary.continueWithToolResults(results);
      },
    };
  };
}

/** Is this error a rate-limit / quota error we should fall over on? */
export function isQuotaOrRateLimitError(e: unknown): boolean {
  const msg = String((e as { message?: string } | undefined)?.message ?? e ?? '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('rate-limit') ||
    msg.includes('resource_exhausted') ||
    msg.includes('too many requests')
  );
}
