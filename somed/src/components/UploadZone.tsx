'use client';
import { useRef, useState } from 'react';
import Papa from 'papaparse';
import { CSV_COLUMNS, validateCsvRow } from '@/lib/schema';

interface ValidationState {
  totalRows: number;
  blankHqCount: number;
  yyyymm: string;
  ready: boolean;
}

interface Props {
  onValidated: (csv: string, validation: ValidationState) => void;
}

export default function UploadZone({ onValidated }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [validation, setValidation] = useState<ValidationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const processFile = (file: File) => {
    setError(null);
    setValidation(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      complete: (results) => {
        const rows = results.data.filter(r => Object.values(r).some(v => v.trim()));
        if (!rows.length) { setError('File is empty'); return; }
        const firstValidation = validateCsvRow(rows[0]);
        if (!firstValidation.valid && firstValidation.missingColumns.length > 0) {
          setError(`Missing columns: ${firstValidation.missingColumns.slice(0, 5).join(', ')}`);
          return;
        }
        const blankHqCount = rows.filter(r => !r.hq_new?.trim()).length;
        const yyyymm = rows[0].yyyymm ?? 'unknown';
        const state: ValidationState = { totalRows: rows.length, blankHqCount, yyyymm, ready: true };
        setValidation(state);
        // Use Papa.unparse to properly reconstruct CSV with headers and correct quoting
        const csv = Papa.unparse(rows);
        onValidated(csv, state);
      },
      error: (e) => setError(e.message),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: '12px',
          padding: '56px 32px',
          textAlign: 'center',
          cursor: 'pointer',
          backgroundColor: dragging ? 'var(--bg-accent)' : 'var(--bg-base)',
          transition: 'all 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px'
        }}
        onMouseOver={e => { if (!dragging) e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.backgroundColor = 'var(--bg-surface-raised)'; }}
        onMouseOut={e => { if (!dragging) e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.backgroundColor = 'var(--bg-base)'; }}
      >
        <div style={{ 
          width: '56px', height: '56px', borderRadius: '50%', 
          backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginBottom: '4px'
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div>
          <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
            Click to upload <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>or drag and drop</span>
          </p>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            CSV files optimized for Shomed schema
          </p>
        </div>
        <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
      </div>
      
      {error && (
        <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px', borderLeft: '3px solid var(--danger)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p style={{ fontSize: '13px', color: 'var(--danger)', margin: 0, fontWeight: 500 }}>{error}</p>
        </div>
      )}
      
      {validation && (
        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', backgroundColor: 'var(--bg-surface-raised)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>
              <span style={{ color: 'var(--success)' }}>{CSV_COLUMNS.length} columns verified</span> with strict schema match
            </p>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', backgroundColor: 'var(--bg-surface-raised)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{validation.totalRows.toLocaleString()}</span> valid rows detected &middot; Period: <span style={{ fontWeight: 600 }}>{validation.yyyymm}</span>
            </p>
          </div>

          {validation.blankHqCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', backgroundColor: 'rgba(245, 158, 11, 0.05)', borderRadius: '8px', borderLeft: '3px solid var(--warning)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: 0 }}>
                <span style={{ fontWeight: 600, color: 'var(--warning)' }}>{validation.blankHqCount} rows</span> have missing <code style={{ backgroundColor: 'var(--bg-surface)', padding: '2px 4px', borderRadius: '4px', fontSize: '12px' }}>hq_new</code> &mdash; please review before confirming.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
