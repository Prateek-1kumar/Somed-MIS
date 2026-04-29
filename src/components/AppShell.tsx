'use client';
import { ReactNode, useEffect } from 'react';
import Layout from './Layout';

export default function AppShell({ children }: { children: ReactNode }) {
  // Dark mode: read from localStorage, apply to <html>.
  // (CSV pre-fetch is gone — Postgres is canonical, each surface fetches
  // its own data via server actions.)
  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  return <Layout>{children}</Layout>;
}
