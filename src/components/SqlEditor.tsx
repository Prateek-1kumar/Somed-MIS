'use client';
import { useState } from 'react';

interface Props {
  sql: string;
  onRun: (sql: string) => void;
  onReset?: () => void;
  onSave?: (sql: string) => void;
  onSaveOverride?: (sql: string) => Promise<void> | void;
  onResetOverride?: () => Promise<void> | void;
  isOverridden?: boolean;
  powerBiMode?: boolean;
}

const btnBase: React.CSSProperties = { padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none' };

export default function SqlEditor({ sql, onRun, onReset, onSave, onSaveOverride, onResetOverride, isOverridden, powerBiMode }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(sql);
  const [lastExternalSql, setLastExternalSql] = useState(sql);
  const [savingOverride, setSavingOverride] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  // Sync textarea with sql prop whenever it changes from the parent (initial
  // load, filter change, reset-override). We skip syncing while the editor is
  // open so the user's in-progress edits aren't clobbered. Derived-state
  // pattern: React bails out on the re-render when the condition is false.
  if (sql !== lastExternalSql) {
    setLastExternalSql(sql);
    if (!open) setValue(sql);
  }
  const [pbSql, setPbSql] = useState('');
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const convertPowerBi = async () => {
    setConverting(true);
    setConvertError(null);
    try {
      const res = await fetch('/api/powerbi-to-sql', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: pbSql }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { convertedSql } = await res.json() as { convertedSql: string };
      setValue(convertedSql);
    } catch (e) {
      setConvertError(String(e));
    } finally {
      setConverting(false);
    }
  };

  return (
    <div style={{ marginTop: '16px', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)',
        backgroundColor: 'var(--bg-surface-raised)', border: 'none', cursor: 'pointer',
        borderBottom: open ? '1px solid var(--border)' : 'none',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontFamily: 'monospace', fontSize: '11px', padding: '1px 5px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--accent)' }}>SQL</span>
          Query Editor
          {isOverridden && (
            <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontWeight: 700, letterSpacing: '0.04em' }}>MODIFIED</span>
          )}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{open ? '▲ HIDE' : '▼ SHOW'}</span>
      </button>
      {open && (
        <div style={{ padding: '12px', backgroundColor: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            style={{
              width: '100%', height: '140px', resize: 'vertical', padding: '10px', fontSize: '12px',
              fontFamily: 'var(--font-geist-mono, monospace)', borderRadius: '6px',
              border: '1px solid var(--border)', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)',
              outline: 'none', lineHeight: 1.6,
            }}
          />
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => onRun(value)} style={{ ...btnBase, backgroundColor: 'var(--accent)', color: 'white' }}>▶ Run</button>
            {onReset && (
              <button onClick={() => { setValue(sql); onReset(); }} style={{ ...btnBase, backgroundColor: 'var(--bg-surface-raised)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>↺ Reset</button>
            )}
            {onSaveOverride && (
              <button
                onClick={async () => {
                  setSavingOverride(true);
                  setOverrideError(null);
                  try { await onSaveOverride(value); } catch (e) { setOverrideError(String(e)); }
                  finally { setSavingOverride(false); }
                }}
                disabled={savingOverride}
                style={{ ...btnBase, backgroundColor: '#16a34a', color: 'white', opacity: savingOverride ? 0.6 : 1 }}
              >{savingOverride ? 'Saving…' : '💾 Save override'}</button>
            )}
            {onResetOverride && isOverridden && (
              <button
                onClick={async () => {
                  setOverrideError(null);
                  try { await onResetOverride(); } catch (e) { setOverrideError(String(e)); }
                }}
                style={{ ...btnBase, backgroundColor: 'transparent', color: '#b91c1c', border: '1px solid #fecaca' }}
              >↶ Reset to default</button>
            )}
            {onSave && (
              <button onClick={() => onSave(value)} style={{ ...btnBase, backgroundColor: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>＋ Save as Report</button>
            )}
          </div>
          {overrideError && <p style={{ fontSize: '12px', color: 'var(--danger)', margin: 0 }}>{overrideError}</p>}

          {powerBiMode && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 500 }}>PowerBI SQL Converter — Paste your PowerBI/MSSQL query below:</p>
              <textarea
                value={pbSql}
                onChange={e => setPbSql(e.target.value)}
                placeholder="Paste PowerBI SQL here…"
                style={{
                  width: '100%', height: '80px', resize: 'vertical', padding: '8px', fontSize: '12px',
                  fontFamily: 'var(--font-geist-mono, monospace)', borderRadius: '6px',
                  border: '1px solid var(--border)', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
              <button onClick={convertPowerBi} disabled={!pbSql || converting}
                style={{ ...btnBase, marginTop: '8px', backgroundColor: '#7c3aed', color: 'white', opacity: (!pbSql || converting) ? 0.5 : 1 }}>
                {converting ? 'Converting…' : '⟳ Convert to DuckDB SQL'}
              </button>
              {convertError && <p style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '6px' }}>{convertError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
