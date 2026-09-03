'use client';
import { useState } from 'react';
import { Artist } from '@/lib/types';

type Props = {
  artistId: number;
  initial: Pick<Artist, 'bio' | 'genre' | 'location' | 'website_url' | 'tiktok_url' | 'instagram_url' | 'youtube_url' | 'spotify_url' | 'soundcloud_url' | 'featured_video_id'>;
};

// The claimed-artist self-service editor — the whitelist here mirrors
// CLAIMED_ARTIST_EDITABLE_FIELDS in lib/db.ts exactly (bio, genre,
// location, official website, platform links, featured video). Everything
// else about the roster row — name, stage, Scout notes, the Breakout Score
// inputs, internal discovery info — stays Scout-only; there's simply no
// field here for any of it, not a disabled one, so there's nothing to
// probe or bypass client-side.
export default function ArtistProfileEditForm({ artistId, initial }: Props) {
  const [form, setForm] = useState({
    bio: initial.bio ?? '', genre: initial.genre ?? '', location: initial.location ?? '', website_url: initial.website_url ?? '',
    tiktok_url: initial.tiktok_url ?? '', instagram_url: initial.instagram_url ?? '', youtube_url: initial.youtube_url ?? '',
    spotify_url: initial.spotify_url ?? '', soundcloud_url: initial.soundcloud_url ?? '', featured_video_id: initial.featured_video_id ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/next/my-artist/${artistId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
      setSaved(true);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = { border: '1px solid var(--border-soft)', background: 'var(--bg)', color: 'var(--text)' };

  return (
    <form onSubmit={submit} className="next-card p-6 flex flex-col gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.06em] font-mono m-0" style={{ color: 'var(--text-faint)' }}>Edit your profile</p>
        <p className="text-xs mt-1 m-0" style={{ color: 'var(--text-faint)' }}>
          Bio, genre, location, and your own links — this is what shows on your public NEXT page. Anything else (your NEXT Score, stage,
          Scout notes) is your Scout&apos;s call; send them a note below if something needs their attention.
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Bio</label>
        <textarea className="w-full min-h-[70px] rounded-[10px] px-3.5 py-2.5 text-sm outline-none mt-1" style={inputStyle} value={form.bio} onChange={(e) => set('bio', e.target.value)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Genre</label>
          <input className="w-full rounded-[10px] px-3.5 py-2.5 text-sm outline-none mt-1" style={inputStyle} value={form.genre} onChange={(e) => set('genre', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Location</label>
          <input className="w-full rounded-[10px] px-3.5 py-2.5 text-sm outline-none mt-1" style={inputStyle} value={form.location} onChange={(e) => set('location', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Website</label>
          <input className="w-full rounded-[10px] px-3.5 py-2.5 text-sm outline-none mt-1" style={inputStyle} value={form.website_url} onChange={(e) => set('website_url', e.target.value)} placeholder="https://…" />
        </div>
        <div>
          <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>TikTok</label>
          <input className="w-full rounded-[10px] px-3.5 py-2.5 text-sm outline-none mt-1" style={inputStyle} value={form.tiktok_url} onChange={(e) => set('tiktok_url', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Instagram</label>
          <input className="w-full rounded-[10px] px-3.5 py-2.5 text-sm outline-none mt-1" style={inputStyle} value={form.instagram_url} onChange={(e) => set('instagram_url', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>YouTube</label>
          <input className="w-full rounded-[10px] px-3.5 py-2.5 text-sm outline-none mt-1" style={inputStyle} value={form.youtube_url} onChange={(e) => set('youtube_url', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Spotify</label>
          <input className="w-full rounded-[10px] px-3.5 py-2.5 text-sm outline-none mt-1" style={inputStyle} value={form.spotify_url} onChange={(e) => set('spotify_url', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>SoundCloud</label>
          <input className="w-full rounded-[10px] px-3.5 py-2.5 text-sm outline-none mt-1" style={inputStyle} value={form.soundcloud_url} onChange={(e) => set('soundcloud_url', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Featured video (YouTube)</label>
          <input className="w-full rounded-[10px] px-3.5 py-2.5 text-sm outline-none mt-1" style={inputStyle} value={form.featured_video_id} onChange={(e) => set('featured_video_id', e.target.value)} placeholder="A YouTube link — plays behind your NEXT profile" />
        </div>
      </div>

      {error && <p className="text-sm m-0" style={{ color: 'var(--down)' }}>{error}</p>}
      {saved && <p className="text-sm m-0" style={{ color: 'var(--up)' }}>Saved.</p>}
      <button type="submit" className="next-btn-primary text-sm px-4 py-2.5 rounded-lg self-start" disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}
