'use client';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { User } from '@/lib/types';

export default function Header({ user }: { user: User | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const is = (p: string) => pathname === p || (p !== '/' && pathname?.startsWith(p));

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="border-b border-neutral-800">
      <div className="container flex items-center justify-between py-4 flex-wrap gap-2">
        <Link href="/" className="text-lg font-semibold">Scout</Link>
        <nav className="flex items-center gap-3">
          {user ? (
            <>
              <Link className={"btn " + (is('/') ? 'bg-white/20' : '')} href="/">Dashboard</Link>
              <Link className={"btn " + (is('/screener') ? 'bg-white/20' : '')} href="/screener">Screener</Link>
              <Link className={"btn btn-primary " + (is('/artists/new') ? 'bg-blue-700' : '')} href="/artists/new">+ Add Artist</Link>
              <span className="text-sm text-neutral-400 hidden sm:inline">{user.name}</span>
              <button type="button" className="btn" onClick={handleLogout}>Log out</button>
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
