'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/sync', label: 'Sync health' },
  { href: '/admin/discovery', label: 'Discovery' },
  { href: '/admin/scout-accuracy', label: 'Scout accuracy' },
  { href: '/admin/market-integrity', label: 'Market integrity' },
];

export default function AdminTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-2">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`btn text-sm ${pathname === tab.href ? 'font-semibold' : ''}`}
          style={pathname === tab.href ? { background: 'var(--accent-dim)', borderColor: 'var(--accent-line)', color: 'var(--accent)' } : {}}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
