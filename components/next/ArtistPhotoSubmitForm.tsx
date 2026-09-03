'use client';
import { useState } from 'react';

// Migration brief item 3/33: any artist-submitted image requires an
// explicit rights-confirmation checkbox, and the app must store the
// uploader id, upload timestamp, and rights-confirmation timestamp — see
// setArtistPhotoByOwner in lib/db.ts, the sole write path this form's POST
// goes through. This app has no binary file-upload storage (see that
// route's own comment), so "submit a photo" here means a direct link the
// artist hosts themselves — same as every other photo field in this app.
export default function ArtistPhotoSubmitForm({ artistId, currentPhotoUrl }: { artistId: number; currentPhotoUrl?: string }) {
  const [photoUrl, setPhotoUrl] = useState('');
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/next/my-artist/${artistId}/photo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrl, rightsConfirmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
      setSaved(data.photo_url);
      setPhotoUrl('');
      setRightsConfirmed(false);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="next-card p-6 flex flex-col gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.06em] font-mono m-0" style={{ color: 'var(--text-faint)' }}>Profile photo</p>
        <p className="text-xs mt-1 m-0" style={{ color: 'var(--text-faint)' }}>
          A direct link to an image you host yourself. Replaces whatever photo is currently showing.
        </p>
      </div>
      {currentPhotoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL, not a next/image candidate.
        <img src={currentPhotoUrl} alt="Current profile photo" className="w-20 h-20 rounded-full object-cover" style={{ background: 'var(--surface-2)' }} />
      )}
      <input
        className="w-full rounded-[10px] px-3.5 py-2.5 text-sm outline-none"
        style={{ border: '1px solid var(--border-soft)', background: 'var(--bg)', color: 'var(--text)' }}
        value={photoUrl}
        onChange={(e) => setPhotoUrl(e.target.value)}
        placeholder="https://…jpg"
        type="url"
      />
      <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        <input type="checkbox" checked={rightsConfirmed} onChange={(e) => setRightsConfirmed(e.target.checked)} className="mt-0.5" />
        <span>I own this content or have permission to provide it for use on NEXT.</span>
      </label>
      {error && <p className="text-sm m-0" style={{ color: 'var(--down)' }}>{error}</p>}
      {saved && <p className="text-sm m-0" style={{ color: 'var(--up)' }}>Photo updated.</p>}
      <button type="submit" className="next-btn-primary text-sm px-4 py-2.5 rounded-lg self-start" disabled={saving || !photoUrl.trim() || !rightsConfirmed}>
        {saving ? 'Saving…' : 'Update photo'}
      </button>
    </form>
  );
}
