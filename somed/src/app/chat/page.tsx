'use client';
import { useState, useRef, useEffect } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import ReportTable from '@/components/ReportTable';
import ReportChart from '@/components/ReportChart';
import ExportMenu from '@/components/ExportMenu';

function ResultBlock({ rows }: { rows: Record<string, unknown>[] }) {
  const chartRef = useRef<HTMLDivElement>(null);
  return (
    <div className="space-y-2">
      <ReportTable rows={rows} />
      <div ref={chartRef}><ReportChart rows={rows} chartType="bar" /></div>
      <ExportMenu rows={rows} chartRef={chartRef} filename="chat-result" />
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
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-zinc-800 mb-4">Chat with your data</h1>
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map(msg => (
          <div key={msg.id}>
            {msg.role === 'user' && (
              <div className="flex justify-end">
                <div className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm max-w-lg">{msg.text}</div>
              </div>
            )}
            {msg.role === 'ai' && (
              <div className="space-y-2">
                {msg.error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
                    {msg.error}
                  </div>
                )}
                {msg.clarify && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800">
                    {msg.clarify}
                  </div>
                )}
                {msg.sql && (
                  <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3">
                    <p className="text-xs text-zinc-500 mb-1">Generated SQL — verify before running:</p>
                    <textarea
                      value={msg.sql}
                      onChange={e => editSql(msg.id, e.target.value)}
                      className="w-full font-mono text-xs border border-zinc-300 rounded p-2 h-28 resize-y"
                    />
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <button onClick={() => runSql(msg.id, msg.sql!)}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Run ▶</button>
                      <button onClick={() => saveSql(msg.sql!)}
                        className="px-3 py-1 text-xs border border-blue-300 text-blue-700 rounded hover:bg-blue-50">Save as Report</button>
                    </div>
                  </div>
                )}
                {msg.ran && msg.rows && <ResultBlock rows={msg.rows} />}
              </div>
            )}
          </div>
        ))}
        {loading && <p className="text-sm text-zinc-400">Generating SQL…</p>}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-zinc-200 pt-3 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ask anything about your data…"
          className="flex-1 border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button onClick={send} disabled={loading || !input.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">Send</button>
      </div>
    </div>
  );
}
