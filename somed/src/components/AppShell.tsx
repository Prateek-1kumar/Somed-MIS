'use client';
import { ReactNode, useEffect, useState } from 'react';
import { DuckDbProvider } from '@/lib/DuckDbContext';
import Layout from './Layout';

export default function AppShell({ children }: { children: ReactNode }) {
  const [initialCsv, setInitialCsv] = useState<string | null>(null);
  const [csvLoading, setCsvLoading] = useState(true);

  useEffect(() => {
    fetch('/api/blob/read')
      .then(r => {
        if (!r.ok) return '';
        return r.text();
      })
      .then(csv => { setInitialCsv(csv || null); setCsvLoading(false); })
      .catch(() => setCsvLoading(false));
  }, []);

  if (csvLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-zinc-500 text-sm">
        Loading data…
      </div>
    );
  }

  return (
    <DuckDbProvider initialCsv={initialCsv}>
      <Layout>{children}</Layout>
    </DuckDbProvider>
  );
}
