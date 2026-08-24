'use client';
import { useEffect } from 'react';
import Link from 'next/link';

// Next.js's error-boundary convention — catches any render/render-time
// exception thrown by a Server or Client Component under this segment.
// Reports to /api/errors so it shows up at /admin/errors instead of only
// existing in whatever browser happened to hit it.
export default function ScoutError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: error.message, stack: error.stack, digest: error.digest, path: window.location.pathname }),
    }).catch(() => {});
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-sm max-w-md" style={{ color: 'var(--text-faint)' }}>
        That's on us — the error's been logged. Try again, or head back to the dashboard.
      </p>
      <div className="flex gap-3">
        <button type="button" className="btn btn-primary text-sm" onClick={() => reset()}>Try again</button>
        <Link href="/" className="btn text-sm">Go to dashboard</Link>
      </div>
    </div>
  );
}
