'use client';
import { useState, useRef, useEffect } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import ReportTable from '@/components/ReportTable';
import ReportChart from '@/components/ReportChart';
import ExportMenu from '@/components/ExportMenu';

function ResultBlock({ rows }: { rows: Record<string, unknown>[] }) {
  const chartRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex flex-col gap-4 mt-2 p-4 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-sm">
      <div className="flex justify-between items-center mb-2 pb-2 border-b border-[var(--border)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Results</h3>
        <ExportMenu rows={rows} chartRef={chartRef} filename="chat-result" />
      </div>
      <div className="max-h-[320px] overflow-auto rounded-lg border border-[var(--border)]">
        <ReportTable rows={rows} />
      </div>
      <div ref={chartRef} className="pt-2">
        <ReportChart rows={rows} chartType="bar" />
      </div>
    </div>
  );
}

interface Message {
  id: number;
  role: 'user' | 'ai';
  text?: string;
  sql?: string;
  explanation?: string;
  clarify?: string;
  confirmed?: boolean;
  rows?: Record<string, unknown>[];
  ran?: boolean;
  error?: string;
}

const SUGGESTIONS = [
  'Top 5 brands by secondary sales for FY 2025-26',
  'Segment-wise expense % for FY 2024-25',
  'Monthly primary sales trend for NEURO segment',
  'HQ-wise achievement % this year',
];

