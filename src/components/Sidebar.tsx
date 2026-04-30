'use client';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  MessageCircle,
  BookOpen,
  FolderKanban,
  Upload,
  BarChart3,
  ChevronRight,
  Sun,
  Moon,
  X,
} from 'lucide-react';
import { REPORTS, REPORT_GROUPS } from '@/reports';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

function NavLink({
  href,
  children,
  active,
  icon,
}: {
  href: string;
  children: ReactNode;
  active: boolean;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out
        ${
          active
            ? 'bg-[var(--accent-light)] text-[var(--accent)] border-l-[3px] border-[var(--accent)] -ml-[3px] pl-[14px] pr-3'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)] px-3'
        }`}
    >
      <span
        className={`${
          active
            ? 'text-[var(--accent)]'
            : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'
        } transition-colors flex-shrink-0`}
      >
        {icon}
      </span>
      <span className="truncate flex-1">{children}</span>
      {!active && (
        <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-muted)] -mr-1" />
      )}
    </Link>
  );
}

function LegacyReportsSection({ activeId }: { activeId: string | undefined }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider hover:text-[var(--text-primary)] transition-colors rounded-lg hover:bg-[var(--bg-surface-raised)]"
      >
        <span>Legacy Reports</span>
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5">
          {REPORT_GROUPS.map((group) => {
            const groupReports = REPORTS.filter((r) => r.group === group);
            if (groupReports.length === 0) return null;
            return (
              <div key={group} className="space-y-1">
                <h3 className="px-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mt-2">
                  {group}
                </h3>
                {groupReports.map((report) => (
                  <NavLink
                    key={report.id}
                    href={`/reports/${report.id}`}
                    active={activeId === report.id}
                    icon={<BarChart3 className="w-[18px] h-[18px]" />}
                  >
                    {report.name}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const params = useParams<{ reportId?: string }>();
  const activeId = params?.reportId;
  const [isDark, setIsDark] = useState(false);

  // Track dark mode state.
  useEffect(() => {
    const update = () =>
      setIsDark(document.documentElement.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => obs.disconnect();
  }, []);

  // Auto-close mobile overlay when route changes.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Close on Escape when open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const toggleDark = () => {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
      html.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      html.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`w-64 flex-shrink-0 bg-[var(--bg-surface)] border-r border-[var(--border)]
          flex flex-col h-screen transition-transform duration-200
          fixed md:static top-0 left-0 z-50
          ${open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
        aria-modal={open}
        role={open ? 'dialog' : undefined}
      >
        {/* Header */}
        <div className="h-16 px-6 flex items-center justify-between border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center shadow-inner">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
              >
                <path d="M12 2v20" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-[var(--text-primary)] tracking-wide uppercase">
                Shomed
              </h1>
              <p className="text-[11px] font-medium text-[var(--text-muted)] mt-0.5">
                Remedies MIS
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={toggleDark}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Toggle theme"
            >
              {isDark ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)] transition-colors md:hidden"
              aria-label="Close sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-6">
          <div className="space-y-1.5">
            <NavLink
              href="/"
              active={pathname === '/'}
              icon={<LayoutDashboard className="w-[18px] h-[18px]" />}
            >
              Dashboard
            </NavLink>
            <NavLink
              href="/chat"
              active={pathname === '/chat'}
              icon={<MessageCircle className="w-[18px] h-[18px]" />}
            >
              Chat with Data
            </NavLink>
            <NavLink
              href="/learned-patterns"
              active={pathname === '/learned-patterns'}
              icon={<BookOpen className="w-[18px] h-[18px]" />}
            >
              Learned Patterns
            </NavLink>
            <NavLink
              href="/my-reports"
              active={pathname === '/my-reports'}
              icon={<FolderKanban className="w-[18px] h-[18px]" />}
            >
              My Reports
            </NavLink>
            <NavLink
              href="/upload"
              active={pathname === '/upload'}
              icon={<Upload className="w-[18px] h-[18px]" />}
            >
              Upload CSV
            </NavLink>
          </div>

          <LegacyReportsSection activeId={activeId} />
        </nav>
      </aside>
    </>
  );
}
