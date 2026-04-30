'use client';
import React, { useRef } from 'react';
import ReportTable from '@/components/ReportTable';
import ReportChart from '@/components/ReportChart';
import ExportMenu from '@/components/ExportMenu';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Markdown } from '@/components/ui/Markdown';
import type { ChartType as LegacyChartType } from '@/reports';
import type { FinalAnswer } from '@/lib/agent/types';

function mapChartType(t: FinalAnswer['chart_type']): LegacyChartType | 'kpi' {
  switch (t) {
    case 'line':        return 'line';
    case 'bar':         return 'bar';
    case 'hbar':        return 'bar';
    case 'pie':         return 'pie';
    case 'stacked_bar': return 'stacked-bar';
    case 'kpi':         return 'kpi';
    case 'table_only':  return 'table-only';
    default:            return 'table-only';
  }
}

/** A value is "numeric" if it's a number, bigint, or a numeric string. */
function isNumericLike(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number' || typeof v === 'bigint') return true;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return false;
    return !isNaN(Number(trimmed));
  }
  return false;
}

/**
 * Pick the best categorical column for the x-axis. Agents sometimes put
 * the numeric column in chart_hints.x (especially for hbar), and sometimes
 * the SQL puts the numeric column first. This function always picks the
 * first column whose values are predominantly non-numeric.
 */
function pickCategoricalX(
  rows: Record<string, unknown>[],
  preferred?: string,
): string | undefined {
  if (rows.length === 0) return preferred;
  const cols = Object.keys(rows[0]);
  const sample = rows.slice(0, 10);

  function isCategorical(col: string): boolean {
    const numericCount = sample.filter(r => isNumericLike(r[col])).length;
    return numericCount < sample.length / 2;
  }

  // If the preferred column is actually categorical, trust the agent.
  if (preferred && cols.includes(preferred) && isCategorical(preferred)) {
    return preferred;
  }
  // Otherwise, find the first column whose values are mostly non-numeric.
  const categorical = cols.find(isCategorical);
  return categorical ?? cols[0];
}

/**
 * Coerce numeric strings in rows to real numbers so Recharts can plot them.
 * Avoids mutating the caller's rows.
 */
function coerceNumericStrings(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (rows.length === 0) return rows;
  const cols = Object.keys(rows[0]);
  const sample = rows.slice(0, 10);
  const numericCols = cols.filter(col => {
    const samples = sample.map(r => r[col]);
    if (samples.some(v => typeof v === 'number')) return false; // already numeric
    const parseable = samples.filter(v => isNumericLike(v)).length;
    return parseable >= samples.length / 2 && parseable > 0;
  });
  if (numericCols.length === 0) return rows;
  return rows.map(r => {
    const out: Record<string, unknown> = { ...r };
    for (const col of numericCols) {
      const v = out[col];
      if (typeof v === 'string' && isNumericLike(v)) {
        out[col] = Number(v);
      } else if (typeof v === 'bigint') {
        out[col] = Number(v);
      }
    }
    return out;
  });
}

function KpiBlock({ headline, narrative }: { headline: string; narrative: string }) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="text-4xl sm:text-5xl font-bold tracking-tight text-[var(--text-primary)]">
        {headline}
      </div>
      {narrative && (
        <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
          <Markdown>{narrative}</Markdown>
        </div>
      )}
    </div>
  );
}

interface Props {
  answer: FinalAnswer;
  rows: Record<string, unknown>[] | null;
  rowsError?: string;
}

export default function AnswerCard({ answer, rows, rowsError }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const mappedChartType = mapChartType(answer.chart_type);
  const coercedRows = React.useMemo(
    () => (rows ? coerceNumericStrings(rows) : null),
    [rows],
  );
  const xKey = React.useMemo(
    () => (coercedRows ? pickCategoricalX(coercedRows, answer.chart_hints?.x) : undefined),
    [coercedRows, answer.chart_hints?.x],
  );
  const showChart = coercedRows && coercedRows.length > 0 && mappedChartType !== 'table-only' && answer.chart_type !== 'kpi';
  const showTable = coercedRows && coercedRows.length > 0 && answer.chart_type !== 'kpi';

  return (
    <div className="flex flex-col gap-4 mt-2 p-4 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-sm">
      {/* Headline + narrative — KPI style when chart_type=kpi, otherwise compact */}
      {answer.chart_type === 'kpi' ? (
        <KpiBlock headline={answer.headline} narrative={answer.narrative} />
      ) : (
        <div className="flex flex-col gap-1.5">
          {answer.headline && (
            <p className="text-base font-semibold text-[var(--text-primary)] leading-snug">
              {answer.headline}
            </p>
          )}
          {answer.narrative && (
            <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
              <Markdown>{answer.narrative}</Markdown>
            </div>
          )}
        </div>
      )}

      {answer.sql && (
        <CodeBlock code={answer.sql} language="sql" />
      )}

      {rowsError && (
        <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
          Browser-side query failed: {rowsError}. The server-side answer above should still be correct.
        </div>
      )}

      {showChart && (
        <div ref={chartRef} className="pt-2">
          <ReportChart
            rows={coercedRows!}
            chartType={mappedChartType as LegacyChartType}
            xKey={xKey}
          />
        </div>
      )}

      {showTable && (
        <div className="max-h-[320px] overflow-auto rounded-lg border border-[var(--border)]">
          <ReportTable rows={coercedRows!} />
        </div>
      )}

      {answer.assumptions.length > 0 && (
        <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          <span className="font-semibold text-[var(--text-secondary)]">Assumptions:</span>{' '}
          {answer.assumptions.join(' · ')}
        </div>
      )}

      {coercedRows && coercedRows.length > 0 && (
        <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
          <span className="text-[11px] text-[var(--text-muted)]">
            {coercedRows.length.toLocaleString()} row{coercedRows.length === 1 ? '' : 's'}
          </span>
          <ExportMenu rows={coercedRows} chartRef={chartRef} filename="chat-answer" />
        </div>
      )}
    </div>
  );
}
