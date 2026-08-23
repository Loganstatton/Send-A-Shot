'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User } from '@/lib/types';
import LogoutButton from './LogoutButton';

function navClass(active: boolean) {
  return `btn text-sm ${active ? 'font-semibold' : ''}`;
}

function navStyle(active: boolean): React.CSSProperties {
  return active
    ? { background: 'var(--accent-dim)', borderColor: 'var(--accent-line)', color: 'var(--accent)' }
    : {};
}

export default function Header({ user, newCandidateCount = 0 }: { user: User | null; newCandidateCount?: number }) {
  const pathname = usePathname();
  const is = (p: string) => pathname === p || (p !== '/' && pathname?.startsWith(p));
  const isInternal = user?.role === 'internal' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';

  // NEXT has its own header (components/next/NextHeader.tsx) with its own
  // visual identity — never render this Scout/Admin nav on top of it.
  if (pathname?.startsWith('/next')) return null;

  return (
    <header style={{ borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-2)' }}>
      <div className="container flex items-center justify-between py-3.5 flex-wrap gap-2">
        <Link href={isInternal ? '/' : '/next'} className="flex items-center gap-2 text-[15px] font-bold tracking-tight">
          <span className="w-1.5 h-1.5 rounded-sm" style={{ background: 'var(--accent)', boxShadow: '0 0 8px var(--accent-line)' }} />
          {isInternal ? 'SCOUT' : 'NEXT'}
        </Link>
        <nav className="flex items-center gap-2">
          {user ? (
            <>
              <Link className={navClass(pathname === '/next' || pathname?.startsWith('/next/artists'))} style={navStyle(pathname === '/next' || (pathname?.startsWith('/next/artists') ?? false))} href="/next">Discover</Link>
              <Link className={navClass(is('/next/portfolio'))} style={navStyle(is('/next/portfolio'))} href="/next/portfolio">Portfolio</Link>
              <Link className={navClass(is('/next/leaderboard'))} style={navStyle(is('/next/leaderboard'))} href="/next/leaderboard">Leaderboard</Link>
              {isInternal && (
                <>
                  <span className="w-px h-5 mx-1" style={{ background: 'var(--border-soft)' }} />
                  <Link className={navClass(pathname === '/')} style={navStyle(pathname === '/')} href="/">Dashboard</Link>
                  <Link className={navClass(is('/screener'))} style={navStyle(is('/screener'))} href="/screener">Screener</Link>
                  <Link className={navClass(is('/discovery'))} style={navStyle(is('/discovery'))} href="/discovery">
                    New Candidates{newCandidateCount > 0 && <span className="num ml-1.5 badge text-xs px-1.5" style={{ background: 'var(--fire-dim)', borderColor: 'var(--fire-line)', color: 'var(--fire)' }}>{newCandidateCount}</span>}
                  </Link>
                  <Link className="btn btn-primary text-sm" href="/artists/new">+ Add Artist</Link>
                </>
              )}
              {isAdmin && (
                <Link className={navClass(is('/admin'))} style={navStyle(is('/admin'))} href="/admin/users">Admin</Link>
              )}
              <span className="w-px h-5 mx-1" style={{ background: 'var(--border-soft)' }} />
              <Link className={navClass(is('/next/profile'))} style={navStyle(is('/next/profile'))} href="/next/profile">
                <span className="hidden sm:inline">{user.name}</span>
                <span className="sm:hidden">You</span>
              </Link>
              <Link className={navClass(is('/settings'))} style={navStyle(is('/settings'))} href="/settings">Settings</Link>
              <LogoutButton className="btn text-sm" />
            </>
          ) : (
            <>
              <Link className={navClass(is('/login'))} style={navStyle(is('/login'))} href="/login">Log in</Link>
              <Link className="btn btn-primary text-sm" href="/signup">Sign up</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
