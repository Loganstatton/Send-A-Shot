'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';

type Props = {
  mode: 'login' | 'signup';
};

export default function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const url = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const body = mode === 'signup' ? { name, email, password } : { email, password };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Something went wrong.');
      }
      router.push('/');
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto card space-y-4">
      <h1 className="text-xl font-semibold">{mode === 'signup' ? 'Create an account' : 'Log in'}</h1>
      {error && <div className="text-sm text-red-300">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'signup' && (
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div>
          <label className="label">Email</label>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={mode === 'signup' ? 8 : undefined}
            required
          />
        </div>
        <button type="submit" className="btn btn-primary w-full" disabled={saving}>
          {saving ? 'Please wait…' : mode === 'signup' ? 'Sign up' : 'Log in'}
        </button>
      </form>
      <p className="text-sm text-neutral-400">
        {mode === 'signup' ? (
          <>Already have an account? <Link href="/login" className="underline">Log in</Link></>
        ) : (
          <>Need an account? <Link href="/signup" className="underline">Sign up</Link></>
        )}
      </p>
    </div>
  );
}
