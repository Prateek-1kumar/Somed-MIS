// sessionStorage wrapper for the chat thread. Persists across page refreshes
// within the same browser session; wiped when the tab closes (user's choice).

import type { FinalAnswer } from './agent/types';

export type ChatMessage =
  | { id: string; role: 'user'; text: string; createdAt: number }
  | {
      id: string;
      role: 'agent';
      createdAt: number;
      state: 'streaming' | 'final' | 'clarify' | 'error' | 'superseded';
      answer?: FinalAnswer;
      clarify?: { question: string; choices?: string[] };
      rows?: Record<string, unknown>[];
      sqlExecutedInBrowser?: boolean;
      error?: string;
      trace?: TraceEntry[];
      /** When user clicks ✎ Correct, we create a new agent message with this set. */
      supersedes?: string;
      /** The user message that prompted this agent turn — needed when verifying. */
      userQuestion?: string;
      /** Verification state. */
      verifiedGoldenId?: string;
      flagged?: boolean;
    };

export interface TraceEntry {
  kind: 'thinking' | 'tool_call' | 'tool_result';
  text?: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
}

export interface ChatState {
  messages: ChatMessage[];
  sessionStartedAt: number;
  dataVersion: number;
}

const KEY = 'somed_chat_v1';

function isBrowser() {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
}

export function loadChatState(): ChatState | null {
  if (!isBrowser()) return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatState;
    if (!Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveChatState(state: ChatState): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or similar — silently fall back to in-memory only.
  }
}

export function clearChatState(): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

export function currentDataVersion(): number {
  if (!isBrowser()) return 0;
  try {
    return Number(localStorage.getItem('dataVersion')) || 0;
  } catch {
    return 0;
  }
}

export function buildInitialState(): ChatState {
  return {
    messages: [],
    sessionStartedAt: Date.now(),
    dataVersion: currentDataVersion(),
  };
}
