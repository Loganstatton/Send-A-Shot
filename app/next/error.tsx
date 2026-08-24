'use client';
import { useEffect } from 'react';
import Link from 'next/link';

// Catches a render exception from any /next/* page (not this segment's own
// layout.tsx — Next.js's error-boundary convention never catches errors in
// the same segment's layout, only its page/children). Reports to
// /api/errors the same way app/error.tsx does.
export default function NextError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: error.message, stack: error.stack, digest: error.digest, path: window.location.pathname }),
    }).catch(() => {});
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="font-display font-bold text-2xl m-0">Something went wrong</h1>
      <p className="text-sm max-w-md m-0" style={{ color: 'var(--text-faint)' }}>
        That's on us, not you — the error's been logged. Try again, or head back to Discover.
      </p>
      <div className="flex gap-3">
        <button type="button" className="next-btn-primary text-sm px-5 py-2.5 rounded-lg" onClick={() => reset()}>Try again</button>
        <Link href="/next" className="next-btn-ghost text-sm px-5 py-2.5 rounded-lg">Back to Discover</Link>
      </div>
    </div>
  );
}
