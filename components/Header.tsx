'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Header() {
  const pathname = usePathname();
  const is = (p: string) => pathname === p || (p !== '/' && pathname?.startsWith(p));
  return (
    <header className="border-b border-neutral-800">
      <div className="container flex items-center justify-between py-4">
        <Link href="/" className="text-lg font-semibold">Scout</Link>
        <nav className="flex gap-3">
          <Link className={"btn " + (is('/') ? 'bg-white/20' : '')} href="/">Dashboard</Link>
          <Link className={"btn btn-primary " + (is('/artists/new') ? 'bg-blue-700' : '')} href="/artists/new">+ Add Artist</Link>
        </nav>
      </div>
    </header>
  );
}
