'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runRawSql } from '@/app/reports/actions';
import AnswerCard from '@/components/chat/AnswerCard';
import StreamingTrace from '@/components/chat/StreamingTrace';
import { streamAgent } from '@/lib/chatClient';
import {
  loadChatState,
  saveChatState,
  clearChatState,
  buildInitialState,
  currentDataVersion,
  type ChatMessage,
  type ChatState,
  type TraceEntry,
} from '@/lib/chatStorage';
import type { AgentEvent, ConversationTurn, FinalAnswer } from '@/lib/agent/types';

const SUGGESTIONS = [
  'Top 5 brands by secondary sales for FY 2025-26',
  'Segment-wise expense % for FY 2024-25',
  'Monthly primary sales trend for NEURO segment',
  'HQ-wise achievement % this year',
];

let _idSeed = 0;
function newId(prefix: string): string {
  _idSeed += 1;
  return `${prefix}_${Date.now()}_${_idSeed}`;
}

/** Build the last-6 history snippet for /api/chat. */
function buildApiHistory(messages: ChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      turns.push({ role: 'user', content: m.text });
    } else if (m.role === 'agent' && m.state === 'final' && m.answer) {
      turns.push({
        role: 'assistant',
        content: m.answer.narrative,
        sql: m.answer.sql,
      });
    }
    // Skip streaming/error/superseded/clarify turns — they don't add signal.
  }
  return turns.slice(-6);
}

/** Re-run the agent's SQL on the Postgres backend so we can show rows in the AnswerCard. */
async function fetchRowsForSql(
  sqlText: string,
): Promise<{ rows: Record<string, unknown>[] } | { error: string }> {
  try {
    const rows = await runRawSql(sqlText);
    return { rows };
  } catch (e) {
    return { error: String(e) };
  }
}

