'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SubmitArtistForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [submissionUrl, setSubmissionUrl] = useState('');
  const [pitch, setPitch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/next/submit-artist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, submissionUrl, pitch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
      setDone(true);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="next-card p-6 text-center">
        <p className="font-display font-bold text-lg m-0">Thanks — we got it.</p>
        <p className="mt-2 mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          A Scout will take a look. If it's a fit, they'll add it to the roster.
        </p>
        <button type="button" className="next-btn-ghost text-sm px-4 py-2 rounded-lg" onClick={() => { setDone(false); setName(''); setSubmissionUrl(''); setPitch(''); }}>
          Submit another
        </button>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = { border: '1px solid var(--border-soft)', background: 'var(--bg)', color: 'var(--text)' };

  return (
    <form onSubmit={submit} className="next-card p-6 flex flex-col gap-4">
      <div>
        <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>Artist name</label>
        <input
          className="w-full rounded-[10px] px-3.5 py-2.5 text-sm outline-none"
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Who should we check out?"
          required
        />
      </div>
      <div>
        <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>A link to their music or profile</label>
        <input
          className="w-full rounded-[10px] px-3.5 py-2.5 text-sm outline-none"
          style={inputStyle}
          type="url"
          value={submissionUrl}
          onChange={(e) => setSubmissionUrl(e.target.value)}
          placeholder="TikTok, Instagram, YouTube, Spotify — any one link"
        />
      </div>
      <div>
        <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>Why should we check them out?</label>
        <textarea
          className="w-full min-h-[90px] rounded-[10px] px-3.5 py-2.5 text-sm outline-none"
          style={inputStyle}
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          placeholder="What made you think of them? A viral moment, a song stuck in your head, anything."
          required
        />
      </div>
      {error && <p className="text-sm m-0" style={{ color: 'var(--down)' }}>{error}</p>}
      <button type="submit" className="next-btn-primary text-sm px-4 py-2.5 rounded-lg self-start" disabled={saving}>
        {saving ? 'Submitting…' : 'Submit artist'}
      </button>
    </form>
  );
}
