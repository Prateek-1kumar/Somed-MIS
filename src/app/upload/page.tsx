'use client';
import { useState } from 'react';
import Link from 'next/link';
import { upload } from '@vercel/blob/client';
import { CheckCircle2, History } from 'lucide-react';
import UploadZone from '@/components/UploadZone';
import { incrementDataVersion } from '@/lib/persistence';
import { CSV_COLUMNS } from '@/lib/schema';
import { ErrorBanner } from '@/components/ui/ErrorBanner';

interface UploadRecord {
  yyyymm: string;
  rows: number;
  date: string;
}

type UploadStep = 'idle' | 'validating' | 'uploading' | 'ingesting' | 'done' | 'error';

const EXPECTED_HEADER = CSV_COLUMNS.join(',');

function makeStagingPath(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `data/staging/${ts}-${rand}.csv`;
}

function StepIndicator({ step }: { step: UploadStep }) {
  const steps = [
    { id: 'validating', label: 'Validating columns' },
    { id: 'uploading', label: 'Uploading to staging' },
    { id: 'ingesting', label: 'Ingesting into database' },
  ] as const;
  const currentIdx = steps.findIndex(s => s.id === step);
  const doneIdx = step === 'done' ? steps.length : currentIdx;

  return (
    <div className="flex flex-wrap items-center gap-2 my-4">
      {steps.map((s, i) => {
        const isDone = i < doneIdx;
        const isCurrent = i === doneIdx;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                isDone
                  ? 'bg-[var(--accent)] text-white'
                  : isCurrent
                    ? 'bg-[var(--accent-light)] text-[var(--accent)] border-2 border-[var(--accent)]'
                    : 'bg-[var(--bg-surface-raised)] text-[var(--text-muted)] border border-[var(--border)]'
              }`}
            >
              {isDone ? '✓' : i + 1}
            </div>
            <span
              className={`text-xs ${
                isCurrent
                  ? 'text-[var(--text-primary)] font-semibold'
                  : 'text-[var(--text-muted)]'
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div
                className={`w-8 h-0.5 ${
                  isDone ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function UploadPage() {
  const [pendingCsv, setPendingCsv] = useState<string | null>(null);
  const [pendingYyyymm, setPendingYyyymm] = useState('');
  const [pendingRows, setPendingRows] = useState(0);
  const [step, setStep] = useState<UploadStep>('idle');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [doneStats, setDoneStats] = useState<{ rowsAdded: number; totalRows: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [history, setHistory] = useState<UploadRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem('uploadHistory') || '[]');
    } catch {
      return [];
    }
  });

  const isBusy = step === 'uploading' || step === 'ingesting';

  const resetUpload = () => {
    setUploadError(null);
    setStep('idle');
    setUploadProgress(null);
  };

  const handleConfirm = async () => {
    if (!pendingCsv) return;
    setStep('validating');
    setUploadProgress(null);
    setUploadError(null);
    setDoneStats(null);
    try {
      // 1. Upload CSV directly to Vercel Blob via signed token.
      setStep('uploading');
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
      setStep('ingesting');
      const res = await fetch('/api/data/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blobUrl: blob.url }),
      });
      const json = (await res.json()) as {
        rowsAdded?: number;
        totalRows?: number;
        error?: string;
      };
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
      setStep('done');
      setPendingCsv(null);
    } catch (e) {
      setUploadError(String(e));
      setStep('error');
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Upload Data</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Append a CSV. Existing rows for the same yyyymm period will be replaced.
        </p>
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-6 shadow-[var(--shadow-card)]">
        <UploadZone
          onValidated={(csv, validation) => {
            setPendingCsv(csv);
            setPendingYyyymm(validation.yyyymm);
            setPendingRows(validation.totalRows);
            setStep('idle');
            setDoneStats(null);
            setUploadError(null);
          }}
        />

        {pendingCsv && step !== 'done' && (
          <>
            {(isBusy || step === 'validating') && <StepIndicator step={step} />}
            <div className="mt-6 pt-6 border-t border-[var(--border)] flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setPendingCsv(null);
                  setUploadError(null);
                  setStep('idle');
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={isBusy}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {step === 'ingesting'
                  ? 'Ingesting into Postgres…'
                  : step === 'uploading'
                    ? uploadProgress !== null
                      ? `Uploading… ${Math.round(uploadProgress)}%`
                      : 'Preparing upload…'
                    : 'Confirm & Append'}
              </button>
            </div>
          </>
        )}

        {uploadError && (
          <div className="mt-5">
            <ErrorBanner error={uploadError} onRetry={resetUpload} />
          </div>
        )}

        {step === 'done' && doneStats && (
          <div className="mt-5 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-6 flex items-start gap-4">
            <div className="w-10 h-10 rounded-2xl bg-[var(--accent)] text-white flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">Data uploaded</h3>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {doneStats.rowsAdded.toLocaleString()} rows added ·{' '}
                {doneStats.totalRows.toLocaleString()} total
              </p>
              <Link
                href="/"
                className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors"
              >
                View Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-12">
          <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <History className="w-4 h-4 text-[var(--text-muted)]" />
            Upload History
          </h2>
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-[var(--shadow-card)]">
            {history.map((h, i) => (
              <div
                key={i}
                className={`flex items-center justify-between px-5 py-4 ${
                  i < history.length - 1 ? 'border-b border-[var(--border)]' : ''
                } ${i % 2 === 1 ? 'bg-[var(--bg-surface-raised)]' : ''}`}
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{h.date}</span>
                  <span className="text-xs text-[var(--text-muted)]">Period: {h.yyyymm}</span>
                </div>
                <span className="px-2.5 py-1 bg-[var(--accent-light)] text-[var(--accent)] rounded-full text-xs font-semibold">
                  {h.rows.toLocaleString()} rows
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
