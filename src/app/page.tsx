// src/app/page.tsx
'use client';
import { useState } from 'react';
import { Filters } from '@/lib/schema';
import OverviewTab from '@/components/dashboard/OverviewTab';
import BrandTab from '@/components/dashboard/BrandTab';
import SegmentTab from '@/components/dashboard/SegmentTab';
import ExpensesTab from '@/components/dashboard/ExpensesTab';
import PrimaryBifurcationTab from '@/components/dashboard/PrimaryBifurcationTab';
import ReturningTab from '@/components/dashboard/ReturningTab';

const FYS = ['2022-2023', '2023-2024', '2024-2025', '2025-2026', '2026-2027'];
const ZBMs = ['', 'RBM WEST', 'ZBM EAST', 'ZBM MP'];
const SEGS = ['', 'ABX', 'GASTRO', 'GYNAE', 'NEURO', 'ORTHO', 'WELLNESS'];

type TabId = 'overview' | 'brand' | 'segment' | 'expenses' | 'primary' | 'returning';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview',   label: 'Overview' },
  { id: 'brand',      label: 'Brand Analysis' },
  { id: 'segment',    label: 'Segment Analysis' },
  { id: 'expenses',   label: 'Expenses' },
  { id: 'primary',    label: 'Primary Bifurcation' },
  { id: 'returning',  label: 'Returning' },
];

const selectCls = 'px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-muted)] cursor-pointer';

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [filters, setFilters] = useState<Filters>({ fy: '2025-2026' });

  const setFilter = (key: keyof Filters, val: string) =>
    setFilters(prev => ({ ...prev, [key]: val || undefined }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Shomed Remedies MIS</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Executive Dashboard</p>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <select value={filters.fy ?? ''} onChange={e => setFilter('fy', e.target.value)} className={selectCls}>
            <option value="">All FYs</option>
            {FYS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={filters.zbm ?? ''} onChange={e => setFilter('zbm', e.target.value)} className={selectCls}>
            {ZBMs.map(z => <option key={z} value={z}>{z || 'All ZBMs'}</option>)}
          </select>
          <select value={filters.seg ?? ''} onChange={e => setFilter('seg', e.target.value)} className={selectCls}>
            {SEGS.map(s => <option key={s} value={s}>{s || 'All Segments'}</option>)}
          </select>
          <button
            onClick={() => setFilters({ fy: '2025-2026' })}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)] transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all -mb-px ${
              activeTab === tab.id
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview'   && <OverviewTab filters={filters} />}
        {activeTab === 'brand'      && <BrandTab filters={filters} />}
        {activeTab === 'segment'    && <SegmentTab filters={filters} />}
        {activeTab === 'expenses'   && <ExpensesTab filters={filters} />}
        {activeTab === 'primary'    && <PrimaryBifurcationTab filters={filters} />}
        {activeTab === 'returning'  && <ReturningTab filters={filters} />}
      </div>
    </div>
  );
}
