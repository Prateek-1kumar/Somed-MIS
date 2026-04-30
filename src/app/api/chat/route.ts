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
import { createModelFactory } from '@/lib/agent/model-factory';

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

  const geminiApiKey = process.env.GEMINI_API_KEY;
  const groqApiKey = process.env.GROQ_API_KEY;
  const cerebrasApiKey = process.env.CEREBRAS_API_KEY;
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;
  const xaiApiKey = process.env.XAI_API_KEY;
  if (!geminiApiKey && !groqApiKey && !cerebrasApiKey && !openrouterApiKey && !xaiApiKey) {
    return new Response(
      JSON.stringify({
        error:
          'No model credentials. Set at least one of: GEMINI_API_KEY, '
          + 'CEREBRAS_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, XAI_API_KEY',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const history = (body.history ?? []).slice(-HISTORY_CAP);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { getServerDb } = await import('@/lib/server-db');
        const db = await getServerDb();
        const createModel = createModelFactory({
          geminiApiKey,
          groqApiKey,
          cerebrasApiKey,
          openrouterApiKey,
          xaiApiKey,
          onFallback: (from, to, reason) => {
            console.warn(`[chat] ${from} failed, falling back to ${to}: ${reason}`);
          },
        });

        for await (const event of runAgent(
          { userMessage: message, history },
          { db, createModel },
        )) {
          controller.enqueue(encoder.encode(encodeSse(event)));
        }
      } catch (e) {
        const raw = String(e);
        // Quota / rate-limit messages are ugly and alarming. Surface a
        // friendly message but keep the raw error in console logs.
        let friendly = raw;
        if (/429|quota|rate.?limit|resource_exhausted|too many requests/i.test(raw)) {
          friendly =
            'All configured AI models are rate-limited or out of quota right now. '
            + 'Wait a minute and try again.';
        } else if (/tool_use_failed|tool call validation|malformed tool/i.test(raw)) {
          friendly =
            'Every configured fallback model produced malformed tool calls on this '
            + 'question. Usually a quirk for complex multi-step queries — try a '
            + 'simpler rephrasing, or wait until the primary Gemini model quota '
            + 'refreshes (it handles multi-step SQL cleanly).';
        } else if (/no CSV/i.test(raw)) {
          friendly = 'No data uploaded yet. Upload a CSV from /upload first.';
        }
        console.error('[chat] agent loop failed:', raw);
        const event: AgentEvent = { type: 'error', message: friendly };
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
