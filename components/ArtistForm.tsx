'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { breakoutScore, engagementQualityScore, growthVelocityScore } from '@/lib/scoring';
import { Artist, ArtistInput, SCORE_LABELS, SCORE_WEIGHTS, STAGES, STAGE_LABELS, ScoreInputs } from '@/lib/types';
import { parseYoutubeVideoId } from '@/lib/youtube-url';
import ScoreBadge from './ScoreBadge';
import SoundchartsSearch from './SoundchartsSearch';
import SyncProvenance from './SyncProvenance';

// Growth Velocity and Engagement Quality are excluded here — they're no
// longer a human-rated slider, see the computed-value note in the Metrics
// section below instead.
const RATED_SCORE_FIELDS = (Object.keys(SCORE_WEIGHTS) as (keyof ScoreInputs)[]).filter(
  (f) => f !== 'growth_velocity' && f !== 'engagement_quality'
);

// 9-10 is the top 20% of the 0-10 scale — rare enough that a Scout should
// have a specific reason, not just "seems great." Encouraged with a
// visible prompt, never enforced (see high_rating_note in lib/types.ts).
const HIGH_RATING_THRESHOLD = 9;

type Props = {
  artist?: Artist;
};

export default function ArtistForm({ artist }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set only right after a successful create whose name collided with an
  // existing artist — see the duplicate-name handling comment in
  // app/api/artists/route.ts. Holds the redirect so the Scout gets a real
  // chance to notice before landing on the new artist's page.
  const [duplicateWarning, setDuplicateWarning] = useState<{ id: number; name: string; stage: string }[] | null>(null);
  const [createdArtistId, setCreatedArtistId] = useState<number | null>(null);
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
    featured_video_id: artist?.featured_video_id ?? '',
    high_rating_note: artist?.high_rating_note ?? '',
  }));

  // A 9-10 rating is a real outlier — worth a moment's "why," not a hard
  // gate on saving. See HIGH_RATING_THRESHOLD's own reasoning below.
  const hasHighRating = RATED_SCORE_FIELDS.some((field) => ((form[field] as number) ?? 0) >= HIGH_RATING_THRESHOLD);

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

  function unlinkSoundcharts() {
    setForm((f) => ({ ...f, soundcharts_uuid: '' }));
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
      const payload = {
        ...form,
        // Accept a pasted watch/share/shorts URL as well as a bare ID —
        // normalize to just the ID before it's stored.
        featured_video_id: form.featured_video_id ? parseYoutubeVideoId(form.featured_video_id) ?? form.featured_video_id : form.featured_video_id,
      };
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Save failed');
      }
      const saved = await res.json();
      if (!artist && saved.duplicateNameWarning?.length > 0) {
        // Hold the redirect — this is the one moment a Scout can actually
        // notice and act on a likely duplicate before it's just another row.
        setCreatedArtistId(saved.id);
        setDuplicateWarning(saved.duplicateNameWarning);
        return;
      }
      router.push(`/artists/${saved.id}`);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong saving this artist.');
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

  if (duplicateWarning && createdArtistId) {
    return (
      <div className="card space-y-4" style={{ borderColor: 'var(--fire-line)' }}>
        <h2 className="font-bold text-lg">Heads up — possible duplicate</h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          &quot;{form.name}&quot; was created, but an artist with this exact name already exists on the roster.
          If this is the same real artist, use the existing one instead — Scout doesn&apos;t merge duplicates
          automatically.
        </p>
        <ul className="text-sm space-y-1">
          {duplicateWarning.map((d) => (
            <li key={d.id}>
              <a className="underline" href={`/artists/${d.id}`}>{d.name}</a>{' '}
              <span style={{ color: 'var(--text-faint)' }}>({d.stage})</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-3">
          <button type="button" className="btn btn-primary" onClick={() => { router.push(`/artists/${createdArtistId}`); router.refresh(); }}>
            Continue to the new artist
          </button>
          <button type="button" className="btn" onClick={() => router.push('/')}>Back to dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <div className="card" style={{ borderColor: 'var(--down)', color: 'var(--down)' }}>{error}</div>}

      {artist && <SyncProvenance artist={artist} />}

      <SoundchartsSearch soundchartsUuid={form.soundcharts_uuid} onFill={fillFromSoundcharts} onUnlink={unlinkSoundcharts} />

      <div className="card space-y-4">
        <h2 className="font-bold text-lg">Basics</h2>
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
        <h2 className="font-bold text-lg">Media <span className="font-normal text-sm" style={{ color: 'var(--text-faint)' }}>— what NEXT users actually see</span></h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Photo URL</label>
            <input className="input" value={form.photo_url ?? ''} onChange={(e) => set('photo_url', e.target.value)} placeholder="https://…jpg" />
          </div>
          <div>
            <label className="label">30-second preview clip URL</label>
            <input className="input" value={form.song_preview_url ?? ''} onChange={(e) => set('song_preview_url', e.target.value)} placeholder="Direct link to an audio file (.mp3, .m4a…)" />
            <p className="text-xs mt-1" style={{ color: 'var(--accent)' }}>✓ Deezer sync fills this automatically when it finds a top track — only type one in to override it</p>
          </div>
          <div>
            <label className="label">Top song link</label>
            <input className="input" value={form.top_song_url ?? ''} onChange={(e) => set('top_song_url', e.target.value)} placeholder="Link to their best/most popular track" />
            <p className="text-xs mt-1" style={{ color: 'var(--accent)' }}>✓ Deezer sync fills this automatically (dashboard) — only type one in to override it</p>
          </div>
          <div>
            <label className="label">Why they&apos;re trending</label>
            <input className="input" value={form.why_trending ?? ''} onChange={(e) => set('why_trending', e.target.value)} placeholder="One line — shown right on the card" />
          </div>
          <div>
            <label className="label">Featured video</label>
            <input className="input" value={form.featured_video_id ?? ''} onChange={(e) => set('featured_video_id', e.target.value)} placeholder="YouTube link — plays behind their NEXT profile" />
            <p className="text-xs mt-1" style={{ color: 'var(--accent)' }}>✓ Filled automatically when approved from a YouTube discovery candidate — paste a link to override it</p>
          </div>
        </div>
        <div>
          <label className="label">Short bio</label>
          <textarea className="input min-h-[70px]" value={form.bio ?? ''} onChange={(e) => set('bio', e.target.value)} placeholder="A couple sentences for their NEXT page" />
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-bold text-lg">Platforms</h2>
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
        <h2 className="font-bold text-lg">Metrics</h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          30-day growth and engagement rate directly drive two of the Breakout Score categories below —
          no separate rating needed. Followers and 30-day growth fill automatically via Soundcharts sync
          when linked; monthly listeners and engagement rate stay manual — no API (Soundcharts&apos; or
          otherwise) exposes either of those for Spotify, on any plan.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="label">Followers</label>
            <input type="number" min={0} className="input" value={form.followers_count ?? ''} onChange={(e) => set('followers_count', e.target.value === '' ? undefined : Number(e.target.value))} />
            <p className="text-xs mt-1" style={{ color: 'var(--accent)' }}>✓ Soundcharts sync fills this when linked</p>
          </div>
          <div>
            <label className="label">Monthly listeners</label>
            <input type="number" min={0} className="input" value={form.monthly_listeners ?? ''} onChange={(e) => set('monthly_listeners', e.target.value === '' ? undefined : Number(e.target.value))} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>Manual only — Spotify doesn&apos;t expose this via any API</p>
          </div>
          <div>
            <label className="label">30-day growth %</label>
            <input type="number" step="0.1" className="input" value={form.growth_velocity_pct ?? ''} onChange={(e) => set('growth_velocity_pct', e.target.value === '' ? undefined : Number(e.target.value))} />
            <p className="text-xs mt-1" style={{ color: 'var(--accent)' }}>✓ Soundcharts sync fills this when linked · → Growth Velocity {liveGrowthScore.toFixed(1)}/10</p>
          </div>
          <div>
            <label className="label">Engagement rate %</label>
            <input type="number" step="0.1" className="input" value={form.engagement_rate_pct ?? ''} onChange={(e) => set('engagement_rate_pct', e.target.value === '' ? undefined : Number(e.target.value))} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>Manual only — not returned by Soundcharts on this plan · → Engagement Quality {liveEngagementScore.toFixed(1)}/10</p>
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-bold text-lg">Breakout Score inputs</h2>
          <ScoreBadge score={liveScore} size="lg" />
        </div>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Rate each category 0–10. Weighted automatically into the Breakout Score (music/talent counts most,
          professionalism/commercial potential count least). Growth Velocity and Engagement Quality aren't
          rated here anymore — they're computed from the real numbers in Metrics above.
        </p>
        <div className="flex items-center gap-4 text-sm rounded-lg px-4 py-3" style={{ border: '1px solid var(--border-soft)' }}>
          <span className="num" style={{ color: 'var(--text-muted)' }}>Growth Velocity <strong style={{ color: 'var(--text)' }}>{liveGrowthScore.toFixed(1)}/10</strong> · weight {SCORE_WEIGHTS.growth_velocity}%</span>
          <span className="num" style={{ color: 'var(--text-muted)' }}>Engagement Quality <strong style={{ color: 'var(--text)' }}>{liveEngagementScore.toFixed(1)}/10</strong> · weight {SCORE_WEIGHTS.engagement_quality}%</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          {RATED_SCORE_FIELDS.map((field) => (
            <div key={field}>
              <div className="flex items-center justify-between">
                <label className="label mb-0">{SCORE_LABELS[field]}</label>
                <span className="num text-sm" style={{ color: 'var(--text-muted)' }}>
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
        {hasHighRating && (
          <div className="space-y-2 rounded-lg px-4 py-3" style={{ border: '1px solid var(--fire-line)', background: 'var(--fire-dim)' }}>
            <label className="label mb-0" style={{ color: 'var(--fire)' }}>
              ⚠ At least one category is rated {HIGH_RATING_THRESHOLD}+ — why?
            </label>
            <textarea
              className="input min-h-[60px]"
              value={form.high_rating_note ?? ''}
              onChange={(e) => set('high_rating_note', e.target.value)}
              placeholder="What specifically justifies a top-tier rating here? (optional, but a 9-10 is rare — worth a sentence)"
            />
          </div>
        )}
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
          <button type="button" className="btn" style={{ color: 'var(--down)' }} onClick={handleDelete}>
            Remove artist
          </button>
        )}
      </div>
    </form>
  );
}
