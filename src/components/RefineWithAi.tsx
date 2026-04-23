'use client';
import { useState } from 'react';

interface Props {
  currentSql: string;
  reportTitle: string;
  onApply: (sql: string) => Promise<void> | void;
}

interface Turn {
  instruction: string;
  sql?: string;
  clarify?: string;
  error?: string;
  applied?: boolean;
}

export default function RefineWithAi({ currentSql, reportTitle, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const prompt = instruction.trim();
    if (!prompt) return;
    setBusy(true);
    // Each refinement is built on top of whatever SQL is currently running —
    // either the latest applied refinement or the editor's SQL.
    const baseSql = turns.find(t => t.applied)?.sql ?? currentSql;
    const turn: Turn = { instruction: prompt };
    setTurns(prev => [...prev, turn]);
    setInstruction('');
    try {
      const res = await fetch('/api/refine-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentSql: baseSql, instruction: prompt, reportTitle }),
      });
      const data = await res.json() as { sql?: string; clarify?: string; error?: string };
      if (!res.ok || data.error) {
        setTurns(prev => prev.map(t => t === turn ? { ...t, error: data.error ?? `HTTP ${res.status}` } : t));
      } else {
        setTurns(prev => prev.map(t => t === turn ? { ...t, sql: data.sql, clarify: data.clarify } : t));
      }
    } catch (e) {
      setTurns(prev => prev.map(t => t === turn ? { ...t, error: String(e) } : t));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (idx: number) => {
    const t = turns[idx];
    if (!t.sql) return;
    await onApply(t.sql);
    setTurns(prev => prev.map((x, i) => i === idx ? { ...x, applied: true } : { ...x, applied: false }));
  };

  const discard = (idx: number) => {
    setTurns(prev => prev.filter((_, i) => i !== idx));
  };

  const reset = () => setTurns([]);

  const hasContent = turns.length > 0;

  return (
    <div style={{ marginTop: '16px', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)',
          backgroundColor: 'var(--bg-surface-raised)', border: 'none', cursor: 'pointer',
          borderBottom: open ? '1px solid var(--border)' : 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', padding: '1px 5px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border)', color: '#7c3aed' }}>AI</span>
          Refine with AI
          {hasContent && (
            <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', color: 'var(--text-muted)' }}>{turns.length} turn{turns.length === 1 ? '' : 's'}</span>
          )}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{open ? '▲ HIDE' : '▼ SHOW'}</span>
      </button>
      {open && (
        <div style={{ padding: '12px', backgroundColor: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {turns.map((t, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', backgroundColor: 'var(--bg-base)' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: t.sql || t.clarify || t.error ? '8px' : 0 }}>
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'var(--accent-light)', color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.04em', flexShrink: 0 }}>YOU</span>
                <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>{t.instruction}</p>
              </div>
              {t.clarify && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', backgroundColor: '#fef3c7', color: '#92400e', fontWeight: 700, letterSpacing: '0.04em', flexShrink: 0 }}>AI</span>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5, fontStyle: 'italic' }}>{t.clarify}</p>
                </div>
              )}
              {t.error && (
                <p style={{ fontSize: '12px', color: 'var(--danger)', margin: 0 }}>Error: {t.error}</p>
              )}
              {t.sql && (
                <div>
                  <pre style={{
                    fontSize: '11px', fontFamily: 'var(--font-geist-mono, monospace)', backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', margin: 0, marginBottom: '8px',
                    overflowX: 'auto', whiteSpace: 'pre-wrap', color: 'var(--text-primary)', lineHeight: 1.5,
                  }}>{t.sql}</pre>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {t.applied ? (
                      <span style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '6px', backgroundColor: '#dcfce7', color: '#166534', fontWeight: 600 }}>✓ Applied</span>
                    ) : (
                      <>
                        <button onClick={() => apply(i)} style={{ padding: '4px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer', backgroundColor: 'var(--accent)', color: 'white' }}>Apply</button>
                        <button onClick={() => discard(i)} style={{ padding: '4px 12px', fontSize: '12px', fontWeight: 500, borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border)', backgroundColor: 'transparent', color: 'var(--text-secondary)' }}>Discard</button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {!t.sql && !t.error && !t.clarify && (
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Thinking…</p>
              )}
            </div>
          ))}

          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !busy) send(); }}
              placeholder="e.g. only top 10 by net_primary, or sort by zbm"
              style={{
                flex: 1, padding: '8px 10px', fontSize: '13px', borderRadius: '6px',
                border: '1px solid var(--border)', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
            <button
              onClick={send}
              disabled={busy || !instruction.trim()}
              style={{
                padding: '8px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '6px',
                border: 'none', cursor: (busy || !instruction.trim()) ? 'not-allowed' : 'pointer',
                backgroundColor: '#7c3aed', color: 'white', opacity: (busy || !instruction.trim()) ? 0.5 : 1,
              }}
            >{busy ? 'Asking…' : 'Ask AI'}</button>
            {hasContent && (
              <button onClick={reset} style={{ padding: '8px 12px', fontSize: '12px', fontWeight: 500, borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>Clear</button>
            )}
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
            Apply to run against your data. Then use the Query Editor below to tweak further or Save override.
          </p>
        </div>
      )}
    </div>
  );
}
