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
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border-strong)'}`,
          borderRadius: '10px',
          padding: '48px 32px',
          textAlign: 'center',
          cursor: 'pointer',
          backgroundColor: dragging ? 'var(--bg-accent)' : 'var(--bg-surface)',
          transition: 'all 0.15s ease',
        }}
      >
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>📂</div>
        <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Drop CSV here or click to browse</p>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Accepts .csv files matching the Shomed schema</p>
        <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
      </div>
      {error && <p style={{ marginTop: '8px', fontSize: '13px', color: 'var(--danger)' }}>{error}</p>}
      {validation && (
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <p style={{ fontSize: '13px', color: 'var(--success)', fontWeight: 500 }}>✅ {CSV_COLUMNS.length} columns match expected schema</p>
          <p style={{ fontSize: '13px', color: 'var(--success)', fontWeight: 500 }}>✅ {validation.totalRows} rows detected (yyyymm = {validation.yyyymm})</p>
          {validation.blankHqCount > 0 && (
            <p style={{ fontSize: '13px', color: 'var(--warning)', fontWeight: 500 }}>⚠️ {validation.blankHqCount} rows have blank hq_new — review before appending</p>
          )}
        </div>
      )}
    </div>
  );
}
