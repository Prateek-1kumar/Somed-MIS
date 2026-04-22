'use client';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { ReactNode } from 'react';
import { REPORTS, REPORT_GROUPS } from '@/reports';

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

function NavLink({ href, children, active }: { href: string; children: ReactNode; active: boolean }) {
  return (
    <Link href={href} style={{
      display: 'block', padding: '6px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: active ? 600 : 400,
      color: active ? 'var(--accent)' : 'var(--text-secondary)',
      backgroundColor: active ? 'var(--accent-light)' : 'transparent',
      textDecoration: 'none',
    }}
    className="hover:bg-[--bg-surface-raised]">
      {children}
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const params = useParams<{ reportId?: string }>();
  const activeId = params?.reportId;

  return (
    <aside style={{
      width: 'var(--sidebar-width)', flexShrink: 0,
      backgroundColor: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Shomed</p>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>Remedies MIS</p>
        </div>
        <button onClick={toggleDark} title="Toggle dark mode"
          style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface-raised)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>
          ◑
        </button>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        <div style={{ marginBottom: '4px' }}>
          <NavLink href="/" active={pathname === '/'}>Dashboard</NavLink>
        </div>

        {REPORT_GROUPS.map(group => (
          <div key={group} style={{ marginBottom: '8px' }}>
            <p style={{ padding: '8px 12px 4px', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{group}</p>
            {REPORTS.filter(r => r.group === group).map(report => (
              <NavLink key={report.id} href={`/reports/${report.id}`} active={activeId === report.id}>
                {report.name}
              </NavLink>
            ))}
          </div>
        ))}

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '8px' }}>
          <p style={{ padding: '8px 12px 4px', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tools</p>
          <NavLink href="/chat" active={pathname === '/chat'}>Chat with Data</NavLink>
          <NavLink href="/my-reports" active={pathname === '/my-reports'}>My Reports</NavLink>
          <NavLink href="/upload" active={pathname === '/upload'}>Upload CSV</NavLink>
        </div>
      </nav>
    </aside>
  );
}
