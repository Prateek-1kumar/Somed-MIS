'use client';
import { ReactNode, useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';

export default function Layout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-base)]">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 overflow-y-auto">
        {/* Mobile hamburger — visible only on small screens. */}
        <div className="md:hidden sticky top-0 z-30 bg-[var(--bg-surface)] border-b border-[var(--border)] px-4 h-14 flex items-center">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Open sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="ml-3 text-sm font-semibold text-[var(--text-primary)]">
            Shomed Remedies MIS
          </h1>
        </div>

        <div className="min-h-full p-6 max-w-screen-2xl">{children}</div>
      </main>
    </div>
  );
}
