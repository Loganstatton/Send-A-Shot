'use client';
import { useState } from 'react';

export default function PrivateReleasesForm({ light = false, source = 'footer' }: { light?: boolean; source?: string }) {
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');
    try {
      const res = await fetch('/api/gallery/collector-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website, source }),
      });
      if (!res.ok) throw new Error();
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'done') {
    return (
      <p className="text-sm" style={{ color: light ? 'var(--g-black)' : 'var(--g-text)' }}>
        You&rsquo;re on the list. You&rsquo;ll hear from us before anyone else does.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4 max-w-md">
      <div className="sr-only" aria-hidden="true">
        <label htmlFor={`website-${source}`}>Leave this field blank</label>
        <input id={`website-${source}`} type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      <input
        type="email"
        required
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={`g-input flex-1 ${light ? 'g-input-light' : ''}`}
      />
      <button type="submit" disabled={status === 'saving'} className={`g-btn ${light ? 'g-btn-ghost-light' : ''} shrink-0`}>
        {status === 'saving' ? 'Joining…' : 'Join'}
      </button>
      {status === 'error' && <p className="text-xs text-red-400 sm:hidden">Something went wrong. Please try again.</p>}
    </form>
  );
}
