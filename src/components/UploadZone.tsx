'use client';
import { useRef, useState } from 'react';
import Papa from 'papaparse';
import { Upload, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { CSV_COLUMNS, validateCsvRow } from '@/lib/schema';
import { ErrorBanner } from '@/components/ui/ErrorBanner';

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

  const reset = () => {
    setError(null);
    setValidation(null);
  };

  const processFile = (file: File) => {
    setError(null);
    setValidation(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      complete: results => {
        const rows = results.data.filter(r => Object.values(r).some(v => v.trim()));
        if (!rows.length) {
          setError('File is empty');
          return;
        }
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
      error: e => setError(e.message),
    });
  };

  const dropzoneClass = [
    'rounded-xl text-center cursor-pointer transition-all px-8 py-14 flex flex-col items-center justify-center gap-3',
    dragging
      ? 'border-2 border-dashed border-[var(--accent)] bg-[var(--accent-soft)]'
      : 'border-2 border-dashed border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-raised)]',
  ].join(' ');

  return (
    <div className="flex flex-col w-full">
      <div
        onDragOver={e => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) processFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={dropzoneClass}
      >
        <div
          className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${
            dragging
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[var(--bg-surface-raised)] text-[var(--text-secondary)] border border-[var(--border)]'
          }`}
        >
          <Upload className="w-6 h-6" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Click to upload{' '}
            <span className="text-[var(--text-muted)] font-normal">or drag and drop</span>
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            CSV files matching the Shomed schema ({CSV_COLUMNS.length} columns)
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) processFile(f);
          }}
        />
      </div>

      {error && (
        <div className="mt-4">
          <ErrorBanner error={error} onRetry={reset} />
        </div>
      )}

      {validation && (
        <div className="mt-5 space-y-2">
          <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--accent-soft)] border border-[var(--accent)]/20 rounded-lg">
            <CheckCircle2 className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <p className="text-xs text-[var(--text-primary)] font-medium">
              <span className="text-[var(--accent)] font-semibold">
                {CSV_COLUMNS.length} columns verified
              </span>{' '}
              with strict schema match
            </p>
          </div>

          <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-surface-raised)] border border-[var(--border)] rounded-lg">
            <FileSpreadsheet className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
            <p className="text-xs text-[var(--text-primary)]">
              <span className="font-semibold">{validation.totalRows.toLocaleString()}</span> valid
              rows detected · Period:{' '}
              <span className="font-semibold">{validation.yyyymm}</span>
            </p>
          </div>

          {validation.blankHqCount > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <p className="text-xs text-[var(--text-primary)]">
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  {validation.blankHqCount} rows
                </span>{' '}
                have missing{' '}
                <code className="bg-[var(--bg-surface)] px-1 py-0.5 rounded text-[11px]">
                  hq_new
                </code>{' '}
                — please review before confirming.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
