'use client';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ChartType } from '@/reports';

// A sophisticated, modern palette (indigo, emerald, amber, rose, purples)
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6'];

// Number formatter for concise readable numbers
const formatValue = (value: number) => {
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + 'B';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(2) + 'K';
  if (value % 1 !== 0) return value.toFixed(2);
  return value.toString();
};

interface Props {
  rows: Record<string, unknown>[];
  chartType: ChartType;
  xKey?: string;
  valueKeys?: string[];
}

// Custom tooltip renderer for a modern look
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] shadow-md rounded-lg p-3 text-sm min-w-[120px]">
        <p className="font-semibold text-[var(--text-primary)] mb-2 pb-2 border-b border-[var(--border)]">{label}</p>
        <div className="flex flex-col gap-1.5">
          {payload.map((entry: any, index: number) => (
            <div key={`item-${index}`} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-[var(--text-secondary)]">{entry.name}</span>
              </div>
              <span className="font-medium text-[var(--text-primary)]">
                {typeof entry.value === 'number' ? formatValue(entry.value) : entry.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export default function ReportChart({ rows, chartType, xKey, valueKeys }: Props) {
  if (!rows.length || chartType === 'table-only') return null;
  const cols = Object.keys(rows[0]);
  const xk = xKey ?? cols[0];
  const vks = valueKeys ?? cols.filter(c => c !== xk && typeof rows[0][c] === 'number').slice(0, 4);

  // Standard elegant axis parameters
  const axisProps = {
    tick: { fill: 'var(--text-muted)', fontSize: 12 },
    tickLine: false,
    axisLine: false,
  };

  if (chartType === 'pie') {
    return (
      <div className="w-full h-[350px] pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie 
              data={rows} 
              dataKey={vks[0]} 
              nameKey={xk} 
              cx="50%" 
              cy="50%" 
              innerRadius={70}
              outerRadius={110} 
              paddingAngle={2}
              labelLine={false}
            >
              {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} className="stroke-[var(--bg-surface)] stroke-2" />)}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              iconType="circle" 
              wrapperStyle={{ fontSize: '13px', color: 'var(--text-secondary)', paddingTop: '20px' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chartType === 'line') {
    return (
      <div className="w-full h-[350px] pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
            <XAxis dataKey={xk} {...axisProps} dy={10} minTickGap={30} />
            <YAxis {...axisProps} dx={-10} tickFormatter={formatValue} />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, strokeDasharray: '4 4' }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: '13px', paddingTop: '10px' }} />
            {vks.map((k, i) => (
              <Line 
                key={k} 
                type="monotone" 
                dataKey={k} 
                stroke={COLORS[i % COLORS.length]} 
                strokeWidth={3}
                dot={{ r: 4, strokeWidth: 2, fill: 'var(--bg-surface)' }}
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // bar and stacked-bar
  return (
    <div className="w-full h-[350px] pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
          <XAxis dataKey={xk} {...axisProps} dy={10} minTickGap={30} />
          <YAxis {...axisProps} dx={-10} tickFormatter={formatValue} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--bg-surface-raised)', opacity: 0.5 }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: '13px', paddingTop: '10px' }} />
          {vks.map((k, i) => (
            <Bar 
              key={k} 
              dataKey={k} 
              fill={COLORS[i % COLORS.length]} 
              stackId={chartType === 'stacked-bar' ? 'stack' : undefined}
              radius={chartType === 'stacked-bar' ? [0, 0, 0, 0] : [4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
