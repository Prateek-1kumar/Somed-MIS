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
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-zinc-300 rounded-lg p-12 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
      >
        <p className="text-zinc-500 text-sm">Drop CSV here or click to browse</p>
        <input ref={inputRef} type="file" accept=".csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {validation && (
        <div className="mt-4 space-y-1 text-sm">
          <p className="text-green-700">✅ {CSV_COLUMNS.length} columns match expected schema</p>
          <p className="text-green-700">✅ {validation.totalRows} rows detected (yyyymm = {validation.yyyymm})</p>
          {validation.blankHqCount > 0 && (
            <p className="text-amber-600">⚠️ {validation.blankHqCount} rows have blank hq_new — review before appending</p>
          )}
        </div>
      )}
    </div>
  );
}
