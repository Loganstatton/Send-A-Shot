'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User } from '@/lib/types';
import { formatCents } from '@/lib/format';
import LogoutButton from '@/components/LogoutButton';

// NEXT's own nav — deliberately separate from Scout's Header. A public
// user should never see Admin/Screener/Candidates/Add Artist here; those
// stay entirely on Scout's side. See components/Header.tsx, which now
// renders nothing on /next/* routes so the two never double up.
export default function NextHeader({ user }: { user: User }) {
  const pathname = usePathname();
  const is = (p: string) => pathname === p || (p !== '/next' && pathname?.startsWith(p));
  const isInternal = user.role === 'internal' || user.role === 'admin';

  const links = [
    { href: '/next', label: 'Discover', active: pathname === '/next' || pathname?.startsWith('/next/artists') },
    { href: '/next/portfolio', label: 'Portfolio', active: is('/next/portfolio') },
    { href: '/next/leaderboard', label: 'Leaderboard', active: is('/next/leaderboard') },
    { href: '/next/watchlist', label: 'Watchlist', active: is('/next/watchlist') },
  ];

  return (
    <div className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-[var(--border-soft)]">
      <div className="flex items-center gap-10">
        <Link href="/next" className="flex items-baseline gap-0.5 font-display font-extrabold text-[22px] tracking-[-0.01em]">
          <span>NEXT</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ember)] self-center ml-1 shadow-[0_0_12px_var(--ember)]" />
        </Link>
        <nav className="hidden sm:flex items-center gap-7 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`relative pb-[22px] ${l.active ? 'font-medium' : ''}`}
              style={{ color: l.active ? 'var(--text)' : 'var(--text-muted)' }}
            >
              {l.label}
              {l.active && <span className="absolute left-0 right-0 -bottom-[21px] h-0.5 rounded-full" style={{ background: 'var(--ember)' }} />}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {isInternal && (
          <Link href="/" className="hidden md:inline text-xs" style={{ color: 'var(--text-faint)' }}>
            Switch to Scout →
          </Link>
        )}
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-[var(--surface)] border border-[var(--border-soft)]">
          <span className="font-mono text-xs text-[var(--text-faint)]">Credits</span>
          <span className="num text-xs font-semibold">{formatCents(user.next_credits_cents)}</span>
        </div>
        <Link
          href="/next/profile"
          className="w-9 h-9 rounded-full bg-[var(--surface-2)] border border-[var(--border-soft)] flex items-center justify-center font-display font-bold text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          {user.name.trim().charAt(0).toUpperCase() || '?'}
        </Link>
        <LogoutButton className="next-btn-ghost text-xs px-3 py-2 hidden md:inline-flex" />
      </div>
    </div>
  );
}
