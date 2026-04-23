'use client';
import { useState } from 'react';
import Papa from 'papaparse';
import { upload } from '@vercel/blob/client';
import UploadZone from '@/components/UploadZone';
import { useDuckDb } from '@/lib/DuckDbContext';
import { incrementDataVersion } from '@/lib/persistence';
import { CSV_COLUMNS } from '@/lib/schema';

interface UploadRecord { yyyymm: string; rows: number; date: string; }

const EXPECTED_HEADER = CSV_COLUMNS.join(',');

function firstLine(text: string): string {
  const nl = text.search(/\r?\n/);
  return (nl === -1 ? text : text.slice(0, nl)).replace(/^﻿/, '').trim();
}

function collectYyyymm(csv: string): Set<string> {
  const set = new Set<string>();
  Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    step: (result) => {
      const yy = (result.data.yyyymm ?? '').toString().trim();
      if (yy) set.add(yy);
    },
  });
  return set;
}

// Remove rows whose yyyymm is in the set, returning a CSV with the same header.
// Used to make uploads replace-by-period: re-uploading a month's data drops the
// old copy rather than appending a duplicate.
function dropRowsByYyyymm(csv: string, yyyymmSet: Set<string>): string {
  if (yyyymmSet.size === 0) return csv;
  const kept: Record<string, string>[] = [];
  Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    step: (result) => {
      const yy = (result.data.yyyymm ?? '').toString().trim();
      if (!yyyymmSet.has(yy)) kept.push(result.data);
    },
  });
  return Papa.unparse(kept, { columns: [...CSV_COLUMNS] });
}

export default function UploadPage() {
  const { reload } = useDuckDb();
  const [pendingCsv, setPendingCsv] = useState<string | null>(null);
  const [pendingYyyymm, setPendingYyyymm] = useState('');
  const [pendingRows, setPendingRows] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [done, setDone] = useState(false);
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
    try {
      const existingRes = await fetch('/api/blob/read');
      if (!existingRes.ok) throw new Error(`Failed to read existing data: ${existingRes.status}`);
      const existing = await existingRes.text();
      const hasExistingBytes = existing.trim().length > 0;
      // Refuse to append to data with a mismatched schema — that would produce a
      // broken CSV that DuckDB can't parse. Server also validates in the
      // upload-token handler; client check surfaces the problem early.
      if (hasExistingBytes && firstLine(existing) !== EXPECTED_HEADER) {
        throw new Error('The stored dataset has a different schema than this upload. Contact an admin to reset the data store before uploading.');
      }
      // Replace-by-period: drop any rows in the existing blob whose yyyymm
      // appears in the new upload before concatenating. Without this, uploading
      // the same month twice doubles that period's rows; this also heals a
      // blob that's already been doubled by prior re-uploads.
      const newYyyymm = collectYyyymm(pendingCsv);
      const filteredExisting = hasExistingBytes ? dropRowsByYyyymm(existing, newYyyymm) : '';
      const hasFiltered = filteredExisting.trim().length > 0;
      const newLines = pendingCsv.split(/\r?\n/);
      const newDataLines = hasFiltered ? newLines.slice(1).join('\n') : pendingCsv;
      const accumulated = hasFiltered ? `${filteredExisting.trimEnd()}\n${newDataLines}` : pendingCsv;

      // Direct browser-to-Vercel-Blob upload. Vercel serverless functions cap
      // request bodies at 4.5 MB, so we can't POST the full CSV through an API
      // route. upload() fetches a short-lived token from /api/blob/upload-token
      // and streams the body straight to blob storage in multipart parts.
      await upload('accumulated.csv', accumulated, {
        access: 'private',
        contentType: 'text/csv',
        handleUploadUrl: '/api/blob/upload-token',
        multipart: true,
        clientPayload: JSON.stringify({ header: EXPECTED_HEADER }),
        onUploadProgress: ({ percentage }) => setUploadProgress(percentage),
      });

      // Blob is now the source of truth — data is persisted regardless of what
      // happens next. Record the upload history and invalidate caches.
      incrementDataVersion();
      const record: UploadRecord = { yyyymm: pendingYyyymm, rows: pendingRows, date: new Date().toLocaleDateString('en-IN') };
      const updated = [record, ...history].slice(0, 10);
      setHistory(updated);
      localStorage.setItem('uploadHistory', JSON.stringify(updated));
      setDone(true);
      setPendingCsv(null);

      // Best-effort: refresh in-memory DuckDB so other pages see new data
      // without a reload. If this fails, the upload still succeeded.
      try {
        await reload(accumulated);
      } catch (reloadErr) {
        setUploadError(`Data saved, but refreshing in-memory DuckDB failed: ${String(reloadErr)}. Reload the page to see the updated data.`);
      }
    } catch (e) {
      setUploadError(String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '8px' }}>
          Monthly Data Upload
        </h1>
        <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Upload your latest CSV data to synchronize and append new records to the database. Ensure the file schema matches the required metrics.
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
            <button onClick={handleConfirm} disabled={uploading} style={{
              padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              border: '1px solid var(--accent)', backgroundColor: 'var(--accent)', color: 'var(--text-inverse)',
              opacity: uploading ? 0.7 : 1, transition: 'all 0.15s ease',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
            onMouseOver={e => { if (!uploading) e.currentTarget.style.backgroundColor = 'var(--accent-hover)' }}
            onMouseOut={e => e.currentTarget.style.backgroundColor = 'var(--accent)'}
            >
              {uploading
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

        {done && (
          <div style={{ marginTop: '20px', padding: '16px', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--success)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '20px' }}>✅</span>
            <p style={{ fontSize: '14px', color: 'var(--success)', fontWeight: 600, margin: 0 }}>
              Data appended successfully. All reports marked for refresh.
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
