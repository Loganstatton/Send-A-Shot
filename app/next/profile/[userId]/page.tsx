import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getFoundingBelieverRecordsForUser, getScoutProfile } from '@/lib/db';
import { getSessionUser, requireUser } from '@/lib/auth';
import { EARLY_DISCOVERY_RANK_THRESHOLD } from '@/lib/scout-score';
import ArtistAvatar from '@/components/ArtistAvatar';
import StatTile from '@/components/StatTile';

export async function generateMetadata({ params }: { params: { userId: string } }): Promise<Metadata> {
  const profile = getScoutProfile(Number(params.userId));
  return { title: profile ? `${profile.user.name}'s Scout Profile` : 'Scout Profile' };
}

export const dynamic = 'force-dynamic';

// Public — any logged-in user (NEXT trader or Scout staff) can view anyone's
// Scout Profile, same as a leaderboard is meant to be seen by everyone. Only
// what's already public-safe is shown: name, Scout Score, portfolio return,
// rank, and the Founding Believer trophy case. No email, no credits balance
// beyond the return %.
export default async function ScoutProfilePage({ params }: { params: { userId: string } }) {
  await requireUser();
  const userId = Number(params.userId);
  if (!Number.isInteger(userId)) notFound();
  const profile = getScoutProfile(userId);
  if (!profile) notFound();

  const viewer = await getSessionUser();
  const isOwnProfile = viewer?.id === userId;
  const founded = getFoundingBelieverRecordsForUser(userId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <ArtistAvatar name={profile.user.name} size="lg" />
        <div>
          <h1 className="text-2xl font-semibold">{profile.user.name}{isOwnProfile ? ' (you)' : ''}</h1>
          <p className="text-neutral-400 text-sm">Rank #{profile.rank} of {profile.totalScouts} Scouts</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Scout Score" value={profile.scoutScoreValue.toFixed(0)} />
        <StatTile
          label="Portfolio return"
          value={`${profile.portfolio.totalReturnPct > 0 ? '+' : ''}${profile.portfolio.totalReturnPct}%`}
          deltaTone={profile.portfolio.totalReturnPct >= 0 ? 'up' : 'down'}
        />
        <StatTile label="Artists backed" value={String(profile.artistsBackedCount)} />
        <StatTile label="Early discoveries" value={String(profile.earlyDiscoveriesCount)} />
      </div>

      <div className="card text-xs text-neutral-500">
        Scout Score starts at 50 and moves with all-time portfolio return (capped) plus a bonus for being
        among the first {EARLY_DISCOVERY_RANK_THRESHOLD} backers of an artist — being early counts on its
        own, whether or not the position is still held.
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-lg">🏆 Founding Believer</h2>
        {founded.length === 0 && (
          <div className="card text-center py-8">
            <p className="text-neutral-400">
              {isOwnProfile ? "You haven't backed anyone yet." : `${profile.user.name} hasn't backed anyone yet.`}
            </p>
            {isOwnProfile && <Link href="/next" className="btn btn-primary mt-4 inline-flex">Browse NEXT</Link>}
          </div>
        )}
        {founded.map((f) => (
          <Link
            key={f.id}
            href={`/next/artists/${f.artist_id}`}
            className="card flex items-center gap-4 hover:border-neutral-600 transition-colors"
          >
            <ArtistAvatar name={f.artist_name} photoUrl={f.artist_photo_url} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate">{f.artist_name}</div>
              <div className="text-sm text-neutral-400">
                Backed {new Date(f.purchased_at).toLocaleDateString()}
                {f.followers_count != null && ` · ${f.followers_count.toLocaleString()} followers then`}
              </div>
            </div>
            {f.discovery_rank <= EARLY_DISCOVERY_RANK_THRESHOLD && (
              <span className="badge text-xs shrink-0">🏆 #{f.discovery_rank} backer</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
