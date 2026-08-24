'use client';
import { useState } from 'react';

export default function ArtistDashboardNoteForm({ artistId }: { artistId: number }) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/next/my-artist/${artistId}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
      setSent(true);
      setMessage('');
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="next-card p-6 flex flex-col gap-3">
      <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Send an update to your Scout</label>
      <textarea
        className="w-full min-h-[80px] rounded-[10px] px-3.5 py-2.5 text-sm outline-none"
        style={{ border: '1px solid var(--border-soft)', background: 'var(--bg)', color: 'var(--text)' }}
        value={message}
        onChange={(e) => { setMessage(e.target.value); setSent(false); }}
        placeholder="A new release, a tour date, a milestone — anything worth flagging to your Scout"
        required
      />
      {error && <p className="text-sm m-0" style={{ color: 'var(--down)' }}>{error}</p>}
      {sent && <p className="text-sm m-0" style={{ color: 'var(--up)' }}>Sent — your Scout will see it in your Activity Log.</p>}
      <button type="submit" className="next-btn-primary text-sm px-4 py-2.5 rounded-lg self-start" disabled={saving || !message.trim()}>
        {saving ? 'Sending…' : 'Send update'}
      </button>
    </form>
  );
}
