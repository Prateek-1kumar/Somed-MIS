'use client';
// src/lib/DuckDbContext.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { initDuckDb, loadCsvData, runQuery, isDataLoaded, createEmptyDataTable } from './duckdb';

interface DuckDbContextValue {
  ready: boolean;
  error: string | null;
  query: (sql: string) => Promise<Record<string, unknown>[]>;
  reload: (csvText: string) => Promise<void>;
}

const DuckDbContext = createContext<DuckDbContextValue | null>(null);

export function DuckDbProvider({ children, initialCsv }: { children: ReactNode; initialCsv: string | null }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initDuckDb()
      .then(async () => {
        if (initialCsv) await loadCsvData(initialCsv);
        else await createEmptyDataTable();
        setReady(true);
      })
      .catch(e => setError(String(e)));
  }, [initialCsv]);

  const reload = async (csvText: string) => {
    setReady(false);
    await initDuckDb();
    await loadCsvData(csvText);
    setReady(true);
  };

  return (
    <DuckDbContext.Provider value={{ ready, error, query: runQuery, reload }}>
      {children}
    </DuckDbContext.Provider>
  );
}

export function useDuckDb() {
  const ctx = useContext(DuckDbContext);
  if (!ctx) throw new Error('useDuckDb must be used inside DuckDbProvider');
  return ctx;
}
