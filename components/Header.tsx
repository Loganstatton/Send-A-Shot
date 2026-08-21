'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User } from '@/lib/types';
import LogoutButton from './LogoutButton';

export default function Header({ user, newCandidateCount = 0 }: { user: User | null; newCandidateCount?: number }) {
  const pathname = usePathname();
  const is = (p: string) => pathname === p || (p !== '/' && pathname?.startsWith(p));
  const isInternal = user?.role === 'internal' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';

  return (
    <header className="border-b border-neutral-800">
      <div className="container flex items-center justify-between py-4 flex-wrap gap-2">
        <Link href={isInternal ? '/' : '/next'} className="text-lg font-semibold">
          {isInternal ? 'Scout' : 'NEXT'}
        </Link>
        <nav className="flex items-center gap-3">
          {user ? (
            <>
              <Link className={"btn " + (pathname === '/next' || pathname?.startsWith('/next/artists') ? 'bg-white/20' : '')} href="/next">Discover</Link>
              <Link className={"btn " + (is('/next/portfolio') ? 'bg-white/20' : '')} href="/next/portfolio">Portfolio</Link>
              <Link className={"btn " + (is('/next/leaderboard') ? 'bg-white/20' : '')} href="/next/leaderboard">Leaderboard</Link>
              {isInternal && (
                <>
                  <Link className={"btn " + (pathname === '/' ? 'bg-white/20' : '')} href="/">Dashboard</Link>
                  <Link className={"btn " + (is('/screener') ? 'bg-white/20' : '')} href="/screener">Screener</Link>
                  <Link className={"btn " + (is('/discovery') ? 'bg-white/20' : '')} href="/discovery">
                    New Candidates{newCandidateCount > 0 && <span className="ml-1.5 badge text-xs px-1.5">{newCandidateCount}</span>}
                  </Link>
                  <Link className={"btn btn-primary " + (is('/artists/new') ? 'bg-blue-700' : '')} href="/artists/new">+ Add Artist</Link>
                </>
              )}
              {isAdmin && (
                <Link className={"btn " + (is('/admin') ? 'bg-white/20' : '')} href="/admin/users">Admin</Link>
              )}
              <Link className={"btn text-sm " + (is('/next/profile') ? 'bg-white/20' : '')} href="/next/profile">
                <span className="hidden sm:inline">{user.name}</span>
                <span className="sm:hidden">You</span>
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link className={"btn " + (is('/login') ? 'bg-white/20' : '')} href="/login">Log in</Link>
              <Link className={"btn btn-primary " + (is('/signup') ? 'bg-blue-700' : '')} href="/signup">Sign up</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
