'use client';
import { useState } from 'react';
import { upload } from '@vercel/blob/client';
import UploadZone from '@/components/UploadZone';
import { incrementDataVersion } from '@/lib/persistence';
import { CSV_COLUMNS } from '@/lib/schema';

interface UploadRecord { yyyymm: string; rows: number; date: string; }

const EXPECTED_HEADER = CSV_COLUMNS.join(',');

function makeStagingPath(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `data/staging/${ts}-${rand}.csv`;
}

export default function UploadPage() {
  const [pendingCsv, setPendingCsv] = useState<string | null>(null);
  const [pendingYyyymm, setPendingYyyymm] = useState('');
  const [pendingRows, setPendingRows] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [done, setDone] = useState(false);
  const [doneStats, setDoneStats] = useState<{ rowsAdded: number; totalRows: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [history, setHistory] = useState<UploadRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem('uploadHistory') || '[]'); } catch { return []; }
  });

  const handleConfirm = async () => {
    if (!pendingCsv) return;
    setUploading(true);
    setUploadProgress(null);
    setUploadError(null);
    setDoneStats(null);
    try {
      // 1. Upload CSV directly to Vercel Blob via signed token.
      const stagingPath = makeStagingPath();
      const blob = await upload(stagingPath, pendingCsv, {
        access: 'public',
        contentType: 'text/csv',
        handleUploadUrl: '/api/blob/upload-token',
        multipart: true,
        clientPayload: JSON.stringify({ header: EXPECTED_HEADER }),
        onUploadProgress: ({ percentage }) => setUploadProgress(percentage),
      });

      // 2. Trigger server-side ingest. Server reads the blob, two-stage COPYs
      // into Postgres, deletes the staging blob, returns row counts.
      setIngesting(true);
      const res = await fetch('/api/data/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blobUrl: blob.url }),
      });
      const json = await res.json() as { rowsAdded?: number; totalRows?: number; error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error ?? `ingest failed: ${res.status}`);
      }

      // 3. Invalidate cached report results so dashboard / reports re-query.
      incrementDataVersion();

      const record: UploadRecord = {
        yyyymm: pendingYyyymm,
        rows: pendingRows,
        date: new Date().toLocaleDateString('en-IN'),
      };
      const updated = [record, ...history].slice(0, 10);
      setHistory(updated);
      localStorage.setItem('uploadHistory', JSON.stringify(updated));
      setDoneStats({ rowsAdded: json.rowsAdded ?? 0, totalRows: json.totalRows ?? 0 });
      setDone(true);
      setPendingCsv(null);
    } catch (e) {
      setUploadError(String(e));
    } finally {
      setUploading(false);
      setIngesting(false);
    }
  };

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '8px' }}>
          Monthly Data Upload
        </h1>
        <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Upload your latest CSV. Re-uploading a month replaces that period&apos;s rows; new months are appended.
        </p>
      </div>

      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)'
      }}>
        <UploadZone onValidated={(csv, validation) => {
          setPendingCsv(csv);
          setPendingYyyymm(validation.yyyymm);
          setPendingRows(validation.totalRows);
          setDone(false);
          setDoneStats(null);
          setUploadError(null);
        }} />

        {pendingCsv && !done && (
          <div style={{
            marginTop: '24px',
            paddingTop: '24px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '12px'
          }}>
            <button onClick={() => { setPendingCsv(null); setUploadError(null); }} style={{
              padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              border: '1px solid var(--border)', backgroundColor: 'transparent', color: 'var(--text-primary)',
              transition: 'all 0.15s ease'
            }}
            onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--bg-surface-raised)'}
            onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              Cancel
            </button>
            <button onClick={handleConfirm} disabled={uploading || ingesting} style={{
              padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              border: '1px solid var(--accent)', backgroundColor: 'var(--accent)', color: 'var(--text-inverse)',
              opacity: (uploading || ingesting) ? 0.7 : 1, transition: 'all 0.15s ease',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
            onMouseOver={e => { if (!uploading && !ingesting) e.currentTarget.style.backgroundColor = 'var(--accent-hover)' }}
            onMouseOut={e => e.currentTarget.style.backgroundColor = 'var(--accent)'}
            >
              {ingesting
                ? 'Ingesting into Postgres…'
                : uploading
                  ? (uploadProgress !== null ? `Uploading… ${Math.round(uploadProgress)}%` : 'Preparing upload…')
                  : 'Confirm & Append'}
            </button>
          </div>
        )}

        {uploadError && (
          <div style={{ marginTop: '20px', padding: '12px 16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', borderRadius: '8px' }}>
            <p style={{ fontSize: '14px', color: 'var(--danger)', fontWeight: 500, margin: 0 }}>{uploadError}</p>
          </div>
        )}

        {done && doneStats && (
          <div style={{ marginTop: '20px', padding: '16px', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--success)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '20px' }}>✅</span>
            <p style={{ fontSize: '14px', color: 'var(--success)', fontWeight: 600, margin: 0 }}>
              Ingested {doneStats.rowsAdded.toLocaleString()} new rows. Total in database: {doneStats.totalRows.toLocaleString()}.
            </p>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div style={{ marginTop: '48px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            Upload History
          </h2>
          <div style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            overflow: 'hidden'
          }}>
            {history.map((h, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: i < history.length - 1 ? '1px solid var(--border)' : 'none',
                backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--bg-surface-raised)'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>{h.date}</span>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Period: {h.yyyymm}</span>
                </div>
                <div style={{
                  padding: '4px 10px',
                  backgroundColor: 'var(--bg-accent)',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-secondary)'
                }}>
                  {h.rows.toLocaleString()} rows
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
