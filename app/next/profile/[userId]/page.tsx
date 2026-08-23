import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getFoundingBelieverRecordsForUser, getScoutProfile } from '@/lib/db';
import { getSessionUser, requireUser } from '@/lib/auth';
import { EARLY_DISCOVERY_RANK_THRESHOLD } from '@/lib/scout-score';
import ArtistAvatar from '@/components/ArtistAvatar';
import NextStatTile from '@/components/next/NextStatTile';

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
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-4">
        <ArtistAvatar name={profile.user.name} size="lg" />
        <div>
          <h1 className="font-display font-bold text-[28px] m-0 tracking-[-0.01em]">
            {profile.user.name}{isOwnProfile ? ' (you)' : ''}
          </h1>
          <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>Rank #{profile.rank} of {profile.totalScouts} Scouts</p>
        </div>
      </div>

      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-2xl overflow-hidden border"
        style={{ background: 'var(--border-soft)', borderColor: 'var(--border-soft)' }}
      >
        <NextStatTile label="Scout Score" value={profile.scoutScoreValue.toFixed(0)} />
        <NextStatTile
          label="Portfolio return"
          value={`${profile.portfolio.totalReturnPct > 0 ? '+' : ''}${profile.portfolio.totalReturnPct}%`}
          valueTone={profile.portfolio.totalReturnPct >= 0 ? 'up' : 'down'}
        />
        <NextStatTile label="Artists backed" value={String(profile.artistsBackedCount)} />
        <NextStatTile label="Early discoveries" value={String(profile.earlyDiscoveriesCount)} />
      </div>

      <div className="next-card p-4 text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        Scout Score starts at 50 and moves with all-time portfolio return (capped) plus a bonus for being
        among the first {EARLY_DISCOVERY_RANK_THRESHOLD} backers of an artist — being early counts on its
        own, whether or not the position is still held.
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display font-bold text-lg m-0 flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth={2}><path d="M8 21h8M12 17v4M17 5V3H7v2M17 5a5 5 0 0 1-5 5 5 5 0 0 1-5-5M17 5h2a2 2 0 0 1-2 4M7 5H5a2 2 0 0 0 2 4" /></svg>
          Founding Believer
        </h2>
        {founded.length === 0 && (
          <div className="next-card text-center py-10">
            <p className="m-0" style={{ color: 'var(--text-muted)' }}>
              {isOwnProfile ? "You haven't backed anyone yet." : `${profile.user.name} hasn't backed anyone yet.`}
            </p>
            {isOwnProfile && <Link href="/next" className="next-btn-primary mt-4 inline-flex px-5 py-2.5 rounded-[10px] text-sm">Browse NEXT</Link>}
          </div>
        )}
        {founded.map((f) => (
          <Link key={f.id} href={`/next/artists/${f.artist_id}`} className="next-card next-card-hover flex items-center gap-4 px-5 py-4">
            <ArtistAvatar name={f.artist_name} photoUrl={f.artist_photo_url} />
            <div className="min-w-0 flex-1">
              <div className="font-display font-semibold truncate">{f.artist_name}</div>
              <div className="text-sm" style={{ color: 'var(--text-faint)' }}>
                Backed {new Date(f.purchased_at).toLocaleDateString()}
                {f.followers_count != null && ` · ${f.followers_count.toLocaleString()} followers then`}
              </div>
            </div>
            {f.discovery_rank <= EARLY_DISCOVERY_RANK_THRESHOLD && (
              <span
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold shrink-0"
                style={{ background: 'var(--gold-dim)', borderColor: 'var(--gold-line)', color: 'var(--gold)' }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth={2}><path d="M8 21h8M12 17v4M17 5V3H7v2M17 5a5 5 0 0 1-5 5 5 5 0 0 1-5-5M17 5h2a2 2 0 0 1-2 4M7 5H5a2 2 0 0 0 2 4" /></svg>
                #{f.discovery_rank} backer
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
