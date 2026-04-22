'use client';
import { useState } from 'react';
import UploadZone from '@/components/UploadZone';
import { useDuckDb } from '@/lib/DuckDbContext';
import { incrementDataVersion } from '@/lib/persistence';

interface UploadRecord { yyyymm: string; rows: number; date: string; }

export default function UploadPage() {
  const { reload } = useDuckDb();
  const [pendingCsv, setPendingCsv] = useState<string | null>(null);
  const [pendingYyyymm, setPendingYyyymm] = useState('');
  const [pendingRows, setPendingRows] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [history, setHistory] = useState<UploadRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem('uploadHistory') || '[]'); } catch { return []; }
  });

  const handleConfirm = async () => {
    if (!pendingCsv) return;
    setUploading(true);
    setUploadError(null);
    try {
      const existingRes = await fetch('/api/blob/read');
      if (!existingRes.ok) throw new Error(`Failed to read existing data: ${existingRes.status}`);
      const existing = await existingRes.text();
      const hasExisting = existing.trim().length > 0;
      // Strip header row from new CSV when appending to existing data
      const newLines = pendingCsv.split(/\r?\n/);
      const newDataLines = hasExisting ? newLines.slice(1).join('\n') : pendingCsv;
      const accumulated = hasExisting ? `${existing.trimEnd()}\n${newDataLines}` : pendingCsv;
      const appendRes = await fetch('/api/blob/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accumulatedCsv: accumulated }),
      });
      if (!appendRes.ok) throw new Error(await appendRes.text());
      await reload(accumulated);
      incrementDataVersion();
      const record: UploadRecord = { yyyymm: pendingYyyymm, rows: pendingRows, date: new Date().toLocaleDateString('en-IN') };
      const updated = [record, ...history].slice(0, 10);
      setHistory(updated);
      localStorage.setItem('uploadHistory', JSON.stringify(updated));
      setDone(true);
      setPendingCsv(null);
    } catch (e) {
      setUploadError(String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ maxWidth: '640px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '24px' }}>Monthly Data Upload</h1>
      <UploadZone onValidated={(csv, validation) => {
        setPendingCsv(csv);
        setPendingYyyymm(validation.yyyymm);
        setPendingRows(validation.totalRows);
        setDone(false);
        setUploadError(null);
      }} />
      {pendingCsv && !done && (
        <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
          <button onClick={handleConfirm} disabled={uploading} style={{
            padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            border: 'none', backgroundColor: 'var(--accent)', color: 'white',
            opacity: uploading ? 0.5 : 1,
          }}>
            {uploading ? 'Appending…' : 'Confirm & Append'}
          </button>
          <button onClick={() => { setPendingCsv(null); setUploadError(null); }} style={{
            padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)',
          }}>Cancel</button>
        </div>
      )}
      {uploadError && <p style={{ marginTop: '12px', fontSize: '13px', color: 'var(--danger)' }}>{uploadError}</p>}
      {done && <p style={{ marginTop: '16px', fontSize: '13px', color: 'var(--success)', fontWeight: 500 }}>✅ Data appended successfully. All reports marked for refresh.</p>}
      {history.length > 0 && (
        <div style={{ marginTop: '32px' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Upload History</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {history.map((h, i) => (
              <div key={i} style={{ fontSize: '13px', color: 'var(--text-secondary)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>{h.date} — {h.rows} rows (yyyymm: {h.yyyymm})</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
