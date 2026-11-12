'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Quiet footer on every NEXT page: what NEXT is (and isn't), the legal
// pages, and — while in beta — a way to send feedback from wherever the
// player is.
export default function NextFooter({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() ?? '/next';
  const feedbackHref = signedIn
    ? `/next/feedback?from=${encodeURIComponent(pathname)}`
    : `/login?next=${encodeURIComponent(`/next/feedback?from=${pathname}`)}`;
  return (
    <footer className="border-t border-[var(--border-soft)] mt-10">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-8 md:px-12 pt-6 pb-24 lg:pb-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-xs" style={{ color: 'var(--text-faint)' }}>
        <p className="m-0 max-w-[60ch]">
          NEXT is a free game played with virtual credits. Credits can&apos;t be bought or cashed out, and backing an artist gives no
          ownership of their music or earnings.
        </p>
        <nav aria-label="Footer" className="flex gap-4 flex-wrap">
          <Link href="/next/how-it-works" className="hover:underline">How it works</Link>
          <Link href="/terms" className="hover:underline">Terms</Link>
          <Link href="/privacy" className="hover:underline">Privacy</Link>
          {signedIn && <Link href="/next/pro" className="hover:underline">NEXT Pro survey</Link>}
          <Link href={feedbackHref} className="hover:underline" style={{ color: 'var(--ember)' }}>Send feedback (beta)</Link>
        </nav>
      </div>
    </footer>
  );
}
