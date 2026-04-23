'use client';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { REPORTS, REPORT_GROUPS } from '@/reports';
import { LayoutDashboard, MessageSquare, FolderKanban, UploadCloud, Moon, Sun, ChevronRight, BarChart3 } from 'lucide-react'; // Let's use lucide-react if available or simple SVGs. I will use SVGs if lucide-react isn't there, but it's simpler to just provide elegant HTML.

function toggleDark() {
  const html = document.documentElement;
  if (html.classList.contains('dark')) {
    html.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  } else {
    html.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  }
}

function NavLink({ href, children, active, icon }: { href: string; children: ReactNode; active: boolean; icon?: ReactNode }) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out
        ${active 
          ? 'bg-[var(--bg-surface-raised)] text-[var(--accent)] shadow-sm ring-1 ring-[var(--border)]' 
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)]'
        }`}
    >
      {icon && (
        <span className={`${active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'} transition-colors`}>
          {icon}
        </span>
      )}
      <span className="truncate flex-1">{children}</span>
      {!active && <ChevronRightIcon className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-muted)] -mr-1" />}
    </Link>
  );
}

// Simple icons to avoid dependency issues
const DashboardIcon = ({ className }: {className?: string}) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>;
const ChatIcon = ({ className }: {className?: string}) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>;
const FolderIcon = ({ className }: {className?: string}) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>;
const UploadIcon = ({ className }: {className?: string}) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>;
const ChartIcon = ({ className }: {className?: string}) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>;
const ChevronRightIcon = ({ className }: {className?: string}) => <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>;

function LegacyReportsSection({ activeId }: { activeId: string | undefined }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider hover:text-[var(--text-primary)] transition-colors rounded-lg hover:bg-[var(--bg-surface-raised)]"
      >
        <span>Legacy Reports</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m9 18 6-6-6-6" />
        </svg>
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5">
          {REPORT_GROUPS.map(group => {
            const groupReports = REPORTS.filter(r => r.group === group);
            if (groupReports.length === 0) return null;
            return (
              <div key={group} className="space-y-1">
                <h3 className="px-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mt-2">
                  {group}
                </h3>
                {groupReports.map(report => (
                  <NavLink
                    key={report.id}
                    href={`/reports/${report.id}`}
                    active={activeId === report.id}
                    icon={<ChartIcon />}
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

export default function Sidebar() {
  const pathname = usePathname();
  const params = useParams<{ reportId?: string }>();
  const activeId = params?.reportId;

  return (
    <aside className="w-72 flex-shrink-0 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col h-screen transition-colors duration-200">
      {/* Header */}
      <div className="h-16 px-6 flex items-center justify-between border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--text-primary)] flex items-center justify-center shadow-inner">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[var(--bg-surface)]"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div>
            <h1 className="text-sm font-bold text-[var(--text-primary)] tracking-wide uppercase">Shomed</h1>
            <p className="text-[11px] font-medium text-[var(--text-muted)] mt-0.5">Remedies MIS</p>
          </div>
        </div>
        <button 
          onClick={toggleDark} 
          title="Toggle theme"
          className="p-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-[var(--border-strong)]">
        
        {/* Main Tools & Dashboard section */}
        <div className="space-y-1.5">
          <NavLink href="/" active={pathname === '/'} icon={<DashboardIcon />}>Dashboard</NavLink>
          <NavLink href="/chat" active={pathname === '/chat'} icon={<ChatIcon />}>Chat with Data</NavLink>
          <NavLink href="/my-reports" active={pathname === '/my-reports'} icon={<FolderIcon />}>My Reports</NavLink>
          <NavLink href="/upload" active={pathname === '/upload'} icon={<UploadIcon />}>Upload CSV</NavLink>
        </div>

        {/* Reports Groups */}
        <LegacyReportsSection activeId={activeId} />
      </nav>
      
      {/* Footer / User Profile area optional placeholder */}
      <div className="p-4 border-t border-[var(--border)] shrink-0">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-surface-raised)] transition-colors cursor-pointer text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          <div className="w-8 h-8 rounded-full bg-[var(--text-primary)] flex items-center justify-center text-[var(--bg-surface)] text-xs shadow-sm">
            US
          </div>
          <span className="truncate">User Profile</span>
        </div>
      </div>
    </aside>
  );
}
