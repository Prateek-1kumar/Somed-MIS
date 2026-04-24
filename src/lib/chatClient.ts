// Browser-side SSE client for /api/chat. Parses events and yields them as an
// async iterable so callers can drive UI updates straightforwardly.

import type { AgentEvent, ConversationTurn } from './agent/types';

export interface ChatClientInput {
  message: string;
  history: ConversationTurn[];
  signal?: AbortSignal;
}

export async function* streamAgent(input: ChatClientInput): AsyncGenerator<AgentEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: input.message, history: input.history }),
    signal: input.signal,
  });

  if (!res.ok) {
    let message = `chat API returned ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body?.error) message = body.error;
    } catch { /* swallow */ }
    yield { type: 'error', message };
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    yield { type: 'error', message: 'no response body' };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by \n\n.
    let sepIdx = buffer.indexOf('\n\n');
    while (sepIdx !== -1) {
      const chunk = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const event = parseSseChunk(chunk);
      if (event) yield event;
      sepIdx = buffer.indexOf('\n\n');
    }
  }
}

function parseSseChunk(chunk: string): AgentEvent | null {
  let dataLine = '';
  for (const line of chunk.split('\n')) {
    if (line.startsWith('data: ')) dataLine += line.slice(6);
  }
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine) as AgentEvent;
  } catch {
    return null;
  }
}
