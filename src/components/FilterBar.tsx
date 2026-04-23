'use client';
import { Filters } from '@/lib/schema';

const FYS = ['2022-2023','2023-2024','2024-2025','2025-2026','2026-2027'];
const ZBMS = ['All','RBM WEST','ZBM EAST','ZBM MP'];
const SEGS = ['All','ABX','GASTRO','GYNAE','NEURO','ORTHO','WELLNESS'];
const QTRS = ['All','1','2','3','4'];

const selectStyle: React.CSSProperties = {
  padding: '5px 28px 5px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
  border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)',
  cursor: 'pointer', outline: 'none',
};

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  show?: (keyof Filters)[];
}

export default function FilterBar({ filters, onChange, show }: Props) {
  const sel = (key: keyof Filters, val: string) =>
    onChange({ ...filters, [key]: val === 'All' ? undefined : val });

  const visible = show ?? ['fy', 'zbm', 'seg', 'qtr'];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '4px' }}>Filters</span>
      {visible.includes('fy') && (
        <select value={filters.fy ?? 'All'} onChange={e => sel('fy', e.target.value)} style={selectStyle}>
          <option value="All">All FY</option>
          {FYS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      )}
      {visible.includes('zbm') && (
        <select value={filters.zbm ?? 'All'} onChange={e => sel('zbm', e.target.value)} style={selectStyle}>
          {ZBMS.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
      )}
      {visible.includes('seg') && (
        <select value={filters.seg ?? 'All'} onChange={e => sel('seg', e.target.value)} style={selectStyle}>
          {SEGS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      {visible.includes('qtr') && (
        <select value={filters.qtr ?? 'All'} onChange={e => sel('qtr', e.target.value)} style={selectStyle}>
          {QTRS.map(q => <option key={q} value={q}>{q === 'All' ? 'All Qtrs' : `Q${q}`}</option>)}
        </select>
      )}
    </div>
  );
}
