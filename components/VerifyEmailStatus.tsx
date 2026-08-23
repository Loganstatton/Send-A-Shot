'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function VerifyEmailStatus({ token }: { token: string }) {
  const [status, setStatus] = useState<'checking' | 'success' | 'error'>(token ? 'checking' : 'error');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? 'This verification link is invalid or has expired.');
          setStatus('error');
        } else {
          setStatus('success');
        }
      } catch {
        if (!cancelled) {
          setError('Something went wrong.');
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="max-w-sm mx-auto card space-y-4">
      <h1 className="text-xl font-semibold">Verify your email</h1>
      {status === 'checking' && <p className="text-sm text-neutral-400">Verifying…</p>}
      {status === 'success' && <p className="text-sm text-neutral-300">Your email is verified. <Link href="/" className="underline">Continue</Link>.</p>}
      {status === 'error' && (
        <p className="text-sm text-red-300">
          {error} You can request a new link from <Link href="/settings" className="underline">Settings</Link> once logged in.
        </p>
      )}
    </div>
  );
}
