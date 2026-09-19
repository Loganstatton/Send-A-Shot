'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/gallery/works', label: 'Works' },
  { href: '/gallery/stories', label: 'Stories' },
  { href: '/gallery/about', label: 'About' },
  { href: '/gallery/works?availability=available', label: 'Available Works' },
];

export default function GalleryHeader({ artistName }: { artistName: string }) {
  const pathname = usePathname();
  const [solid, setSolid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    // The homepage hero wants a fully transparent header floating over the
    // artwork until the visitor scrolls past it; every other page just
    // wants a plain solid header from the start.
    if (pathname !== '/gallery') {
      setSolid(true);
      return;
    }
    setSolid(false);
    const onScroll = () => setSolid(window.scrollY > window.innerHeight * 0.7);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pathname]);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-colors duration-500"
      style={{
        background: solid ? 'var(--g-black)' : 'transparent',
        borderBottom: solid ? '1px solid var(--g-line-soft)' : '1px solid transparent',
      }}
    >
      <div className="max-w-[1600px] mx-auto px-5 sm:px-8 flex items-center justify-between h-16 sm:h-20">
        <Link href="/gallery" className="g-serif text-[15px] sm:text-[17px] tracking-[0.08em] uppercase">
          {artistName}
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="g-label transition-colors duration-200 hover:opacity-100"
              style={{ opacity: pathname === l.href.split('?')[0] ? 1 : 0.62 }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <button
          className="md:hidden g-label flex items-center gap-2"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label="Toggle navigation menu"
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden px-5 pb-6 flex flex-col gap-5" style={{ background: 'var(--g-black)' }}>
          {LINKS.map((l) => (
            <Link key={l.label} href={l.href} className="g-label text-sm" onClick={() => setMenuOpen(false)}>
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
