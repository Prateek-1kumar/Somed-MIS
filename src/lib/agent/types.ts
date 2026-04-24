// Shared types for the chat agent loop.

export type ChartType =
  | 'kpi'
  | 'line'
  | 'bar'
  | 'hbar'
  | 'pie'
  | 'stacked_bar'
  | 'table_only';

export interface FinalAnswer {
  kind: 'answer';
  narrative: string;
  headline: string;
  sql: string;
  chart_type: ChartType;
  chart_hints?: { x?: string; y?: string; series?: string };
  assumptions: string[];
  follow_ups: string[];
}

export interface FinalClarification {
  kind: 'clarify';
  clarify_question: string;
  clarify_choices?: string[];
}

export type StructuredFinal = FinalAnswer | FinalClarification;

export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; id: string; tool: string; args: unknown }
  | { type: 'tool_result'; id: string; result: unknown }
  | { type: 'clarify'; question: string; choices?: string[] }
  | { type: 'final'; answer: FinalAnswer }
  | { type: 'error'; message: string };

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultForModel {
  id: string;
  name: string;
  result: unknown;
}

/** A conversation turn as seen by the agent. */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  /** If this turn produced a verified SQL answer, include it for context. */
  sql?: string;
  /** If the user corrected this turn afterward, carry the correction text. */
  correction_note?: string;
}

/** What the model adapter returns for a single round-trip. */
export type ModelRoundTrip =
  | { kind: 'tool_calls'; calls: ToolCall[]; thinking?: string }
  | { kind: 'text'; text: string };

/** Definition of a tool the agent can call. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: 'string' | 'number' | 'integer' | 'boolean';
      description?: string;
    }>;
    required?: string[];
  };
}

/** Model adapter — abstracts over Gemini / Groq for testability. */
export interface ModelAdapter {
  /** Start a new session and send the first user message. */
  start(input: {
    systemPrompt: string;
    history: ConversationTurn[];
    userMessage: string;
    tools: ToolDefinition[];
  }): Promise<ModelRoundTrip>;

  /** Send tool results back and get the next response. */
  continueWithToolResults(results: ToolResultForModel[]): Promise<ModelRoundTrip>;
}
