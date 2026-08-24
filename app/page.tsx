import Link from 'next/link';
import type { Metadata } from 'next';
import { getAllArtists, getArtistLastActivityMap, getArtistsInVideoBackoff, getDueFollowUps, getLatestSyncRun, getNewDiscoveryCandidateCount } from '@/lib/db';
import { requireInternal } from '@/lib/auth';
import { breakoutScore } from '@/lib/scoring';
import RosterList from '@/components/RosterList';
import NeedsActionToday from '@/components/NeedsActionToday';
import SyncAllButton from '@/components/SyncAllButton';
import DeezerSyncButton from '@/components/DeezerSyncButton';
import YoutubeVideoSyncButton from '@/components/YoutubeVideoSyncButton';

export const metadata: Metadata = { title: { absolute: 'Scout — Early Artist Discovery' } };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requireInternal();
  const lastActivity = getArtistLastActivityMap();
  const artists = getAllArtists()
    .map((a) => ({ ...a, score: breakoutScore(a), last_activity_at: lastActivity.get(a.id) }))
    .sort((a, b) => b.score - a.score);
  const dueFollowUps = getDueFollowUps();
  const newCandidateCount = getNewDiscoveryCandidateCount();
  const lastSync = getLatestSyncRun('soundcharts');
  const lastDeezerSync = getLatestSyncRun('deezer');
  const lastVideoSync = getLatestSyncRun('youtube_video');
  const videoBackoff = getArtistsInVideoBackoff();

  const active = artists.filter((a) => a.stage !== 'passed');
  const fire = active.filter((a) => a.score >= 85).length;
  const watch = active.filter((a) => a.score >= 70 && a.score < 85).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Fastest Rising Artists</h1>
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Sorted by Breakout Score. Get to them before anyone else does.</p>
        </div>
        <div className="flex gap-2">
          <div className="badge"><span className="num">{active.length}</span> tracked</div>
          <div className="badge" style={{ background: 'var(--fire-dim)', borderColor: 'var(--fire-line)', color: 'var(--fire)' }}>
            🔥 <span className="num">{fire}</span> ready to contact
          </div>
          <div className="badge" style={{ background: 'var(--accent-dim)', borderColor: 'var(--accent-line)', color: 'var(--accent)' }}>
            👀 <span className="num">{watch}</span> watching
          </div>
        </div>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex flex-col items-start gap-2">
          <SyncAllButton />
          <DeezerSyncButton />
          <YoutubeVideoSyncButton />
        </div>
        <div className="text-right space-y-1">
          {lastSync && (
            <p className="num text-xs" style={{ color: 'var(--text-faint)' }}>
              Last Soundcharts sync: {new Date(lastSync.started_at).toLocaleString()} —{' '}
              {lastSync.status === 'failed'
                ? <span style={{ color: 'var(--down)' }}>failed: {lastSync.error}</span>
                : `checked ${lastSync.checked_count}, updated ${lastSync.updated_count}${lastSync.failed_count > 0 ? `, ${lastSync.failed_count} failed` : ''}`}
            </p>
          )}
          {lastDeezerSync && (
            <p className="num text-xs" style={{ color: 'var(--text-faint)' }}>
              Last Deezer sync: {new Date(lastDeezerSync.started_at).toLocaleString()} —{' '}
              {lastDeezerSync.status === 'failed'
                ? <span style={{ color: 'var(--down)' }}>failed: {lastDeezerSync.error}</span>
                : <>
                    checked {lastDeezerSync.checked_count}, updated {lastDeezerSync.updated_count}.
                    {(lastDeezerSync.no_match_count ?? 0) > 0 && ` ${lastDeezerSync.no_match_count} no Deezer match.`}
                    {(lastDeezerSync.error_count ?? 0) > 0 && (
                      <span style={{ color: 'var(--down)' }}>
                        {' '}{lastDeezerSync.error_count} lookup error{lastDeezerSync.error_count === 1 ? '' : 's'}
                        {lastDeezerSync.last_error ? ` (${lastDeezerSync.last_error})` : ''}.
                      </span>
                    )}
                  </>}
            </p>
          )}
          {lastVideoSync && (
            <p className="num text-xs" style={{ color: 'var(--text-faint)' }}>
              Last video backfill: {new Date(lastVideoSync.started_at).toLocaleString()} —{' '}
              {lastVideoSync.status === 'failed'
                ? <span style={{ color: 'var(--down)' }}>failed: {lastVideoSync.error}</span>
                : <>
                    checked {lastVideoSync.checked_count}, updated {lastVideoSync.updated_count}.
                    {(lastVideoSync.no_match_count ?? 0) > 0 && ` ${lastVideoSync.no_match_count} no video match.`}
                    {(lastVideoSync.error_count ?? 0) > 0 && (
                      <span style={{ color: 'var(--down)' }}>
                        {' '}{lastVideoSync.error_count} lookup error{lastVideoSync.error_count === 1 ? '' : 's'}
                        {lastVideoSync.last_error ? ` (${lastVideoSync.last_error})` : ''}.
                      </span>
                    )}
                    {/* "checked 0" alone reads as broken even though it usually
                        just means everything's already covered or in the
                        recheck backoff — say which, right where this is seen. */}
                    {lastVideoSync.checked_count === 0 && lastVideoSync.updated_count === 0 && videoBackoff.count > 0 && (
                      ` ${videoBackoff.count} artist(s) were checked recently with no match and are excluded until their recheck window opens.`
                    )}
                  </>}
            </p>
          )}
        </div>
      </div>

      {active.length === 0 && (
        <div className="card text-center py-12">
          <p style={{ color: 'var(--text-muted)' }}>No artists tracked yet.</p>
          <Link href="/artists/new" className="btn btn-primary mt-4 inline-flex">+ Add your first artist</Link>
        </div>
      )}

      <NeedsActionToday initialFollowUps={dueFollowUps} newCandidateCount={newCandidateCount} />

      <RosterList artists={artists} />

      <div className="card text-sm" style={{ color: 'var(--text-muted)' }}>
        <p>
          <strong>Scout:</strong> internal tool for tracking emerging, unsigned artists and scoring
          their breakout potential before they build a professional team. Data is stored locally in
          SQLite — this is a discovery/scoring tool, not a contract or payments system. Not visible to
          NEXT (public) users.
        </p>
      </div>
    </div>
  );
}
