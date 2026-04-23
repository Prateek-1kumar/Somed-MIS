interface Props {
  rows: Record<string, unknown>[];
}

function cellColor(key: string, val: unknown): React.CSSProperties {
  if (key === 'achievement_pct' && typeof val === 'number') {
    if (val < 80) return { color: 'var(--danger)', fontWeight: 600 };
    if (val < 95) return { color: 'var(--warning)', fontWeight: 600 };
    return { color: 'var(--success)', fontWeight: 600 };
  }
  return {};
}

function fmt(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return val.toLocaleString('en-IN');
    return val.toFixed(2);
  }
  return String(val);
}

export default function ReportTable({ rows }: Props) {
  if (!rows.length) return (
    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
      No data found for the selected filters.
    </div>
  );
  const cols = Object.keys(rows[0]);
  return (
    <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-surface-raised)', position: 'sticky', top: 0, zIndex: 1 }}>
            {cols.map(c => (
              <th key={c} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>
                {c.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-surface-raised)' }}>
              {cols.map(c => (
                <td key={c} style={{ padding: '9px 14px', whiteSpace: 'nowrap', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', ...cellColor(c, row[c]) }}>
                  {fmt(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '8px 14px', fontSize: '12px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface)', borderTop: '1px solid var(--border)' }}>
        {rows.length.toLocaleString('en-IN')} rows
      </div>
    </div>
  );
}
