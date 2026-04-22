'use client';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ChartType } from '@/reports';

const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

interface Props {
  rows: Record<string, unknown>[];
  chartType: ChartType;
  xKey?: string;
  valueKeys?: string[];
}

export default function ReportChart({ rows, chartType, xKey, valueKeys }: Props) {
  if (!rows.length || chartType === 'table-only') return null;
  const cols = Object.keys(rows[0]);
  const xk = xKey ?? cols[0];
  const vks = valueKeys ?? cols.filter(c => c !== xk && typeof rows[0][c] === 'number').slice(0, 4);

  if (chartType === 'pie') {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie data={rows} dataKey={vks[0]} nameKey={xk} cx="50%" cy="50%" outerRadius={100} label>
            {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip /><Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={xk} /><YAxis /><Tooltip /><Legend />
          {vks.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i]} dot={false} />)}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // bar and stacked-bar
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={xk} /><YAxis /><Tooltip /><Legend />
        {vks.map((k, i) => <Bar key={k} dataKey={k} fill={COLORS[i]} stackId={chartType === 'stacked-bar' ? 'stack' : undefined} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}