export default function ChatPage() {
  const [state, setState] = useState<ChatState>(() => buildInitialState());
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Hydrate from sessionStorage on mount.
  useEffect(() => {
    const loaded = loadChatState();
    if (loaded) setState(loaded);
  }, []);

  // Warm the server DuckDB so first message doesn't pay cold-start latency.
  useEffect(() => {
    fetch('/api/chat/warmup').catch(() => { /* silent — just a primer */ });
  }, []);

  // Persist on every change.
  useEffect(() => {
    saveChatState(state);
  }, [state]);

  // Auto-scroll on new messages.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages]);

  const staleDataBanner = useMemo(() => {
    const current = currentDataVersion();
    return current > state.dataVersion;
  }, [state.dataVersion]);

  // --- Streaming helpers ----------------------------------------------------

  const runTurn = useCallback(async (userMessage: string, historyOverride?: ConversationTurn[]) => {
    if (!userMessage.trim() || isStreaming) return;
    setIsStreaming(true);
    setInput('');

    const userMsg: ChatMessage = {
      id: newId('u'),
      role: 'user',
      text: userMessage,
      createdAt: Date.now(),
    };
    const agentMsg: ChatMessage = {
      id: newId('a'),
      role: 'agent',
      state: 'streaming',
      createdAt: Date.now(),
      trace: [],
      userQuestion: userMessage,
    };

    setState(s => ({ ...s, messages: [...s.messages, userMsg, agentMsg] }));

    const historyForApi = historyOverride ?? buildApiHistory(state.messages);
    const ac = new AbortController();
    abortRef.current = ac;

    let finalAnswer: FinalAnswer | undefined;
    const trace: TraceEntry[] = [];

    try {
      for await (const event of streamAgent({
        message: userMessage,
        history: historyForApi,
        signal: ac.signal,
      })) {
        await handleEvent(agentMsg.id, event, trace, (answer) => { finalAnswer = answer; });
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setState(s => ({
          ...s,
          messages: s.messages.map(m =>
            m.id === agentMsg.id && m.role === 'agent'
              ? { ...m, state: 'error', error: String(e) }
              : m,
          ),
        }));
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }

    // If we got a final answer, re-run its SQL on Postgres for display.
    if (finalAnswer) {
      const result = await fetchRowsForSql(finalAnswer.sql);
      setState(s => ({
        ...s,
        messages: s.messages.map(m =>
          m.id === agentMsg.id && m.role === 'agent'
            ? 'rows' in result
              ? { ...m, rows: result.rows, sqlExecutedInBrowser: true }
              : { ...m, error: result.error, sqlExecutedInBrowser: false }
            : m,
        ),
      }));
    }
  }, [state.messages, isStreaming]);

  // Handle a single SSE event and update the agent message.
  const handleEvent = useCallback(
    async (
      msgId: string,
      event: AgentEvent,
      trace: TraceEntry[],
      onFinal: (a: FinalAnswer) => void,
    ) => {
      if (event.type === 'thinking') {
        trace.push({ kind: 'thinking', text: event.text });
      } else if (event.type === 'tool_call') {
        trace.push({ kind: 'tool_call', tool: event.tool, args: event.args });
      } else if (event.type === 'tool_result') {
        trace.push({ kind: 'tool_result', result: event.result });
      }

      setState(s => ({
        ...s,
        messages: s.messages.map(m => {
          if (m.id !== msgId || m.role !== 'agent') return m;
          if (event.type === 'final') {
            return { ...m, state: 'final', answer: event.answer, trace: [...trace] };
          }
          if (event.type === 'clarify') {
            return {
              ...m,
              state: 'clarify',
              clarify: { question: event.question, choices: event.choices },
              trace: [...trace],
            };
          }
          if (event.type === 'error') {
            return { ...m, state: 'error', error: event.message, trace: [...trace] };
          }
          return { ...m, trace: [...trace] };
        }),
      }));

      if (event.type === 'final') onFinal(event.answer);
    },
    [],
  );

  // --- Public actions -------------------------------------------------------

  const send = useCallback((text?: string) => {
    const q = text ?? input;
    if (!q.trim()) return;
    runTurn(q);
  }, [input, runTurn]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearAll = useCallback(() => {
    clearChatState();
    setState(buildInitialState());
    setInput('');
    setCorrectingId(null);
    setCorrectionText('');
  }, []);

  const submitClarifyChoice = useCallback((choice: string) => {
    runTurn(choice);
  }, [runTurn]);

  const markVerified = useCallback(async (msg: ChatMessage) => {
    if (msg.role !== 'agent' || !msg.answer || !msg.userQuestion) return;
    try {
      const res = await fetch('/api/golden-examples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: msg.userQuestion,
          narrative: msg.answer.narrative,
          sql: msg.answer.sql,
          chart_type: msg.answer.chart_type,
          assumptions: msg.answer.assumptions,
          status: 'verified',
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const created = await res.json() as { id: string };
      setState(s => ({
        ...s,
        messages: s.messages.map(m =>
          m.id === msg.id && m.role === 'agent'
            ? { ...m, verifiedGoldenId: created.id, flagged: false }
            : m,
        ),
      }));
    } catch (e) {
      alert('Failed to save verified example: ' + String(e));
    }
  }, []);

  const unverify = useCallback(async (msg: ChatMessage) => {
    if (msg.role !== 'agent' || !msg.verifiedGoldenId) return;
    try {
      await fetch('/api/golden-examples/un-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msg.verifiedGoldenId }),
      });
      setState(s => ({
        ...s,
        messages: s.messages.map(m =>
          m.id === msg.id && m.role === 'agent'
            ? { ...m, verifiedGoldenId: undefined }
            : m,
        ),
      }));
    } catch (e) {
      alert('Failed to un-verify: ' + String(e));
    }
  }, []);

  const toggleFlag = useCallback((msg: ChatMessage) => {
    setState(s => ({
      ...s,
      messages: s.messages.map(m =>
        m.id === msg.id && m.role === 'agent'
          ? { ...m, flagged: !m.flagged }
          : m,
      ),
    }));
  }, []);

  const submitCorrection = useCallback(async (msg: ChatMessage) => {
    if (msg.role !== 'agent' || !msg.userQuestion) return;
    const text = correctionText.trim();
    if (!text) return;

    // Mark the original as superseded.
    setState(s => ({
      ...s,
      messages: s.messages.map(m =>
        m.id === msg.id && m.role === 'agent' ? { ...m, state: 'superseded' } : m,
      ),
    }));
    setCorrectingId(null);
    setCorrectionText('');

    // Frame the correction as the next user turn, with context from the bad answer.
    const correctionPrompt = [
      `Previous question: ${msg.userQuestion}`,
      msg.answer ? `Previous SQL: ${msg.answer.sql}` : '',
      msg.answer ? `Previous narrative: ${msg.answer.narrative}` : '',
      `User correction: ${text}`,
      'Redo the answer with this correction applied.',
    ].filter(Boolean).join('\n\n');

    await runTurn(correctionPrompt);
  }, [correctionText, runTurn]);

  // --- Render ---------------------------------------------------------------

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full p-4 sm:p-6 pb-0">
      {/* Header */}
      <div className="border-b border-[var(--border)] pb-4 mb-4 shrink-0 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Chat with your data</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Ask anything — I&apos;ll look up real values, self-correct, and wait for clarification if unsure.
          </p>
        </div>
        {state.messages.length > 0 && (
          <button
            onClick={clearAll}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)] transition-colors"
            title="Clear chat"
          >
            Clear
          </button>
        )}
      </div>

      {staleDataBanner && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
          Your data was updated since this conversation started.
          <button onClick={clearAll} className="ml-2 underline font-semibold">Start fresh</button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-6 pb-6 pr-2 scrollbar-thin scrollbar-thumb-[var(--border-strong)]">
        {state.messages.length === 0 && (
          <EmptyState onPick={s => send(s)} />
        )}

        {state.messages.map(msg => (
          <MessageView
            key={msg.id}
            msg={msg}
            isStreaming={isStreaming}
            correctingId={correctingId}
            correctionText={correctionText}
            setCorrectingId={setCorrectingId}
            setCorrectionText={setCorrectionText}
            onClarifyChoice={submitClarifyChoice}
            onVerified={markVerified}
            onUnverify={unverify}
            onFlag={toggleFlag}
            onSubmitCorrection={submitCorrection}
          />
        ))}

        <div ref={bottomRef} className="h-4 shrink-0" />
      </div>

      {/* Input Bar */}
      <div className="shrink-0 border-t border-[var(--border)] pt-4 pb-6 bg-gradient-to-t from-[var(--bg-base)] via-[var(--bg-base)] to-transparent sticky bottom-0 z-10">
        <div className="relative shadow-sm rounded-xl">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask anything about your data… (Enter to send)"
            rows={1}
            disabled={isStreaming}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl pl-4 pr-14 py-3.5 text-[15px] focus:outline-none focus:border-[var(--text-muted)] focus:ring-1 focus:ring-[var(--text-muted)] resize-none overflow-hidden max-h-[150px] shadow-sm transition-all disabled:opacity-60"
            style={{ minHeight: '52px', height: input ? `${Math.min(150, Math.max(52, input.split('\n').length * 24 + 28))}px` : '52px' }}
          />
          {isStreaming ? (
            <button
              onClick={stop}
              className="absolute right-2.5 bottom-[11px] px-2.5 py-1 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!input.trim()}
              className="absolute right-2.5 bottom-[11px] p-1.5 rounded-lg bg-[var(--text-primary)] text-[var(--bg-surface)] enabled:hover:opacity-90 disabled:opacity-30 transition-all cursor-pointer shadow-sm"
            >
              <svg className="w-5 h-5 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19V5m0 0l-6 6m6-6l6 6" />
              </svg>
            </button>
          )}
        </div>
        <p className="text-center text-[11px] text-[var(--text-muted)] mt-3">
          Grounded agent with tool use. Verify or correct answers — the system learns from your team&apos;s feedback.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4 mt-8 opacity-80">
      <div className="w-16 h-16 rounded-2xl bg-[var(--bg-surface-raised)] flex items-center justify-center mb-6 shadow-sm border border-[var(--border)]">
        <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-[var(--text-primary)]">Ask anything about your sales data</h3>
      <p className="text-sm text-[var(--text-muted)] mt-2 max-w-sm">
        I&apos;ll ground my queries in real values from your data, show my reasoning, and ask if anything is ambiguous.
      </p>
      <div className="flex flex-wrap gap-2 justify-center mt-6 max-w-lg">
        {SUGGESTIONS.map(s => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)] transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

interface MessageViewProps {
  msg: ChatMessage;
  isStreaming: boolean;
  correctingId: string | null;
  correctionText: string;
  setCorrectingId: (id: string | null) => void;
  setCorrectionText: (t: string) => void;
  onClarifyChoice: (choice: string) => void;
  onVerified: (msg: ChatMessage) => void;
  onUnverify: (msg: ChatMessage) => void;
  onFlag: (msg: ChatMessage) => void;
  onSubmitCorrection: (msg: ChatMessage) => void;
}

function MessageView(props: MessageViewProps) {
  const { msg } = props;

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end w-full">
        <div className="bg-[var(--text-primary)] text-[var(--bg-surface)] rounded-2xl rounded-tr-sm px-4 py-2.5 text-[15px] max-w-[85%] sm:max-w-[75%] shadow-sm leading-relaxed whitespace-pre-wrap">
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 w-full max-w-[95%] sm:max-w-[90%]">
      <div className="w-8 h-8 rounded-full bg-[var(--bg-surface-raised)] border border-[var(--border)] flex items-center justify-center shrink-0 shadow-sm mt-0.5">
        <svg className="w-4 h-4 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>

      <div className={`flex-1 space-y-3 min-w-0 ${msg.state === 'superseded' ? 'opacity-60' : ''}`}>
        {msg.state === 'superseded' && (
          <div className="text-xs italic text-[var(--text-muted)] bg-[var(--bg-surface-raised)] px-3 py-1.5 rounded border border-[var(--border)]">
            Superseded by correction below ↓
          </div>
        )}

        {msg.trace && msg.trace.length > 0 && (
          <StreamingTrace
            entries={msg.trace}
            live={msg.state === 'streaming'}
            defaultExpanded={msg.state === 'streaming'}
          />
        )}

        {msg.state === 'error' && (
          <div className="bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl p-3.5 text-sm">
            {msg.error ?? 'Something went wrong.'}
          </div>
        )}

        {msg.state === 'clarify' && msg.clarify && (
          <ClarifyView clarify={msg.clarify} onPick={props.onClarifyChoice} />
        )}

        {msg.state === 'final' && msg.answer && (
          <>
            <AnswerCard answer={msg.answer} rows={msg.rows ?? null} rowsError={msg.error} />
            <HitlBar
              msg={msg}
              correctingId={props.correctingId}
              setCorrectingId={props.setCorrectingId}
              onVerified={props.onVerified}
              onUnverify={props.onUnverify}
              onFlag={props.onFlag}
            />
            {props.correctingId === msg.id && (
              <CorrectionInput
                value={props.correctionText}
                onChange={props.setCorrectionText}
                onSubmit={() => props.onSubmitCorrection(msg)}
                onCancel={() => {
                  props.setCorrectingId(null);
                  props.setCorrectionText('');
                }}
              />
            )}
            {msg.answer.follow_ups.length > 0 && (
              <FollowUpChips chips={msg.answer.follow_ups} onPick={props.onClarifyChoice} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ClarifyView({ clarify, onPick }: { clarify: { question: string; choices?: string[] }; onPick: (s: string) => void }) {
  return (
    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-2">❓ I need to check something first</p>
      <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">{clarify.question}</p>
      {clarify.choices && clarify.choices.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {clarify.choices.map(c => (
            <button
              key={c}
              onClick={() => onPick(c)}
              className="px-3 py-1.5 bg-white dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 rounded-lg text-sm hover:bg-amber-100 dark:hover:bg-amber-800/60 transition-colors"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface HitlBarProps {
  msg: ChatMessage;
  correctingId: string | null;
  setCorrectingId: (id: string | null) => void;
  onVerified: (msg: ChatMessage) => void;
  onUnverify: (msg: ChatMessage) => void;
  onFlag: (msg: ChatMessage) => void;
}

function HitlBar({ msg, correctingId, setCorrectingId, onVerified, onUnverify, onFlag }: HitlBarProps) {
  if (msg.role !== 'agent') return null;
  const verified = !!msg.verifiedGoldenId;
  const flagged = !!msg.flagged;

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {verified ? (
        <button
          onClick={() => onUnverify(msg)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[12px] font-semibold hover:bg-emerald-600 transition-colors"
        >
          ✓ Verified — click to undo
        </button>
      ) : (
        <button
          onClick={() => onVerified(msg)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-emerald-400 transition-colors"
        >
          ✓ Verified
        </button>
      )}
      <button
        onClick={() => setCorrectingId(correctingId === msg.id ? null : msg.id)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-blue-400 transition-colors"
      >
        ✎ Correct
      </button>
      <button
        onClick={() => onFlag(msg)}
        className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-[12px] font-medium transition-colors ${
          flagged
            ? 'bg-red-100 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300'
            : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-red-400'
        }`}
      >
        🚩 {flagged ? 'Flagged' : 'Flag'}
      </button>
    </div>
  );
}

function CorrectionInput({
  value, onChange, onSubmit, onCancel,
}: { value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void }) {
  return (
    <div className="flex gap-2 mt-2">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onSubmit();
          else if (e.key === 'Escape') onCancel();
        }}
        placeholder="What's wrong? e.g. 'use net secondary, not gross' / 'exclude inactive items'"
        autoFocus
        className="flex-1 text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-muted)]"
      />
      <button
        onClick={onSubmit}
        className="px-3 py-2 bg-[var(--text-primary)] text-[var(--bg-surface)] rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        Apply
      </button>
      <button
        onClick={onCancel}
        className="px-3 py-2 border border-[var(--border)] text-[var(--text-secondary)] rounded-lg text-sm hover:bg-[var(--bg-surface-raised)] transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

function FollowUpChips({ chips, onPick }: { chips: string[]; onPick: (s: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {chips.slice(0, 4).map(c => (
        <button
          key={c}
          onClick={() => onPick(c)}
          className="px-3 py-1.5 bg-[var(--bg-surface-raised)] border border-[var(--border)] rounded-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors"
        >
          {c}
        </button>
      ))}
    </div>
  );
}
