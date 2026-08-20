'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { breakoutScore } from '@/lib/scoring';
import { Artist, ArtistInput, SCORE_LABELS, SCORE_WEIGHTS, STAGES, STAGE_LABELS, ScoreInputs } from '@/lib/types';
import ScoreBadge from './ScoreBadge';

const SCORE_FIELDS = Object.keys(SCORE_WEIGHTS) as (keyof ScoreInputs)[];

type Props = {
  artist?: Artist;
};

export default function ArtistForm({ artist }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ArtistInput>(() => ({
    name: artist?.name ?? '',
    stage: artist?.stage ?? 'watchlist',
    genre: artist?.genre ?? '',
    location: artist?.location ?? '',
    scout_name: artist?.scout_name ?? '',
    tiktok_url: artist?.tiktok_url ?? '',
    instagram_url: artist?.instagram_url ?? '',
    youtube_url: artist?.youtube_url ?? '',
    spotify_url: artist?.spotify_url ?? '',
    soundcloud_url: artist?.soundcloud_url ?? '',
    followers_count: artist?.followers_count ?? undefined,
    monthly_listeners: artist?.monthly_listeners ?? undefined,
    growth_velocity_pct: artist?.growth_velocity_pct ?? undefined,
    engagement_rate_pct: artist?.engagement_rate_pct ?? undefined,
    music_talent: artist?.music_talent ?? 5,
    growth_velocity: artist?.growth_velocity ?? 5,
    engagement_quality: artist?.engagement_quality ?? 5,
    original_song_response: artist?.original_song_response ?? 5,
    brand_personality: artist?.brand_personality ?? 5,
    content_consistency: artist?.content_consistency ?? 5,
    commercial_potential: artist?.commercial_potential ?? 5,
    professionalism: artist?.professionalism ?? 5,
    notes: artist?.notes ?? '',
  }));

  const liveScore = breakoutScore({
    music_talent: form.music_talent ?? 0,
    growth_velocity: form.growth_velocity ?? 0,
    engagement_quality: form.engagement_quality ?? 0,
    original_song_response: form.original_song_response ?? 0,
    brand_personality: form.brand_personality ?? 0,
    content_consistency: form.content_consistency ?? 0,
    commercial_potential: form.commercial_potential ?? 0,
    professionalism: form.professionalism ?? 0,
  });

  function set<K extends keyof ArtistInput>(key: K, value: ArtistInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = artist ? `/api/artists/${artist.id}` : '/api/artists';
      const method = artist ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Save failed');
      const saved = await res.json();
      router.push(`/artists/${saved.id}`);
      router.refresh();
    } catch (err) {
      setError('Something went wrong saving this artist.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!artist) return;
    if (!confirm(`Remove ${artist.name} from the roster? This can't be undone.`)) return;
    await fetch(`/api/artists/${artist.id}`, { method: 'DELETE' });
    router.push('/');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <div className="card border-red-500/40 text-red-300">{error}</div>}

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg">Basics</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Name *</label>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div>
            <label className="label">Stage</label>
            <select className="input" value={form.stage} onChange={(e) => set('stage', e.target.value as any)}>
              {STAGES.map((s) => (
                <option key={s} value={s}>{STAGE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Genre</label>
            <input className="input" value={form.genre ?? ''} onChange={(e) => set('genre', e.target.value)} placeholder="Pop/R&B" />
          </div>
          <div>
            <label className="label">Location</label>
            <input className="input" value={form.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder="Austin, TX" />
          </div>
          <div>
            <label className="label">Scout</label>
            <input className="input" value={form.scout_name ?? ''} onChange={(e) => set('scout_name', e.target.value)} placeholder="Who found them" />
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg">Platforms</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">TikTok URL</label>
            <input className="input" value={form.tiktok_url ?? ''} onChange={(e) => set('tiktok_url', e.target.value)} />
          </div>
          <div>
            <label className="label">Instagram URL</label>
            <input className="input" value={form.instagram_url ?? ''} onChange={(e) => set('instagram_url', e.target.value)} />
          </div>
          <div>
            <label className="label">YouTube URL</label>
            <input className="input" value={form.youtube_url ?? ''} onChange={(e) => set('youtube_url', e.target.value)} />
          </div>
          <div>
            <label className="label">Spotify URL</label>
            <input className="input" value={form.spotify_url ?? ''} onChange={(e) => set('spotify_url', e.target.value)} />
          </div>
          <div>
            <label className="label">SoundCloud URL</label>
            <input className="input" value={form.soundcloud_url ?? ''} onChange={(e) => set('soundcloud_url', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg">Metrics</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="label">Followers</label>
            <input type="number" min={0} className="input" value={form.followers_count ?? ''} onChange={(e) => set('followers_count', e.target.value === '' ? undefined : Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Monthly listeners</label>
            <input type="number" min={0} className="input" value={form.monthly_listeners ?? ''} onChange={(e) => set('monthly_listeners', e.target.value === '' ? undefined : Number(e.target.value))} />
          </div>
          <div>
            <label className="label">30-day growth %</label>
            <input type="number" step="0.1" className="input" value={form.growth_velocity_pct ?? ''} onChange={(e) => set('growth_velocity_pct', e.target.value === '' ? undefined : Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Engagement rate %</label>
            <input type="number" step="0.1" className="input" value={form.engagement_rate_pct ?? ''} onChange={(e) => set('engagement_rate_pct', e.target.value === '' ? undefined : Number(e.target.value))} />
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-lg">Breakout Score inputs</h2>
          <ScoreBadge score={liveScore} size="lg" />
        </div>
        <p className="text-sm text-neutral-400">
          Rate each category 0–10. Weighted automatically into the Breakout Score (music/talent counts most, professionalism/commercial potential count least).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          {SCORE_FIELDS.map((field) => (
            <div key={field}>
              <div className="flex items-center justify-between">
                <label className="label mb-0">{SCORE_LABELS[field]}</label>
                <span className="text-sm text-neutral-400">
                  {(form[field] as number) ?? 0}/10 · weight {SCORE_WEIGHTS[field]}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={0.5}
                className="slider"
                value={(form[field] as number) ?? 0}
                onChange={(e) => set(field, Number(e.target.value) as any)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card space-y-2">
        <label className="label">Notes</label>
        <textarea
          className="input min-h-[100px]"
          value={form.notes ?? ''}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Why is this artist interesting? What made you add them?"
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : artist ? 'Save changes' : 'Add to watchlist'}
          </button>
          <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
        </div>
        {artist && (
          <button type="button" className="btn text-red-300" onClick={handleDelete}>
            Remove artist
          </button>
        )}
      </div>
    </form>
  );
}
