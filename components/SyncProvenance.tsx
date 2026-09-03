import { Artist } from '@/lib/types';

function relativeTime(iso?: string): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Per-artist source attribution + freshness — what Phase 4's "External
// data" checklist section actually asks for isn't visible anywhere else:
// the dashboard's sync widget (app/page.tsx) only shows aggregate,
// whole-batch run stats, never which specific artist was actually touched
// or when.
export default function SyncProvenance({ artist }: { artist: Artist }) {
  const videoNote =
    artist.featured_video_match_type === 'search_unverified'
      ? { text: '⚠ matched via unverified search — double-check it\'s the right artist', tone: 'var(--down)' }
      : artist.featured_video_match_type === 'search_matched_name'
      ? { text: 'matched via search (channel name matched)', tone: 'var(--text-faint)' }
      : artist.featured_video_match_type === 'channel'
      ? { text: 'matched via known channel', tone: 'var(--text-faint)' }
      : null;

  return (
    <div className="card space-y-2">
      <h2 className="font-bold text-lg">Data sources</h2>
      <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
        Where each field on this artist last came from, and when it was last checked — every sync
        route stamps these; a Scout typing something in by hand doesn&apos;t.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <span className="font-semibold">Soundcharts</span>
          <p style={{ color: 'var(--text-muted)' }}>
            {artist.soundcharts_uuid ? `linked · synced ${relativeTime(artist.soundcharts_synced_at)}` : 'not linked'}
          </p>
        </div>
        <div>
          <span className="font-semibold">Deezer preview</span>
          <p style={{ color: 'var(--text-muted)' }}>
            {artist.song_preview_url ? `synced ${relativeTime(artist.deezer_synced_at)}` : `no match yet${artist.deezer_synced_at ? ` (checked ${relativeTime(artist.deezer_synced_at)})` : ''}`}
          </p>
        </div>
        <div>
          <span className="font-semibold">YouTube video</span>
          <p style={{ color: 'var(--text-muted)' }}>
            {artist.featured_video_id
              ? <>synced {relativeTime(artist.youtube_synced_at)}{videoNote && <><br /><span style={{ color: videoNote.tone }}>{videoNote.text}</span></>}</>
              : `no video yet${artist.youtube_synced_at ? ` (checked ${relativeTime(artist.youtube_synced_at)})` : ''}`}
          </p>
        </div>
        <div>
          <span className="font-semibold">Wikidata</span>
          <p style={{ color: 'var(--text-muted)' }}>
            {artist.wikidata_qid
              ? `matched (${artist.wikidata_qid}) · ${relativeTime(artist.wikidata_fetched_at)}`
              : artist.wikidata_no_match_at
              ? `no match (checked ${relativeTime(artist.wikidata_no_match_at)})`
              : 'not checked yet'}
          </p>
        </div>
      </div>
    </div>
  );
}