export default function ChatPage() {
  const { query, ready } = useDuckDb();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [refineInputs, setRefineInputs] = useState<Record<number, string>>({});
  const [showRefine, setShowRefine] = useState<Record<number, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async (question?: string) => {
    const q = (question ?? input).trim();
    if (!q || loading) return;
    setInput('');
    setMessages(prev => [...prev, { id: ++msgIdRef.current, role: 'user', text: q }]);
    setLoading(true);
    try {
      const res = await fetch('/api/nl-to-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json() as { sql?: string; explanation?: string; clarify?: string; error?: string };
      setMessages(prev => [...prev, {
        id: ++msgIdRef.current,
        role: 'ai',
        sql: data.sql,
        explanation: data.explanation,
        clarify: data.clarify,
        error: data.error,
        confirmed: false,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, { id: ++msgIdRef.current, role: 'ai', error: String(e) }]);
    } finally {
      setLoading(false);
    }
  };

  const confirm = async (msgId: number) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg?.sql) return;
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, confirmed: true } : m));
    try {
      const rows = await query(msg.sql);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rows, ran: true, error: undefined } : m));
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, confirmed: false, error: String(e) } : m));
    }
  };

  const refine = async (msgId: number) => {
    const instruction = refineInputs[msgId]?.trim();
    const msg = messages.find(m => m.id === msgId);
    if (!instruction || !msg?.sql) return;
    setLoading(true);
    try {
      const res = await fetch('/api/refine-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentSql: msg.sql, instruction, reportTitle: 'Chat' }),
      });
      const data = await res.json() as { sql?: string; explanation?: string; clarify?: string; error?: string };
      if (data.error) {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, error: data.error } : m));
        return;
      }
      setRefineInputs(prev => ({ ...prev, [msgId]: '' }));
      setShowRefine(prev => ({ ...prev, [msgId]: false }));
      setMessages(prev => prev.map(m =>
        m.id === msgId
          ? { ...m, sql: data.sql ?? m.sql, explanation: data.explanation ?? m.explanation, clarify: data.clarify, confirmed: false, rows: undefined, ran: false }
          : m
      ));
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, error: String(e) } : m));
    } finally {
      setLoading(false);
    }
  };

  const saveSql = async (sql: string) => {
    const name = prompt('Name this report:');
    if (!name) return;
    try {
      const res = await fetch('/api/blob/queries');
      const existing = (await res.json()) as unknown[];
      const updated = [...existing, { id: Date.now(), name, sql, chartType: 'bar', created: new Date().toISOString() }];
      await fetch('/api/blob/queries', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queries: updated }) });
    } catch (e) {
      alert('Failed to save: ' + String(e));
    }
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full p-4 sm:p-6 pb-0">
      {/* Header */}
      <div className="border-b border-[var(--border)] pb-4 mb-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Chat with your data</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Ask anything — I'll show my calculation plan before fetching results.</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-6 pb-6 pr-2 scrollbar-thin scrollbar-thumb-[var(--border-strong)]">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 mt-8 opacity-70">
            <div className="w-16 h-16 rounded-2xl bg-[var(--bg-surface-raised)] flex items-center justify-center mb-6 shadow-sm border border-[var(--border)]">
              <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <h3 className="text-lg font-medium text-[var(--text-primary)]">Ask anything about your sales data</h3>
            <p className="text-sm text-[var(--text-muted)] mt-2 max-w-sm">I'll explain my calculation approach and wait for your confirmation before fetching results.</p>
            <div className="flex flex-wrap gap-2 justify-center mt-6 max-w-lg">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* User message */}
            {msg.role === 'user' && (
              <div className="flex justify-end w-full">
                <div className="bg-[var(--text-primary)] text-[var(--bg-surface)] rounded-2xl rounded-tr-sm px-4 py-2.5 text-[15px] max-w-[85%] sm:max-w-[75%] shadow-sm leading-relaxed">
                  {msg.text}
                </div>
              </div>
            )}

            {/* AI message */}
            {msg.role === 'ai' && (
              <div className="flex items-start gap-3 w-full max-w-[95%] sm:max-w-[90%]">
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-[var(--bg-surface-raised)] border border-[var(--border)] flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <svg className="w-4 h-4 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                </div>

                <div className="flex-1 space-y-3 min-w-0">
                  {/* Error */}
                  {msg.error && (
                    <div className="bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl p-3.5 text-sm">
                      {msg.error}
                    </div>
                  )}

                  {/* Clarify */}
                  {msg.clarify && (
                    <div className="bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-xl p-3.5 text-sm">
                      <span className="font-semibold">Need clarification: </span>{msg.clarify}
                    </div>
                  )}

                  {/* Calculation Plan Card (shown before confirmation) */}
                  {msg.sql && msg.explanation && !msg.confirmed && (
                    <div className="bg-[var(--bg-surface)] border border-[var(--accent)] rounded-xl shadow-sm overflow-hidden">
                      {/* Plan Header */}
                      <div className="bg-[var(--bg-surface-raised)] border-b border-[var(--border)] px-4 py-3 flex items-center gap-2">
                        <svg className="w-4 h-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                        </svg>
                        <span className="text-sm font-semibold text-[var(--text-primary)]">Calculation Plan</span>
                        <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Awaiting confirmation</span>
                      </div>

                      {/* Explanation */}
                      <div className="px-4 py-3.5">
                        <p className="text-sm text-[var(--text-primary)] leading-relaxed">{msg.explanation}</p>
                      </div>

                      {/* SQL preview (collapsible) */}
                      <details className="border-t border-[var(--border)]">
                        <summary className="px-4 py-2 text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] select-none">
                          View generated SQL
                        </summary>
                        <pre className="px-4 pb-3 text-[12px] font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap leading-relaxed">
                          {msg.sql}
                        </pre>
                      </details>

                      {/* Actions */}
                      <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-surface-raised)]/40 flex flex-wrap gap-2 items-center">
                        <button
                          onClick={() => confirm(msg.id)}
                          disabled={!ready}
                          className="flex items-center gap-1.5 px-4 py-2 bg-[var(--text-primary)] text-[var(--bg-surface)] rounded-lg text-[13px] font-semibold shadow-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/>
                          </svg>
                          Confirm & Fetch Data
                        </button>
                        <button
                          onClick={() => setShowRefine(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                          className="flex items-center gap-1.5 px-4 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[13px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                          </svg>
                          Refine
                        </button>
                      </div>

                      {/* Refine Input */}
                      {showRefine[msg.id] && (
                        <div className="px-4 pb-3 border-t border-[var(--border)] pt-3 flex gap-2">
                          <input
                            type="text"
                            value={refineInputs[msg.id] ?? ''}
                            onChange={e => setRefineInputs(prev => ({ ...prev, [msg.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') refine(msg.id); }}
                            placeholder="e.g. use net secondary instead of gross, filter to NEURO segment..."
                            className="flex-1 text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-muted)]"
                          />
                          <button
                            onClick={() => refine(msg.id)}
                            className="px-3 py-2 bg-[var(--text-primary)] text-[var(--bg-surface)] rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
                          >
                            Apply
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* After confirmation — show explanation summary + action buttons */}
                  {msg.sql && msg.confirmed && (
                    <div className="space-y-3">
                      {msg.explanation && (
                        <div className="px-3 py-2 bg-[var(--bg-surface-raised)] rounded-lg text-xs text-[var(--text-muted)] border border-[var(--border)]">
                          {msg.explanation}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => confirm(msg.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                          </svg>
                          Re-run
                        </button>
                        {msg.ran && (
                          <button
                            onClick={() => msg.sql && saveSql(msg.sql)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            Save Report
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Results */}
                  {msg.ran && msg.rows && (
                    <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                      <ResultBlock rows={msg.rows} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start w-full mt-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-surface-raised)] border border-[var(--border)] flex items-center justify-center shrink-0 shadow-sm">
                <svg className="w-4 h-4 text-[var(--text-muted)] animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <div className="bg-[var(--bg-surface-raised)] text-[var(--text-secondary)] px-4 py-2.5 rounded-2xl rounded-tl-sm text-[14px] flex gap-2 items-center font-medium">
                Thinking
                <span className="flex gap-0.5 ml-1">
                  <span className="w-1 h-1 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-1 h-1 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-1 h-1 bg-[var(--text-muted)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} className="h-4 shrink-0" />
      </div>

      {/* Input Bar */}
      <div className="shrink-0 border-t border-[var(--border)] pt-4 pb-6 bg-gradient-to-t from-[var(--bg-base)] via-[var(--bg-base)] to-transparent sticky bottom-0 z-10">
        <div className="relative shadow-sm rounded-xl">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask anything about your data… (Enter to send)"
            rows={1}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl pl-4 pr-14 py-3.5 text-[15px] focus:outline-none focus:border-[var(--text-muted)] focus:ring-1 focus:ring-[var(--text-muted)] resize-none overflow-hidden max-h-[150px] shadow-sm transition-all"
            style={{ minHeight: '52px', height: input ? `${Math.min(150, Math.max(52, input.split('\n').length * 24 + 28))}px` : '52px' }}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="absolute right-2.5 bottom-[11px] p-1.5 rounded-lg bg-[var(--text-primary)] text-[var(--bg-surface)] enabled:hover:opacity-90 disabled:opacity-30 transition-all cursor-pointer shadow-sm"
          >
            <svg className="w-5 h-5 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19V5m0 0l-6 6m6-6l6 6"/>
            </svg>
          </button>
        </div>
        <p className="text-center text-[11px] text-[var(--text-muted)] mt-3">
          AI will show its calculation plan — you confirm before data is fetched.
        </p>
      </div>
    </div>
  );
}
