'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type ClaimState = 'unclaimed' | 'owned_by_me' | 'claimed_by_other' | 'pending';

export default function ClaimArtistPanel({ artistId, artistName, initialState }: { artistId: number; artistName: string; initialState: ClaimState }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A profile claimed by someone else says nothing publicly — no reason to
  // surface who, and "unclaimed" is the only state worth prompting on.
  if (state === 'claimed_by_other') return null;

  if (state === 'owned_by_me') {
    return (
      <div className="next-card p-5 flex items-center justify-between gap-3 flex-wrap">
        <p className="m-0 text-sm flex items-center gap-2" style={{ color: 'var(--up)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M20 6 9 17l-5-5" /></svg>
          You&apos;re verified as {artistName}
        </p>
        <Link href="/next/my-artist" className="next-btn-ghost text-xs px-3.5 py-2 rounded-lg">Open your dashboard →</Link>
      </div>
    );
  }

  if (state === 'pending') {
    return (
      <div className="next-card p-5">
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          Your claim on this profile is pending review. A Scout will follow up soon.
        </p>
      </div>
    );
  }

  async function submitClaim() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/next/artists/${artistId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
      setState('pending');
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="next-card p-5">
      {!open ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>Is this you? Claim this profile to get your own Artist Dashboard.</p>
          <button type="button" className="next-btn-ghost text-xs px-3.5 py-2 rounded-lg" onClick={() => setOpen(true)}>
            Claim this profile
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            How can a Scout verify this is you? (a link, a note — whatever helps)
          </label>
          <textarea
            className="w-full min-h-[70px] rounded-[10px] px-3.5 py-2.5 text-sm outline-none"
            style={{ border: '1px solid var(--border-soft)', background: 'var(--bg)', color: 'var(--text)' }}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. I run the @handle account linked on this page"
          />
          {error && <p className="text-sm m-0" style={{ color: 'var(--down)' }}>{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="next-btn-primary text-xs px-3.5 py-2 rounded-lg" disabled={saving} onClick={submitClaim}>
              {saving ? 'Submitting…' : 'Submit claim'}
            </button>
            <button type="button" className="next-btn-ghost text-xs px-3.5 py-2 rounded-lg" disabled={saving} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
