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
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-zinc-800 mb-6">Monthly Data Upload</h1>
      <UploadZone onValidated={(csv, validation) => {
        setPendingCsv(csv);
        setPendingYyyymm(validation.yyyymm);
        setPendingRows(validation.totalRows);
        setDone(false);
        setUploadError(null);
      }} />
      {pendingCsv && !done && (
        <div className="mt-4 flex gap-3">
          <button onClick={handleConfirm} disabled={uploading}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
            {uploading ? 'Appending…' : 'Confirm & Append'}
          </button>
          <button onClick={() => { setPendingCsv(null); setUploadError(null); }}
            className="px-4 py-2 border border-zinc-300 rounded text-sm hover:bg-zinc-50">Cancel</button>
        </div>
      )}
      {uploadError && <p className="mt-3 text-sm text-red-600">{uploadError}</p>}
      {done && <p className="mt-4 text-sm text-green-700">✅ Data appended successfully. All reports marked for refresh.</p>}
      {history.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-zinc-600 mb-2">Upload History</h2>
          <div className="space-y-1">
            {history.map((h, i) => (
              <div key={i} className="text-sm text-zinc-500">{h.date} — {h.rows} rows (yyyymm: {h.yyyymm})</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
