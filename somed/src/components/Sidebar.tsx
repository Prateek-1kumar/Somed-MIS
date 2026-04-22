'use client';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { REPORTS, REPORT_GROUPS } from '@/reports';

export default function Sidebar() {
  const pathname = usePathname();
  const params = useParams<{ reportId?: string }>();
  const activeId = params?.reportId;

  return (
    <aside className="w-64 bg-white border-r border-zinc-200 flex flex-col overflow-y-auto shrink-0">
      <div className="px-4 py-4 border-b border-zinc-200">
        <p className="text-xs font-bold text-blue-700 uppercase tracking-widest">Shomed MIS</p>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-1">
        <Link href="/" className={`block px-3 py-2 rounded text-sm font-medium ${pathname === '/' ? 'bg-blue-50 text-blue-700' : 'text-zinc-600 hover:bg-zinc-100'}`}>
          Dashboard
        </Link>
        {REPORT_GROUPS.map(group => (
          <div key={group}>
            <p className="px-3 pt-3 pb-1 text-xs font-semibold text-zinc-400 uppercase tracking-wider">{group}</p>
            {REPORTS.filter(r => r.group === group).map(report => (
              <Link key={report.id} href={`/reports/${report.id}`}
                className={`block px-3 py-1.5 rounded text-sm ${activeId === report.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-zinc-600 hover:bg-zinc-100'}`}>
                {report.name}
              </Link>
            ))}
          </div>
        ))}
        <div>
          <p className="px-3 pt-3 pb-1 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Tools</p>
          <Link href="/my-reports" className={`block px-3 py-1.5 rounded text-sm ${pathname === '/my-reports' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-zinc-600 hover:bg-zinc-100'}`}>My Reports</Link>
          <Link href="/chat" className={`block px-3 py-1.5 rounded text-sm ${pathname === '/chat' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-zinc-600 hover:bg-zinc-100'}`}>Chat</Link>
          <Link href="/upload" className={`block px-3 py-1.5 rounded text-sm ${pathname === '/upload' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-zinc-600 hover:bg-zinc-100'}`}>Upload CSV</Link>
        </div>
      </nav>
    </aside>
  );
}
