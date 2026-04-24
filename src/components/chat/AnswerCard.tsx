'use client';
import React, { useRef } from 'react';
import ReportTable from '@/components/ReportTable';
import ReportChart from '@/components/ReportChart';
import ExportMenu from '@/components/ExportMenu';
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

function KpiBlock({ headline, narrative }: { headline: string; narrative: string }) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="text-4xl sm:text-5xl font-bold tracking-tight text-[var(--text-primary)]">
        {headline}
      </div>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{narrative}</p>
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
  const showChart = rows && rows.length > 0 && mappedChartType !== 'table-only' && answer.chart_type !== 'kpi';
  const showTable = rows && rows.length > 0 && answer.chart_type !== 'kpi';

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
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            {answer.narrative}
          </p>
        </div>
      )}

      {rowsError && (
        <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
          Browser-side query failed: {rowsError}. The server-side answer above should still be correct.
        </div>
      )}

      {showChart && (
        <div ref={chartRef} className="pt-2">
          <ReportChart
            rows={rows!}
            chartType={mappedChartType as LegacyChartType}
            xKey={answer.chart_hints?.x}
          />
        </div>
      )}

      {showTable && (
        <div className="max-h-[320px] overflow-auto rounded-lg border border-[var(--border)]">
          <ReportTable rows={rows!} />
        </div>
      )}

      {answer.assumptions.length > 0 && (
        <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          <span className="font-semibold text-[var(--text-secondary)]">Assumptions:</span>{' '}
          {answer.assumptions.join(' · ')}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
          <span className="text-[11px] text-[var(--text-muted)]">
            {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}
          </span>
          <ExportMenu rows={rows} chartRef={chartRef} filename="chat-answer" />
        </div>
      )}
    </div>
  );
}
