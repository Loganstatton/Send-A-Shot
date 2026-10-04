'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './ui';

const TABS = [
  { href: '/', label: 'Create', icon: '✦' },
  { href: '/gallery', label: 'Gallery', icon: '▦' },
  { href: '/character', label: 'Sienna', icon: '◉' },
  { href: '/library', label: 'Library', icon: '☰' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];

const HIDDEN_ON = ['/login', '/setup'];

export function BottomNav() {
  const path = usePathname();
  if (HIDDEN_ON.some((p) => path.startsWith(p))) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-800 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-xl">
        {TABS.map((t) => {
          const active = t.href === '/' ? path === '/' : path.startsWith(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className={cx('flex h-16 flex-col items-center justify-center gap-0.5 text-[11px]', active ? 'text-accent' : 'text-ink-400')}
              >
                <span className="text-xl leading-none">{t.icon}</span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
