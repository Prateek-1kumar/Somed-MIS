interface Props {
  label: string;
  value: string | number;
  sub?: string;
  alert?: boolean;
}

export default function KpiCard({ label, value, sub, alert }: Props) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      borderRadius: '10px',
      border: `1px solid ${alert ? 'var(--danger)' : 'var(--border)'}`,
      padding: '16px 20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    }}>
      <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>{label}</p>
      <p style={{ fontSize: '24px', fontWeight: 700, color: alert ? 'var(--danger)' : 'var(--text-primary)', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{sub}</p>}
    </div>
  );
}
