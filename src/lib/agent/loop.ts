// The agent loop. Yields AgentEvents as an async iterable — the route
// handler consumes these and re-emits as SSE.
//
// Control flow:
//   1. Extract tags from the user question.
//   2. Retrieve top-K golden examples.
//   3. Build system prompt.
//   4. Start model session with user message + tool defs.
//   5. Loop (max N iterations):
//        - If model returned tool calls:
//            * For each non-sentinel call: execute tool, emit events
//            * If any call is a sentinel (respond_with_answer/clarification):
//                parse it, emit final/clarify, return.
//        - If model returned text only: treat as implicit "answer" with no
//          chart (last-resort surfacing), so the user still sees something.
//   6. If loop exhausts N iterations, emit a graceful error.

import type {
  AgentEvent,
  ConversationTurn,
  ModelAdapter,
  ToolCall,
  ToolResultForModel,
} from './types';
import type { ServerDb } from '../server-db';
import { retrieveAll } from '../retrieval';
import { buildSystemPrompt } from './prompt';
import {
  TOOL_DEFINITIONS,
  RESPONSE_TOOL_NAMES,
  executeTool,
  parseResponseTool,
} from './tools';

const MAX_ITERATIONS = 8;
const MAX_CLARIFICATIONS_PER_TURN = 3;

export interface RunAgentInput {
  userMessage: string;
  history: ConversationTurn[];
}

export interface RunAgentDeps {
  db: ServerDb;
  createModel(): ModelAdapter;
}

export async function* runAgent(
  input: RunAgentInput,
  deps: RunAgentDeps,
): AsyncGenerator<AgentEvent> {
  try {
    const { userMessage, history } = input;

    // Yield this BEFORE retrieveAll so the UI shows progress immediately —
    // embedding + retrieval can take 1-3s and the user otherwise sees a
    // blank trace and assumes the chat is stuck.
    yield { type: 'thinking', text: 'Reading question and retrieving related verified patterns…' };

    const { golden: goldenExamples, anchors } = await retrieveAll(userMessage, {
      goldenK: 5,
      anchorsK: 3,
    });
    const systemPrompt = buildSystemPrompt({
      dictionary: deps.db.dictionary,
      goldenExamples,
      anchors,
      history,
    });
    const model = deps.createModel();

    let roundTrip = await model.start({
      systemPrompt,
      history,
      userMessage,
      tools: TOOL_DEFINITIONS,
    });

    let clarifyCount = 0;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (roundTrip.kind === 'text') {
        // Model returned plain text instead of calling a sentinel tool.
        // Surface it as an error — our contract requires a tool call.
        yield {
          type: 'error',
          message:
            'Model returned plain text instead of calling respond_with_answer. '
            + 'Please rephrase your question.',
        };
        return;
      }

      const calls = roundTrip.calls;
      if (roundTrip.thinking) {
        yield { type: 'thinking', text: roundTrip.thinking };
      }

      // Check for sentinel (response) calls first — if any present, handle
      // and return immediately. We don't mix data tool calls with sentinels.
      const sentinel = calls.find(c => RESPONSE_TOOL_NAMES.has(c.name));
      if (sentinel) {
        try {
          const parsed = parseResponseTool(sentinel);
          if (!parsed) throw new Error('parse returned undefined');
          if (parsed.kind === 'answer') {
            yield { type: 'final', answer: parsed };
            return;
          } else {
            clarifyCount += 1;
            if (clarifyCount > MAX_CLARIFICATIONS_PER_TURN) {
              yield {
                type: 'error',
                message:
                  'I need too much clarification to answer this. Please include '
                  + 'the metric (primary/secondary), time period, and scope in your question.',
              };
              return;
            }
            yield {
              type: 'clarify',
              question: parsed.clarify_question,
              choices: parsed.clarify_choices,
            };
            return;
          }
        } catch (e) {
          // Bad sentinel args — feed back to the model.
          const results: ToolResultForModel[] = [{
            id: sentinel.id,
            name: sentinel.name,
            result: { error: `invalid args: ${String(e)} — retry with correct args` },
          }];
          roundTrip = await model.continueWithToolResults(results);
          continue;
        }
      }

      // Otherwise: execute data tools and feed results back.
      const results: ToolResultForModel[] = [];
      for (const call of calls) {
        yield { type: 'tool_call', id: call.id, tool: call.name, args: call.args };
        const result = await executeTool(call as ToolCall, {
          db: deps.db,
        });
        yield { type: 'tool_result', id: call.id, result };
        results.push({ id: call.id, name: call.name, result });
      }

      roundTrip = await model.continueWithToolResults(results);
    }

    yield {
      type: 'error',
      message:
        'I\'m struggling with this one — too many steps without a clear answer. '
        + 'Could you rephrase or break it down into simpler parts?',
    };
  } catch (e) {
    yield { type: 'error', message: String(e) };
  }
}
