/**
 * @jest-environment node
 */
import {
  createOpenAICompatibleAdapter,
  createCerebrasAdapter,
  createOpenRouterAdapter,
  createXaiAdapter,
} from './openai-compatible-adapter';
import type { ToolDefinition } from './types';

const TOOLS: ToolDefinition[] = [
  {
    name: 'ping',
    description: 'test',
    parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  },
];

describe('provider factories', () => {
  it('createCerebrasAdapter returns an adapter with start + continueWithToolResults', () => {
    const a = createCerebrasAdapter({ apiKey: 'k' });
    expect(typeof a.start).toBe('function');
    expect(typeof a.continueWithToolResults).toBe('function');
  });

  it('createOpenRouterAdapter returns an adapter', () => {
    const a = createOpenRouterAdapter({ apiKey: 'k' });
    expect(typeof a.start).toBe('function');
  });

  it('createXaiAdapter returns an adapter', () => {
    const a = createXaiAdapter({ apiKey: 'k' });
    expect(typeof a.start).toBe('function');
  });
});

describe('createOpenAICompatibleAdapter — wire format', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('sends Authorization + extra headers, parses tool_calls from response', async () => {
    let capturedInit: RequestInit | undefined;
    let capturedUrl: string | undefined;
    global.fetch = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify({
          choices: [{
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'c1',
                type: 'function',
                function: { name: 'ping', arguments: '{"q":"hello"}' },
              }],
            },
          }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: 'foo',
      providerLabel: 'test',
      extraHeaders: { 'X-Custom': 'yes' },
    });
    const result = await adapter.start({
      systemPrompt: 'sys',
      history: [],
      userMessage: 'hi',
      tools: TOOLS,
    });

    expect(capturedUrl).toBe('https://example.test/v1/chat/completions');
    const headers = (capturedInit?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['X-Custom']).toBe('yes');
    expect(headers['Content-Type']).toBe('application/json');

    expect(result.kind).toBe('tool_calls');
    if (result.kind === 'tool_calls') {
      expect(result.calls[0].name).toBe('ping');
      expect(result.calls[0].args).toEqual({ q: 'hello' });
    }
  });

  it('maps 429 to a rate-limit Error', async () => {
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ error: { message: 'quota exceeded', code: 'rate_limit_exceeded' } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      )
    ) as typeof fetch;

    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'k',
      baseUrl: 'https://e.test/v1',
      model: 'm',
      providerLabel: 'lbl',
    });

    await expect(adapter.start({ systemPrompt: '', history: [], userMessage: 'x', tools: [] }))
      .rejects.toThrow(/rate limit/i);
  });

  it('maps tool_use_failed into a distinct error', async () => {
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ error: { message: 'tool_use_failed: bad json', code: 'tool_use_failed' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    ) as typeof fetch;

    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'k',
      baseUrl: 'https://e.test/v1',
      model: 'm',
      providerLabel: 'lbl',
    });

    await expect(adapter.start({ systemPrompt: '', history: [], userMessage: 'x', tools: [] }))
      .rejects.toThrow(/tool_use_failed/);
  });

  it('sends tool results back on continue', async () => {
    let callCount = 0;
    const bodies: string[] = [];
    global.fetch = (async (_url: string, init: RequestInit) => {
      callCount++;
      bodies.push(init.body as string);
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            choices: [{ index: 0, finish_reason: 'tool_calls', message: {
              role: 'assistant', content: null,
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ping', arguments: '{}' } }],
            } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'k', baseUrl: 'https://e.test/v1', model: 'm', providerLabel: 'lbl',
    });
    await adapter.start({ systemPrompt: '', history: [], userMessage: 'hi', tools: TOOLS });
    const result = await adapter.continueWithToolResults([{ id: 'c1', name: 'ping', result: { ok: true } }]);
    expect(result.kind).toBe('text');
    if (result.kind === 'text') expect(result.text).toBe('done');
    // Second body should include a tool message with the result payload.
    const body2 = JSON.parse(bodies[1]) as { messages: Array<{ role: string; content?: string; tool_call_id?: string }> };
    const toolMsg = body2.messages.find(m => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe('c1');
    expect(toolMsg?.content).toContain('"ok":true');
  });
});
