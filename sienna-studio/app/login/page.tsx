'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Card, TextInput } from '@/components/ui';

/** Only a path on this site: browsers treat a backslash as "/", so "/\evil.com" would leave it; resolving against our own
 * origin catches every form of that. */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/')) return '/';
  try {
    const u = new URL(next, window.location.origin);
    return u.origin === window.location.origin ? `${u.pathname}${u.search}${u.hash}` : '/';
  } catch {
    return '/';
  }
}

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    } catch {
      setBusy(false);
      setError('Could not reach the studio. Check your connection and try again.');
      return;
    }
    setBusy(false);
    if (res.ok) window.location.href = safeNext(params.get('next'));
    else setError((await res.json().catch(() => null))?.error ?? 'Sign-in failed');
  }

  return (
    <form onSubmit={submit} className="flex min-h-[100dvh] flex-col justify-center gap-4 py-10">
      <h1 className="text-center text-2xl font-semibold">Sienna Studio</h1>
      <Card className="space-y-4">
        <TextInput label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {error && <p className="text-sm text-red-300">{error}</p>}
        <Button variant="primary" className="h-12 w-full" loading={busy} type="submit">
          Sign in
        </Button>
      </Card>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
