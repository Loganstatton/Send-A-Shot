'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const inputStyle: React.CSSProperties = { border: '1px solid var(--border-soft)', background: 'var(--bg)', color: 'var(--text)' };

// Shared by the artist dashboard (correction / rating review / opt-out)
// and the public artist page (correction / impersonation / claim dispute).
export default function ArtistRequestForm({
  artistId, kinds, idPrefix, intro,
}: { artistId: number; kinds: { value: string; label: string; hint: string }[]; idPrefix: string; intro?: string }) {
  const router = useRouter();
  const [kind, setKind] = useState(kinds[0]?.value ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const hint = kinds.find((k) => k.value === kind)?.hint;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/next/artists/${artistId}/requests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
      setSent(true);
      setMessage('');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <p className="m-0 text-sm font-semibold">Thanks — a person at NEXT will review it.</p>
        <button type="button" className="next-btn-ghost w-fit text-xs px-3 py-1.5 rounded-lg" onClick={() => setSent(false)}>Send another</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {intro && <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>{intro}</p>}
      <div>
        <label htmlFor={`${idPrefix}-kind`} className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>What is this about?</label>
        <select id={`${idPrefix}-kind`} className="w-full rounded-[10px] px-3 py-2.5 text-sm" style={inputStyle} value={kind} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        {hint && <p className="m-0 mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>{hint}</p>}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-message`} className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>Details</label>
        <textarea
          id={`${idPrefix}-message`}
          className="w-full min-h-[90px] rounded-[10px] px-3.5 py-2.5 text-sm"
          style={inputStyle}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1000}
          required
        />
      </div>
      {error && <p role="alert" className="m-0 text-sm" style={{ color: 'var(--down)' }}>{error}</p>}
      <button type="submit" disabled={busy} className="next-btn-primary w-fit text-sm px-4 py-2.5 rounded-[10px] font-semibold">{busy ? 'Sending…' : 'Send'}</button>
    </form>
  );
}
