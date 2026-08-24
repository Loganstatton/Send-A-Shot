import { ArtistFieldChange } from '@/lib/types';

const FIELD_LABELS: Record<string, string> = {
  name: 'Name', genre: 'Genre', location: 'Location', scout_name: 'Scout',
  tiktok_url: 'TikTok URL', instagram_url: 'Instagram URL', youtube_url: 'YouTube URL',
  spotify_url: 'Spotify URL', soundcloud_url: 'SoundCloud URL',
  followers_count: 'Followers', monthly_listeners: 'Monthly listeners',
  growth_velocity_pct: '30-day growth %', engagement_rate_pct: 'Engagement rate %',
  music_talent: 'Music/Talent', original_song_response: 'Original song response',
  brand_personality: 'Brand/Personality', content_consistency: 'Content consistency',
  commercial_potential: 'Commercial potential', professionalism: 'Professionalism',
  notes: 'Notes', photo_url: 'Photo URL', bio: 'Bio', top_song_url: 'Top song link',
  song_preview_url: 'Preview clip URL', why_trending: 'Why trending', soundcharts_uuid: 'Soundcharts link',
  featured_video_id: 'Featured video',
};

function truncate(value: string | null, max = 60): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// Field-level audit trail — see updateArtist in lib/db.ts. Only ever
// populated by a direct human edit (never an automated sync), and never
// for 'stage' (already visible in the Activity Log below as a
// status_change entry).
export default function ArtistFieldHistory({ history }: { history: ArtistFieldChange[] }) {
  if (history.length === 0) return null;

  return (
    <div className="card space-y-3">
      <h2 className="font-bold text-lg">Field edit history</h2>
      <div className="space-y-2">
        {history.map((h) => (
          <div key={h.id} className="text-sm pt-2" style={{ borderTop: '1px solid var(--border-soft)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{FIELD_LABELS[h.field] ?? h.field}</span>
              <span style={{ color: 'var(--text-faint)' }}>{new Date(h.created_at).toLocaleString()}</span>
              {h.actor_name && <span style={{ color: 'var(--text-faint)' }}>by {h.actor_name}</span>}
            </div>
            <p className="num mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {truncate(h.old_value)} → {truncate(h.new_value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
