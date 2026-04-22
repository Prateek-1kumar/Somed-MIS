'use client';
import { useState, useRef, useEffect } from 'react';
import { useDuckDb } from '@/lib/DuckDbContext';
import ReportTable from '@/components/ReportTable';
import ReportChart from '@/components/ReportChart';
import ExportMenu from '@/components/ExportMenu';

function ResultBlock({ rows }: { rows: Record<string, unknown>[] }) {
  const chartRef = useRef<HTMLDivElement>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>Chat with your data</h1>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '16px' }}>
        {messages.map(msg => (
          <div key={msg.id}>
            {msg.role === 'user' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ backgroundColor: 'var(--accent)', color: 'white', borderRadius: '10px', padding: '10px 16px', fontSize: '14px', maxWidth: '480px' }}>{msg.text}</div>
              </div>
            )}
            {msg.role === 'ai' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {msg.error && (
                  <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--danger)', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: 'var(--danger)' }}>
                    {msg.error}
                  </div>
                )}
                {msg.clarify && (
                  <div style={{ backgroundColor: '#fefce8', border: '1px solid #fde047', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: '#854d0e' }}>
                    {msg.clarify}
                  </div>
                )}
                {msg.sql && (
                  <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px' }}>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 500 }}>Generated SQL — verify before running:</p>
                    <textarea
                      value={msg.sql}
                      onChange={e => editSql(msg.id, e.target.value)}
                      style={{
                        width: '100%', height: '112px', resize: 'vertical', padding: '8px', fontSize: '12px',
                        fontFamily: 'var(--font-geist-mono, monospace)', borderRadius: '6px',
                        border: '1px solid var(--border)', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)',
                        outline: 'none', lineHeight: 1.6,
                      }}
                    />
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                      <button onClick={() => runSql(msg.id, msg.sql!)} style={{
                        padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        border: 'none', backgroundColor: 'var(--accent)', color: 'white',
                      }}>Run ▶</button>
                      <button onClick={() => saveSql(msg.sql!)} style={{
                        padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        border: '1px solid var(--accent)', backgroundColor: 'var(--accent-light)', color: 'var(--accent)',
                      }}>Save as Report</button>
                    </div>
                  </div>
                )}
                {msg.ran && msg.rows && <ResultBlock rows={msg.rows} />}
              </div>
            )}
          </div>
        ))}
        {loading && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Generating SQL…</p>}
        <div ref={bottomRef} />
      </div>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', display: 'flex', gap: '8px' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ask anything about your data…"
          style={{
            flex: 1, borderRadius: '8px', padding: '10px 14px', fontSize: '14px',
            border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        <button onClick={send} disabled={loading || !input.trim()} style={{
          padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
          border: 'none', backgroundColor: 'var(--accent)', color: 'white',
          opacity: (loading || !input.trim()) ? 0.5 : 1,
        }}>Send</button>
      </div>
    </div>
  );
}
