interface Props {
  onRefresh: () => void;
  onRefreshAll: () => void;
}

export default function StaleBanner({ onRefresh, onRefreshAll }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', marginBottom: '16px',
      backgroundColor: '#fefce8', border: '1px solid #fde047', borderRadius: '8px',
      fontSize: '13px', color: '#854d0e',
    }}>
      <span style={{ fontSize: '16px' }}>⚠</span>
      <span style={{ flex: 1, fontWeight: 500 }}>New data available — these results are from the previous dataset.</span>
      <button onClick={onRefresh} style={{ fontSize: '13px', fontWeight: 600, color: '#92400e', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Refresh This</button>
      <button onClick={onRefreshAll} style={{ fontSize: '13px', fontWeight: 600, color: '#92400e', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Refresh All</button>
    </div>
  );
}
