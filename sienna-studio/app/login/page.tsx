'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Card, TextInput } from '@/components/ui';

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    setBusy(false);
    if (res.ok) {
      const next = params.get('next') || '/';
      window.location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } else {
      setError((await res.json().catch(() => null))?.error ?? 'Sign-in failed');
    }
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
