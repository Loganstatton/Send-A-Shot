'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { breakoutScore, engagementQualityScore, growthVelocityScore } from '@/lib/scoring';
import { Artist, ArtistInput, SCORE_LABELS, SCORE_WEIGHTS, STAGES, STAGE_LABELS, ScoreInputs } from '@/lib/types';
import ScoreBadge from './ScoreBadge';
import SoundchartsSearch from './SoundchartsSearch';

// Growth Velocity and Engagement Quality are excluded here — they're no
// longer a human-rated slider, see the computed-value note in the Metrics
// section below instead.
const RATED_SCORE_FIELDS = (Object.keys(SCORE_WEIGHTS) as (keyof ScoreInputs)[]).filter(
  (f) => f !== 'growth_velocity' && f !== 'engagement_quality'
);

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
    original_song_response: artist?.original_song_response ?? 5,
    brand_personality: artist?.brand_personality ?? 5,
    content_consistency: artist?.content_consistency ?? 5,
    commercial_potential: artist?.commercial_potential ?? 5,
    professionalism: artist?.professionalism ?? 5,
    notes: artist?.notes ?? '',
    photo_url: artist?.photo_url ?? '',
    bio: artist?.bio ?? '',
    top_song_url: artist?.top_song_url ?? '',
    song_preview_url: artist?.song_preview_url ?? '',
    why_trending: artist?.why_trending ?? '',
    soundcharts_uuid: artist?.soundcharts_uuid ?? undefined,
  }));

  const liveGrowthScore = growthVelocityScore(form.growth_velocity_pct);
  const liveEngagementScore = engagementQualityScore(form.engagement_rate_pct);

  const liveScore = breakoutScore({
    music_talent: form.music_talent ?? 0,
    growth_velocity: liveGrowthScore,
    engagement_quality: liveEngagementScore,
    original_song_response: form.original_song_response ?? 0,
    brand_personality: form.brand_personality ?? 0,
    content_consistency: form.content_consistency ?? 0,
    commercial_potential: form.commercial_potential ?? 0,
    professionalism: form.professionalism ?? 0,
  });

  function set<K extends keyof ArtistInput>(key: K, value: ArtistInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function fillFromSoundcharts(data: Partial<ArtistInput>) {
    setForm((f) => ({ ...f, ...data }));
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

      <SoundchartsSearch soundchartsUuid={form.soundcharts_uuid} onFill={fillFromSoundcharts} />

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
        <h2 className="font-semibold text-lg">Media <span className="font-normal text-sm text-neutral-500">— what NEXT users actually see</span></h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Photo URL</label>
            <input className="input" value={form.photo_url ?? ''} onChange={(e) => set('photo_url', e.target.value)} placeholder="https://…jpg" />
          </div>
          <div>
            <label className="label">30-second preview clip URL</label>
            <input className="input" value={form.song_preview_url ?? ''} onChange={(e) => set('song_preview_url', e.target.value)} placeholder="Direct link to an audio file (.mp3, .m4a…)" />
            <p className="text-xs text-neutral-500 mt-1">Spotify sync fills this when it can — Spotify has stopped returning a preview clip for a growing share of tracks, so this often stays empty even when Top song link fills in fine</p>
          </div>
          <div>
            <label className="label">Top song link</label>
            <input className="input" value={form.top_song_url ?? ''} onChange={(e) => set('top_song_url', e.target.value)} placeholder="Link to their best/most popular track" />
            <p className="text-xs text-neutral-500 mt-1">✓ Spotify sync fills this automatically (dashboard) — only type one in to override it</p>
          </div>
          <div>
            <label className="label">Why they&apos;re trending</label>
            <input className="input" value={form.why_trending ?? ''} onChange={(e) => set('why_trending', e.target.value)} placeholder="One line — shown right on the card" />
          </div>
        </div>
        <div>
          <label className="label">Short bio</label>
          <textarea className="input min-h-[70px]" value={form.bio ?? ''} onChange={(e) => set('bio', e.target.value)} placeholder="A couple sentences for their NEXT page" />
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
        <p className="text-sm text-neutral-400">
          30-day growth and engagement rate directly drive two of the Breakout Score categories below —
          no separate rating needed. Followers and 30-day growth fill automatically via Soundcharts sync
          when linked; monthly listeners and engagement rate stay manual — no API (Soundcharts&apos; or
          otherwise) exposes either of those for Spotify, on any plan.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="label">Followers</label>
            <input type="number" min={0} className="input" value={form.followers_count ?? ''} onChange={(e) => set('followers_count', e.target.value === '' ? undefined : Number(e.target.value))} />
            <p className="text-xs text-neutral-500 mt-1">✓ Soundcharts sync fills this when linked</p>
          </div>
          <div>
            <label className="label">Monthly listeners</label>
            <input type="number" min={0} className="input" value={form.monthly_listeners ?? ''} onChange={(e) => set('monthly_listeners', e.target.value === '' ? undefined : Number(e.target.value))} />
            <p className="text-xs text-neutral-500 mt-1">Manual only — Spotify doesn&apos;t expose this via any API</p>
          </div>
          <div>
            <label className="label">30-day growth %</label>
            <input type="number" step="0.1" className="input" value={form.growth_velocity_pct ?? ''} onChange={(e) => set('growth_velocity_pct', e.target.value === '' ? undefined : Number(e.target.value))} />
            <p className="text-xs text-neutral-500 mt-1">✓ Soundcharts sync fills this when linked · → Growth Velocity {liveGrowthScore.toFixed(1)}/10</p>
          </div>
          <div>
            <label className="label">Engagement rate %</label>
            <input type="number" step="0.1" className="input" value={form.engagement_rate_pct ?? ''} onChange={(e) => set('engagement_rate_pct', e.target.value === '' ? undefined : Number(e.target.value))} />
            <p className="text-xs text-neutral-500 mt-1">Manual only — not returned by Soundcharts on this plan · → Engagement Quality {liveEngagementScore.toFixed(1)}/10</p>
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-lg">Breakout Score inputs</h2>
          <ScoreBadge score={liveScore} size="lg" />
        </div>
        <p className="text-sm text-neutral-400">
          Rate each category 0–10. Weighted automatically into the Breakout Score (music/talent counts most,
          professionalism/commercial potential count least). Growth Velocity and Engagement Quality aren't
          rated here anymore — they're computed from the real numbers in Metrics above.
        </p>
        <div className="flex items-center gap-4 text-sm border border-neutral-800 rounded-lg px-4 py-3">
          <span className="text-neutral-400">Growth Velocity <strong className="text-white">{liveGrowthScore.toFixed(1)}/10</strong> · weight {SCORE_WEIGHTS.growth_velocity}%</span>
          <span className="text-neutral-400">Engagement Quality <strong className="text-white">{liveEngagementScore.toFixed(1)}/10</strong> · weight {SCORE_WEIGHTS.engagement_quality}%</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          {RATED_SCORE_FIELDS.map((field) => (
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
