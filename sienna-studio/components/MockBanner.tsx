'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Fixed hazard-striped bar shown on every page while the backend is the mock.
 * Sets `html.mock` so sticky headers shift below it (see globals.css).
 */
export function MockBanner() {
  const [mock, setMock] = useState(false);
  const path = usePathname();

  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch('/api/settings', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setMock(!!d.env?.mock))
        .catch(() => {});
    check();
    window.addEventListener('focus', check);
    return () => {
      alive = false;
      window.removeEventListener('focus', check);
    };
  }, [path]);

  useEffect(() => {
    document.documentElement.classList.toggle('mock', mock);
  }, [mock]);

  if (!mock || path.startsWith('/login')) return null;
  return (
    <Link
      href="/settings"
      className="mock-stripes fixed inset-x-0 top-0 z-50 flex items-end justify-center pb-1 pt-[env(safe-area-inset-top)] text-[12px] font-bold tracking-wide text-black"
      style={{ height: 'var(--banner-h)' }}
    >
      <span className="max-w-[92vw] truncate whitespace-nowrap rounded bg-amber-300 px-2">MOCK MODE · no GPU · tap to connect ComfyUI</span>
    </Link>
  );
}
