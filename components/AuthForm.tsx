'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';

type Props = {
  mode: 'login' | 'signup';
  inviteRequired?: boolean;
};

export default function AuthForm({ mode, inviteRequired = false }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'signup' && !policyAccepted) {
      setError('You must accept the Terms of Service and Privacy Policy to sign up.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const body =
        mode === 'signup'
          ? { name, email, password, tosAccepted: true, privacyAccepted: true, inviteCode: inviteCode || undefined }
          : { email, password };
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
      {mode === 'signup' && (
        <p className="text-xs text-neutral-400 -mt-2">
          NEXT is paper trading — every account starts with virtual NEXT Credits, and no real money ever changes hands.
        </p>
      )}
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
          {mode === 'login' && (
            <p className="text-xs mt-1.5">
              <Link href="/forgot-password" className="underline text-neutral-400">Forgot password?</Link>
            </p>
          )}
        </div>
        {mode === 'signup' && inviteRequired && (
          <div>
            <label className="label">Invite code</label>
            <input className="input" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
          </div>
        )}
        {mode === 'signup' && (
          <label className="flex items-start gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={policyAccepted}
              onChange={(e) => setPolicyAccepted(e.target.checked)}
              required
            />
            <span>
              I agree to the <Link href="/terms" target="_blank" className="underline">Terms of Service</Link> and{' '}
              <Link href="/privacy" target="_blank" className="underline">Privacy Policy</Link>.
            </span>
          </label>
        )}
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
