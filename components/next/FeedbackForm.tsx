'use client';
import { useState } from 'react';

const inputStyle: React.CSSProperties = { border: '1px solid var(--border-soft)', background: 'var(--bg)', color: 'var(--text)' };

export default function FeedbackForm({ fromPage }: { fromPage: string | null }) {
  const [understood, setUnderstood] = useState<string>('');
  const [enjoyed, setEnjoyed] = useState('');
  const [confused, setConfused] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/next/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: fromPage, understood: understood || undefined, enjoyed, confused }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return; }
    setSent(true);
  }

  if (sent) return <p role="status" className="next-card p-6 m-0 font-semibold">Thank you — every note gets read.</p>;

  return (
    <form onSubmit={submit} className="next-card p-6 flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
        <legend className="text-sm font-semibold mb-2">Does the way NEXT scores artists make sense to you?</legend>
        <div className="flex gap-2 flex-wrap">
          {[['yes', 'Yes'], ['partly', 'Partly'], ['no', 'Not really']].map(([v, label]) => (
            <label key={v} className={`next-pill cursor-pointer ${understood === v ? 'next-pill-active' : ''}`}>
              <input type="radio" name="understood" value={v} checked={understood === v} onChange={() => setUnderstood(v)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="feedback-enjoyed" className="text-sm font-semibold block mb-1.5">What did you enjoy?</label>
        <textarea id="feedback-enjoyed" className="w-full min-h-[80px] rounded-[10px] px-3.5 py-2.5 text-sm" style={inputStyle} value={enjoyed} onChange={(e) => setEnjoyed(e.target.value)} maxLength={2000} />
      </div>
      <div>
        <label htmlFor="feedback-confused" className="text-sm font-semibold block mb-1.5">What confused you, or would make you come back more?</label>
        <textarea id="feedback-confused" className="w-full min-h-[80px] rounded-[10px] px-3.5 py-2.5 text-sm" style={inputStyle} value={confused} onChange={(e) => setConfused(e.target.value)} maxLength={2000} />
      </div>
      {error && <p role="alert" className="m-0 text-sm" style={{ color: 'var(--down)' }}>{error}</p>}
      <button type="submit" disabled={busy} className="next-btn-primary w-fit px-5 py-2.5 rounded-[10px] text-sm font-semibold">{busy ? 'Sending…' : 'Send feedback'}</button>
    </form>
  );
}
