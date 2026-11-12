'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/sync', label: 'Sync health' },
  { href: '/admin/discovery', label: 'Discovery' },
  { href: '/admin/scout-accuracy', label: 'Scout accuracy' },
  { href: '/admin/market-integrity', label: 'Market integrity' },
  { href: '/admin/feed-reports', label: 'Feed reports' },
  { href: '/admin/feedback', label: 'Beta feedback' },
  { href: '/admin/email', label: 'Email' },
  { href: '/admin/errors', label: 'Errors' },
  { href: '/admin/backups', label: 'Backups' },
  { href: '/admin/audit', label: 'Audit log' },
];

export default function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="flex flex-wrap gap-2">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? 'page' : undefined}
          className={`btn text-sm ${pathname === tab.href ? 'font-semibold' : ''}`}
          style={pathname === tab.href ? { background: 'var(--accent-dim)', borderColor: 'var(--accent-line)', color: 'var(--accent)' } : {}}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
