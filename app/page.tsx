import Link from 'next/link';
import type { Metadata } from 'next';
import { getAllArtists, getDueFollowUps, getLatestSyncRun } from '@/lib/db';
import { requireInternal } from '@/lib/auth';
import { breakoutScore } from '@/lib/scoring';
import { STAGE_LABELS } from '@/lib/types';
import ScoreBadge from '@/components/ScoreBadge';
import FollowUpList from '@/components/FollowUpList';
import SyncAllButton from '@/components/SyncAllButton';
import DeezerSyncButton from '@/components/DeezerSyncButton';

export const metadata: Metadata = { title: { absolute: 'Scout — Early Artist Discovery' } };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requireInternal();
  const artists = getAllArtists()
    .map((a) => ({ ...a, score: breakoutScore(a) }))
    .sort((a, b) => b.score - a.score);
  const dueFollowUps = getDueFollowUps();
  const lastSync = getLatestSyncRun('soundcharts');
  const lastDeezerSync = getLatestSyncRun('deezer');

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
        </div>
      </div>

      {active.length === 0 && (
        <div className="card text-center py-12">
          <p style={{ color: 'var(--text-muted)' }}>No artists tracked yet.</p>
          <Link href="/artists/new" className="btn btn-primary mt-4 inline-flex">+ Add your first artist</Link>
        </div>
      )}

      <FollowUpList initial={dueFollowUps} />

      <div className="space-y-3">
        {active.map((artist, idx) => (
          <Link
            key={artist.id}
            href={`/artists/${artist.id}`}
            className="card card-hover flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-4 min-w-0">
              <span className="num text-sm w-6 shrink-0" style={{ color: 'var(--text-faint)' }}>#{idx + 1}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold truncate">{artist.name}</span>
                  <span className="badge">{STAGE_LABELS[artist.stage]}</span>
                  {artist.genre && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{artist.genre}</span>}
                </div>
                <div className="text-sm mt-1 flex gap-4 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                  {artist.followers_count != null && <span className="num">{artist.followers_count.toLocaleString()} followers</span>}
                  {artist.growth_velocity_pct != null && <span className="num" style={{ color: 'var(--up)' }}>+{artist.growth_velocity_pct}%/mo</span>}
                  {artist.engagement_rate_pct != null && <span className="num">{artist.engagement_rate_pct}% engagement</span>}
                  {artist.created_by_name && <span>Added by {artist.created_by_name}</span>}
                </div>
              </div>
            </div>
            <ScoreBadge score={artist.score} />
          </Link>
        ))}
      </div>

      {artists.some((a) => a.stage === 'passed') && (
        <details className="card">
          <summary className="cursor-pointer text-sm" style={{ color: 'var(--text-muted)' }}>
            Passed ({artists.filter((a) => a.stage === 'passed').length})
          </summary>
          <div className="space-y-3 mt-3">
            {artists.filter((a) => a.stage === 'passed').map((artist) => (
              <Link key={artist.id} href={`/artists/${artist.id}`} className="card card-hover flex items-center justify-between gap-4 opacity-60 hover:opacity-100">
                <span className="font-semibold">{artist.name}</span>
                <ScoreBadge score={artist.score} size="sm" />
              </Link>
            ))}
          </div>
        </details>
      )}

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
