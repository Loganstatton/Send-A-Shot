import Link from 'next/link';
import { getAllArtists, getDueFollowUps } from '@/lib/db';
import { requireInternal } from '@/lib/auth';
import { breakoutScore } from '@/lib/scoring';
import { STAGE_LABELS } from '@/lib/types';
import ScoreBadge from '@/components/ScoreBadge';
import FollowUpList from '@/components/FollowUpList';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requireInternal();
  const artists = getAllArtists()
    .map((a) => ({ ...a, score: breakoutScore(a) }))
    .sort((a, b) => b.score - a.score);
  const dueFollowUps = getDueFollowUps();

  const active = artists.filter((a) => a.stage !== 'passed');
  const fire = active.filter((a) => a.score >= 85).length;
  const watch = active.filter((a) => a.score >= 70 && a.score < 85).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Fastest Rising Artists</h1>
          <p className="text-neutral-400 text-sm">Sorted by Breakout Score. Get to them before anyone else does.</p>
        </div>
        <div className="flex gap-3">
          <div className="badge">Tracked: {active.length}</div>
          <div className="badge">🔥 Ready to contact: {fire}</div>
          <div className="badge">👀 Watching: {watch}</div>
        </div>
      </div>

      {active.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-neutral-400">No artists tracked yet.</p>
          <Link href="/artists/new" className="btn btn-primary mt-4 inline-flex">+ Add your first artist</Link>
        </div>
      )}

      <FollowUpList initial={dueFollowUps} />

      <div className="space-y-3">
        {active.map((artist, idx) => (
          <Link
            key={artist.id}
            href={`/artists/${artist.id}`}
            className="card flex items-center justify-between gap-4 hover:border-neutral-600 transition-colors"
          >
            <div className="flex items-center gap-4 min-w-0">
              <span className="text-neutral-500 font-mono text-sm w-6 shrink-0">#{idx + 1}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold truncate">{artist.name}</span>
                  <span className="badge">{STAGE_LABELS[artist.stage]}</span>
                  {artist.genre && <span className="text-xs text-neutral-500">{artist.genre}</span>}
                </div>
                <div className="text-sm text-neutral-400 mt-1 flex gap-4 flex-wrap">
                  {artist.followers_count != null && <span>{artist.followers_count.toLocaleString()} followers</span>}
                  {artist.growth_velocity_pct != null && <span>+{artist.growth_velocity_pct}%/mo</span>}
                  {artist.engagement_rate_pct != null && <span>{artist.engagement_rate_pct}% engagement</span>}
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
          <summary className="cursor-pointer text-neutral-400 text-sm">
            Passed ({artists.filter((a) => a.stage === 'passed').length})
          </summary>
          <div className="space-y-3 mt-3">
            {artists.filter((a) => a.stage === 'passed').map((artist) => (
              <Link key={artist.id} href={`/artists/${artist.id}`} className="card flex items-center justify-between gap-4 opacity-60 hover:opacity-100">
                <span className="font-semibold">{artist.name}</span>
                <ScoreBadge score={artist.score} size="sm" />
              </Link>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
