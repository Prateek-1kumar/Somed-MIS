'use client';
import { ReactNode, useEffect, useState } from 'react';
import { DuckDbProvider } from '@/lib/DuckDbContext';
import Layout from './Layout';

export default function AppShell({ children }: { children: ReactNode }) {
  const [initialCsv, setInitialCsv] = useState<string | null>(null);
  const [csvLoading, setCsvLoading] = useState(true);

  // Dark mode: read from localStorage, apply to <html>
  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  useEffect(() => {
    fetch('/api/blob/read')
      .then(r => { if (!r.ok) return ''; return r.text(); })
      .then(csv => { setInitialCsv(csv || null); setCsvLoading(false); })
      .catch(() => setCsvLoading(false));
  }, []);

  if (csvLoading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: 'var(--bg-base)' }}>
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto" style={{ borderColor: 'var(--border-strong)', borderTopColor: 'var(--accent)' }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading Shomed MIS…</p>
        </div>
      </div>
    );
  }

  return (
    <DuckDbProvider initialCsv={initialCsv}>
      <Layout>{children}</Layout>
    </DuckDbProvider>
  );
}
