// POST /api/chat — streams agent events as Server-Sent Events.
//
// Request body:
//   {
//     message: string,
//     history?: ConversationTurn[],   // last 6 turns (client trims)
//   }
//
// Response: text/event-stream of AgentEvent JSON, one per `event:`/`data:` pair.

import type { NextRequest } from 'next/server';
import { runAgent } from '@/lib/agent/loop';
import type { ConversationTurn, AgentEvent } from '@/lib/agent/types';
import { getServerDb } from '@/lib/server-duckdb';
import { createStore, vercelBlobGoldenProvider } from '@/lib/golden-examples';
import { createGeminiWithFallback } from '@/lib/agent/gemini-adapter';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const HISTORY_CAP = 6;

function encodeSse(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: NextRequest) {
  let body: { message?: string; history?: ConversationTurn[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const message = body.message?.trim();
  if (!message) {
    return new Response(JSON.stringify({ error: 'message required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is not set on the server' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const history = (body.history ?? []).slice(-HISTORY_CAP);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const db = await getServerDb();
        const goldenStore = createStore(vercelBlobGoldenProvider);
        const createModel = createGeminiWithFallback(apiKey);

        for await (const event of runAgent(
          { userMessage: message, history },
          { db, goldenStore, createModel },
        )) {
          controller.enqueue(encoder.encode(encodeSse(event)));
        }
      } catch (e) {
        const event: AgentEvent = { type: 'error', message: String(e) };
        controller.enqueue(encoder.encode(encodeSse(event)));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
