'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
      router.push('/');
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  if (!token) {
    return (
      <div className="max-w-sm mx-auto card space-y-4">
        <h1 className="text-xl font-semibold">Reset your password</h1>
        <p className="text-sm text-neutral-400">This link is missing its token. <Link href="/forgot-password" className="underline">Request a new one</Link>.</p>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto card space-y-4">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-sm text-red-300">{error}</div>}
        <div>
          <label className="label">New password</label>
          <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </div>
        <button type="submit" className="btn btn-primary w-full" disabled={saving}>
          {saving ? 'Saving…' : 'Reset password'}
        </button>
      </form>
    </div>
  );
}
