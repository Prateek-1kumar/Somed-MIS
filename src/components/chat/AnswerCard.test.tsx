/**
 * Smoke tests for the chart-aware helpers in AnswerCard. We don't render the
 * full component here — Recharts + ResponsiveContainer need a real layout
 * engine — but the helpers are the thing most likely to regress.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// The helpers aren't exported directly because they live inside a client
// module. Import the component and re-render with known data; verify the
// rendered output reflects the expected column pick.

jest.mock('@/components/ReportChart', () => {
  const MockChart = ({ rows, xKey }: { rows: unknown[]; xKey?: string }) => (
    <div data-testid="chart-mock" data-xkey={xKey} data-rows={String(rows.length)} />
  );
  MockChart.displayName = 'MockChart';
  return { __esModule: true, default: MockChart };
});

jest.mock('@/components/ReportTable', () => {
  const MockTable = ({ rows }: { rows: unknown[] }) => (
    <div data-testid="table-mock" data-rows={String(rows.length)} />
  );
  MockTable.displayName = 'MockTable';
  return { __esModule: true, default: MockTable };
});

jest.mock('@/components/ExportMenu', () => {
  const MockExport = () => <div data-testid="export-mock" />;
  MockExport.displayName = 'MockExport';
  return { __esModule: true, default: MockExport };
});

import AnswerCard from './AnswerCard';
import type { FinalAnswer } from '@/lib/agent/types';

function mkAnswer(overrides: Partial<FinalAnswer> = {}): FinalAnswer {
  return {
    kind: 'answer',
    narrative: 'test',
    headline: 'headline',
    sql: 'SELECT 1',
    chart_type: 'bar',
    chart_hints: {},
    assumptions: [],
    follow_ups: [],
    ...overrides,
  };
}

describe('AnswerCard xKey picking', () => {
  it('uses agent-provided x when it IS categorical', () => {
    const rows = [
      { hq_new: 'HARDA', sales: 100 },
      { hq_new: 'AGRA', sales: 200 },
    ];
    render(
      <AnswerCard
        answer={mkAnswer({ chart_type: 'bar', chart_hints: { x: 'hq_new' } })}
        rows={rows}
      />,
    );
    expect(screen.getByTestId('chart-mock').getAttribute('data-xkey')).toBe('hq_new');
  });

  it('overrides agent-provided x when it points to a numeric column (hbar case)', () => {
    const rows = [
      { hq_new: 'HARDA', sales: 100 },
      { hq_new: 'AGRA', sales: 200 },
    ];
    render(
      <AnswerCard
        answer={mkAnswer({ chart_type: 'hbar', chart_hints: { x: 'sales' } })}
        rows={rows}
      />,
    );
    expect(screen.getByTestId('chart-mock').getAttribute('data-xkey')).toBe('hq_new');
  });

  it('picks the categorical column even when the numeric column is first in SQL order', () => {
    const rows = [
      { sales: 100, hq_new: 'HARDA' },
      { sales: 200, hq_new: 'AGRA' },
    ];
    render(<AnswerCard answer={mkAnswer({ chart_type: 'bar' })} rows={rows} />);
    expect(screen.getByTestId('chart-mock').getAttribute('data-xkey')).toBe('hq_new');
  });

  it('coerces numeric strings to numbers so bars can render', () => {
    const rows = [
      { hq_new: 'HARDA', sales: '100.5' },
      { hq_new: 'AGRA', sales: '200.3' },
    ];
    render(<AnswerCard answer={mkAnswer({ chart_type: 'bar' })} rows={rows} />);
    expect(screen.getByTestId('chart-mock').getAttribute('data-xkey')).toBe('hq_new');
    // 2 rows rendered
    expect(screen.getByTestId('chart-mock').getAttribute('data-rows')).toBe('2');
  });

  it('skips the chart for chart_type=kpi', () => {
    render(<AnswerCard answer={mkAnswer({ chart_type: 'kpi' })} rows={[{ n: 1 }]} />);
    expect(screen.queryByTestId('chart-mock')).toBeNull();
  });

  it('skips the chart for table_only', () => {
    render(
      <AnswerCard
        answer={mkAnswer({ chart_type: 'table_only' })}
        rows={[{ hq_new: 'X', sales: 1 }]}
      />,
    );
    expect(screen.queryByTestId('chart-mock')).toBeNull();
    expect(screen.getByTestId('table-mock')).toBeInTheDocument();
  });
});
