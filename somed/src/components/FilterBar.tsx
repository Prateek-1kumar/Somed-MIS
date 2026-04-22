'use client';
import { Filters } from '@/lib/schema';

const FYS = ['2022-2023','2023-2024','2024-2025','2025-2026','2026-2027'];
const ZBMS = ['All','RBM WEST','ZBM EAST','ZBM MP'];
const SEGS = ['All','ABX','GASTRO','GYNAE','NEURO','ORTHO','WELLNESS'];
const QTRS = ['All','1','2','3','4'];

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  show?: (keyof Filters)[];
}

export default function FilterBar({ filters, onChange, show }: Props) {
  const sel = (key: keyof Filters, val: string) =>
    onChange({ ...filters, [key]: val === 'All' ? undefined : val });

  const visible = show ?? ['fy','zbm','seg','qtr'];

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {visible.includes('fy') && (
        <select value={filters.fy ?? 'All'} onChange={e => sel('fy', e.target.value)}
          className="border border-zinc-300 rounded px-2 py-1 text-sm">
          <option>All FY</option>
          {FYS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      )}
      {visible.includes('zbm') && (
        <select value={filters.zbm ?? 'All'} onChange={e => sel('zbm', e.target.value)}
          className="border border-zinc-300 rounded px-2 py-1 text-sm">
          {ZBMS.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
      )}
      {visible.includes('seg') && (
        <select value={filters.seg ?? 'All'} onChange={e => sel('seg', e.target.value)}
          className="border border-zinc-300 rounded px-2 py-1 text-sm">
          {SEGS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      {visible.includes('qtr') && (
        <select value={filters.qtr ?? 'All'} onChange={e => sel('qtr', e.target.value)}
          className="border border-zinc-300 rounded px-2 py-1 text-sm">
          {QTRS.map(q => <option key={q} value={q}>{q === 'All' ? 'All Qtrs' : `Q${q}`}</option>)}
        </select>
      )}
    </div>
  );
}
