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
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Query Results</h3>
        <ExportMenu rows={rows} chartRef={chartRef} filename="chat-result" />
      </div>
      <div className="max-h-[300px] overflow-auto rounded-lg border border-[var(--border)]">
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
  clarify?: string;
  rows?: Record<string, unknown>[];
  ran?: boolean;
  error?: string;
}

export default function ChatPage() {
  const { query } = useDuckDb();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    const question = input.trim();
    if (!question || loading) return;
    setInput('');
    const userMsg: Message = { id: Date.now(), role: 'user', text: question };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    try {
      const res = await fetch('/api/nl-to-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await res.json() as { sql?: string; clarify?: string; error?: string };
      const aiMsg: Message = { id: Date.now() + 1, role: 'ai', sql: data.sql, clarify: data.clarify, error: data.error };
      setMessages(prev => [...prev, aiMsg]);
    } catch (e) {
      const aiMsg: Message = { id: Date.now() + 1, role: 'ai', error: String(e) };
      setMessages(prev => [...prev, aiMsg]);
    } finally {
      setLoading(false);
    }
  };

  const runSql = async (msgId: number, sql: string) => {
    try {
      const rows = await query(sql);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rows, ran: true, error: undefined } : m));
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, error: String(e) } : m));
    }
  };

  const editSql = (msgId: number, sql: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, sql, ran: false } : m));
  };

  const saveSql = async (sql: string) => {
    const name = prompt('Name this report:');
    if (!name) return;
    try {
      const res = await fetch('/api/blob/queries');
      const existing = (await res.json()) as unknown[];
      const updated = [...existing, { id: Date.now(), name, sql, chartType: 'bar' as const, created: new Date().toISOString() }];
      await fetch('/api/blob/queries', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queries: updated }) });
    } catch (e) {
      alert('Failed to save: ' + String(e));
    }
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full p-4 sm:p-6 pb-0">
      <div className="border-b border-[var(--border)] pb-4 mb-4 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Chat with your data</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Ask questions in natural language to query and visualize data.</p>
        </div>
        <div className="hidden sm:flex p-2 bg-[var(--bg-surface-raised)] rounded-lg text-[var(--text-muted)]">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-6 pb-6 pr-2 scrollbar-thin scrollbar-thumb-[var(--border-strong)]">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 mt-12 opacity-70">
            <div className="w-16 h-16 rounded-2xl bg-[var(--bg-surface-raised)] flex items-center justify-center mb-6 shadow-sm border border-[var(--border)]">
              <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
            </div>
            <h3 className="text-lg font-medium text-[var(--text-primary)]">How can I help you analyze today?</h3>
            <div className="flex flex-wrap gap-2 justify-center mt-6 max-w-lg">
              <button onClick={() => setInput("Show me the top 5 reports by sales")} className="px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)] transition-colors">"Top 5 reports by sales"</button>
              <button onClick={() => setInput("Give me a breakdown of users active this month")} className="px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)] transition-colors">"Breakdown of users active this month"</button>
              <button onClick={() => setInput("Compare Q1 vs Q2 metrics")} className="px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)] transition-colors">"Compare Q1 vs Q2 metrics"</button>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {msg.role === 'user' && (
              <div className="flex justify-end w-full">
                <div className="bg-[var(--text-primary)] text-[var(--bg-surface)] rounded-2xl rounded-tr-sm px-4 py-2.5 text-[15px] max-w-[85%] sm:max-w-[75%] shadow-sm leading-relaxed">
                  {msg.text}
                </div>
              </div>
            )}
            
            {msg.role === 'ai' && (
              <div className="flex flex-col gap-3 w-full max-w-[95%] sm:max-w-[85%] mt-2">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[var(--bg-surface-raised)] border border-[var(--border)] flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                    <svg className="w-4 h-4 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  
                  <div className="flex-1 space-y-3 min-w-0">
                    {msg.error && (
                      <div className="bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded-xl p-3.5 text-sm flex gap-3 shadow-sm">
                        <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="leading-relaxed font-medium">{msg.error}</span>
                      </div>
                    )}
                    
                    {msg.clarify && (
                      <div className="bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 rounded-xl p-3.5 text-sm flex gap-3 shadow-sm">
                        <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="leading-relaxed font-medium">{msg.clarify}</span>
                      </div>
                    )}
                    
                    {msg.sql && (
                      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-sm overflow-hidden flex flex-col group transition-colors hover:border-[var(--text-muted)]">
                        <div className="bg-[var(--bg-surface-raised)] border-b border-[var(--border)] px-4 py-2.5 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                            <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Generated SQL</span>
                          </div>
                          {!msg.ran && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Unverified</span>
                          )}
                        </div>
                        
                        <textarea
                          value={msg.sql}
                          onChange={e => editSql(msg.id, e.target.value)}
                          spellCheck={false}
                          className="w-full min-h-[140px] resize-y p-4 text-[13px] font-mono bg-transparent text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--border-strong)] leading-relaxed"
                        />
                        
                        <div className="bg-[var(--bg-surface-raised)]/40 border-t border-[var(--border)] p-3 flex flex-wrap gap-2.5 items-center">
                          <button 
                            onClick={() => runSql(msg.id, msg.sql!)} 
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors ${msg.ran ? 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)]' : 'bg-[var(--text-primary)] text-[var(--bg-surface)] shadow-sm'}`}
                          >
                            {msg.ran ? (
                              <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> Re-run Query</>
                            ) : (
                              <><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4l12 6-12 6z"/></svg> Run Query</>
                            )}
                          </button>
                          
                          {msg.ran && (
                            <button 
                              onClick={() => saveSql(msg.sql!)} 
                              className="flex items-center gap-1.5 px-4 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-[13px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors shadow-sm"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                              Save Report
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {msg.ran && msg.rows && (
                      <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                        <ResultBlock rows={msg.rows} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        
        {loading && (
          <div className="flex justify-start w-full mt-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-surface-raised)] border border-[var(--border)] flex items-center justify-center shrink-0 shadow-sm">
                <svg className="w-4 h-4 text-[var(--text-muted)] animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              </div>
              <div className="bg-[var(--bg-surface-raised)] text-[var(--text-secondary)] px-4 py-2.5 rounded-2xl rounded-tl-sm text-[14px] flex gap-2 items-center font-medium">
                Generating SQL
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
            placeholder="Ask anything about your data..."
            rows={1}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl pl-4 pr-14 py-3.5 text-[15px] focus:outline-none focus:border-[var(--text-muted)] focus:ring-1 focus:ring-[var(--text-muted)] resize-none overflow-hidden max-h-[150px] shadow-sm transition-all"
            style={{ 
              minHeight: '52px', 
              height: input ? `${Math.min(150, Math.max(52, input.split('\n').length * 24 + 28))}px` : '52px'
            }}
          />
          <button 
            onClick={send} 
            disabled={loading || !input.trim()} 
            className="absolute right-2.5 bottom-4.5 p-1.5 rounded-lg bg-[var(--text-primary)] text-[var(--bg-surface)] enabled:hover:opacity-90 disabled:opacity-30 disabled:bg-[var(--border-strong)] transition-all cursor-pointer shadow-sm flex items-center justify-center"
            title="Send (Enter)"
          >
            <svg className="w-5 h-5 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19V5m0 0l-6 6m6-6l6 6" /></svg>
          </button>
        </div>
        <p className="text-center text-[11px] text-[var(--text-muted)] mt-3">
          AI generated SQL can contain mistakes. Verify before execution.
        </p>
      </div>
    </div>
  );
}
