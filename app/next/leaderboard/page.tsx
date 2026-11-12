import Link from 'next/link';
import type { Metadata } from 'next';
import { getAvailableGenres, getDiscoveryLeaderboard, getGenreLeaderboard, getScoutLeaderboard } from '@/lib/db';
import { formatCents } from '@/lib/format';
import { LeaderboardWindow } from '@/lib/types';
import ArtistAvatar from '@/components/ArtistAvatar';
import { getReputationLeaderboard, QUALIFYING_MIN_BACKINGS, REPUTATION_MIN_PICKS } from '@/lib/reputation';
import { getChallengeLeaderboard, STREAK_MIN } from '@/lib/challenges';

export const metadata: Metadata = { title: 'Leaderboard' };
export const dynamic = 'force-dynamic';

const WINDOW_LABELS: Record<LeaderboardWindow, string> = { week: 'This week', month: 'This month', all: 'All time' };
const WINDOWS = Object.keys(WINDOW_LABELS) as LeaderboardWindow[];

function RankChange({ change }: { change: number | null }) {
  if (change == null) return <span className="text-[11px] w-8 text-center shrink-0" style={{ color: 'var(--text-faint)' }}>New</span>;
  if (change === 0) return <span className="text-[11px] w-8 text-center shrink-0" style={{ color: 'var(--text-faint)' }}>—</span>;
  const up = change > 0;
  return (
    <span className="num text-[11px] font-semibold w-8 text-center shrink-0" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
      {up ? '▲' : '▼'}{Math.abs(change)}
    </span>
  );
}

export default async function LeaderboardPage(
  props: { searchParams: Promise<{ genre?: string; window?: string; board?: string }> }
) {
  const searchParams = await props.searchParams;
  // Public, like the rest of what a shared link can point to: names,
  // return %, and discovery counts only — nothing private.
  const genres = await getAvailableGenres();
  const activeDiscoverers = searchParams.board === 'discoverers';
  const activeTalent = searchParams.board === 'talent';
  const activeChallenges = searchParams.board === 'challenges';
  const otherBoard = activeDiscoverers || activeTalent || activeChallenges;
  const activeGenre = !otherBoard && searchParams.genre && genres.includes(searchParams.genre) ? searchParams.genre : null;
  const activeWindow: LeaderboardWindow = WINDOWS.includes(searchParams.window as LeaderboardWindow) ? (searchParams.window as LeaderboardWindow) : 'all';

  // Anti-gaming baseline: a Scout with zero activity doesn't appear on the
  // competitive board at all, so an untouched account can't sit tied at the
  // top by default before anything is ever staked on rank. Same rule the
  // genre board already applies (see getGenreLeaderboard) — deeper abuse
  // detection (wash trading, coordinated accounts) is Phase 8 scope, for
  // once real prizes/rewards are on the table.
  const topScouts = activeGenre || otherBoard ? null : (await getScoutLeaderboard(activeWindow)).filter((e) => e.artistsBackedCount > 0);
  const genreBoard = activeGenre ? await getGenreLeaderboard(activeGenre) : null;
  const discoveryBoard = activeDiscoverers ? (await getDiscoveryLeaderboard()).filter((e) => e.approvedDiscoveriesCount > 0) : null;
  const talentBoard = activeTalent ? await getReputationLeaderboard() : null;
  const challengeBoard = activeChallenges ? await getChallengeLeaderboard() : null;

  const pillClass = (active: boolean) => `next-pill ${active ? 'next-pill-active' : ''}`;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">Leaderboard</h1>
        <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
          Several ways to rank: trading, spotting artists early, finding new ones, weekly challenges and genres. Virtual credits
          only — no real money changes hands.{' '}
          <Link href="/next/leagues" className="underline underline-offset-2" style={{ color: 'var(--text-muted)' }}>Compete with just your friends in a private league</Link>
        </p>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Link href="/next/leaderboard" className={pillClass(!activeGenre && !otherBoard)}>Top Traders</Link>
          <Link href="/next/leaderboard?board=talent" className={pillClass(activeTalent)}>Talent Scouts</Link>
          <Link href="/next/leaderboard?board=discoverers" className={pillClass(activeDiscoverers)}>Top Discoverers</Link>
          <Link href="/next/leaderboard?board=challenges" className={pillClass(activeChallenges)}>Challenges</Link>
          {genres.map((g) => (
            <Link key={g} href={`/next/leaderboard?genre=${encodeURIComponent(g)}`} className={pillClass(activeGenre === g)}>
              {g} Scouts
            </Link>
          ))}
        </div>
        {!activeGenre && !otherBoard && (
          <div className="flex items-center gap-2.5 flex-wrap">
            {WINDOWS.map((w) => (
              <Link key={w} href={w === 'all' ? '/next/leaderboard' : `/next/leaderboard?window=${w}`} className={pillClass(activeWindow === w)}>
                {WINDOW_LABELS[w]}
              </Link>
            ))}
          </div>
        )}
      </div>

      {topScouts && (
        <div className="flex flex-col gap-2.5">
          {topScouts.length === 0 && <p className="text-center py-10 m-0" style={{ color: 'var(--text-muted)' }}>No Scouts yet — back an artist to claim the top spot.</p>}
          {topScouts.map((entry) => {
            const up = entry.totalReturnPct >= 0;
            return (
              <Link key={entry.user.id} href={`/next/profile/${entry.user.id}`} className="next-card next-card-hover flex items-center gap-3 px-5 py-4">
                <span className="num w-8 text-center text-sm font-semibold shrink-0" style={{ color: 'var(--text-faint)' }}>#{entry.rank}</span>
                <RankChange change={entry.rankChange} />
                <ArtistAvatar name={entry.user.name} photoUrl={entry.user.avatar_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="font-display font-semibold truncate">{entry.user.name}</div>
                  <div className="text-xs truncate" style={{ color: 'var(--text-faint)' }}>
                    {entry.artistsBackedCount} {entry.artistsBackedCount === 1 ? 'artist' : 'artists'} backed · {entry.earlyDiscoveriesCount} early {entry.earlyDiscoveriesCount === 1 ? 'call' : 'calls'}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="num font-semibold" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
                    {up ? '+' : ''}{entry.totalReturnPct}%
                  </div>
                  <div className="num text-xs" style={{ color: 'var(--text-faint)' }}>{formatCents(entry.portfolioValueCents)}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {genreBoard && (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs m-0" style={{ color: 'var(--text-faint)' }}>Ranked by total profit &amp; loss earned specifically from {activeGenre} artists.</p>
          {genreBoard.length === 0 && (
            <p className="text-center py-10 m-0" style={{ color: 'var(--text-muted)' }}>No {activeGenre} Scouts yet — be the first to back one.</p>
          )}
          {genreBoard.map((entry) => {
            const up = entry.pnlCents >= 0;
            return (
              <Link key={entry.user.id} href={`/next/profile/${entry.user.id}`} className="next-card next-card-hover flex items-center gap-4 px-5 py-4">
                <span className="num w-9 text-center text-sm font-semibold shrink-0" style={{ color: 'var(--text-faint)' }}>#{entry.rank}</span>
                <ArtistAvatar name={entry.user.name} photoUrl={entry.user.avatar_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="font-display font-semibold truncate">{entry.user.name}</div>
                  <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{entry.artistsBackedCount} {activeGenre} artists backed</div>
                </div>
                <div className="num font-semibold shrink-0" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
                  {up ? '+' : ''}{formatCents(entry.pnlCents)}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {talentBoard && (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs m-0 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            Ranked by discovery reputation: each early pick earns credit for the players who backed that artist <em>after</em> you
            (counting only players who&apos;ve backed at least {QUALIFYING_MIN_BACKINGS} artists), with more for earlier positions.
            Backing an artist who&apos;s already popular earns little. Needs {REPUTATION_MIN_PICKS}+ picks.{' '}
            <Link href="/next/how-it-works#ranks" className="underline underline-offset-2">How it works</Link>
          </p>
          {talentBoard.length === 0 && (
            <p className="text-center py-10 m-0" style={{ color: 'var(--text-muted)' }}>
              Nobody has a discovery reputation yet — it builds once other players back the artists you found first.
            </p>
          )}
          {talentBoard.map((entry) => (
            <Link key={entry.userId} href={`/next/profile/${entry.userId}`} className="next-card next-card-hover flex items-center gap-4 px-5 py-4">
              <span className="num w-9 text-center text-sm font-semibold shrink-0" style={{ color: 'var(--text-faint)' }}>#{entry.rank}</span>
              <ArtistAvatar name={entry.name} photoUrl={entry.avatar_url} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="font-display font-semibold truncate">{entry.name}</div>
                <div className="text-xs truncate" style={{ color: 'var(--text-faint)' }}>
                  {entry.creditedPicks} of {entry.picks} picks followed · {entry.followers} {entry.followers === 1 ? 'player' : 'players'} backed after them
                </div>
              </div>
              <div className="num font-semibold shrink-0" style={{ color: 'var(--ember)' }}>{entry.reputation.toFixed(1)}</div>
            </Link>
          ))}
        </div>
      )}

      {challengeBoard && (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs m-0" style={{ color: 'var(--text-faint)' }}>
            Ranked by current streak (weeks in a row with {STREAK_MIN}+ weekly challenges done), then challenges done this week.{' '}
            <Link href="/next/challenges" className="underline underline-offset-2">This week&apos;s challenges</Link>
          </p>
          {challengeBoard.length === 0 && (
            <p className="text-center py-10 m-0" style={{ color: 'var(--text-muted)' }}>No challenges completed yet this week.</p>
          )}
          {challengeBoard.map((entry) => (
            <Link key={entry.userId} href={`/next/profile/${entry.userId}`} className="next-card next-card-hover flex items-center gap-4 px-5 py-4">
              <span className="num w-9 text-center text-sm font-semibold shrink-0" style={{ color: 'var(--text-faint)' }}>#{entry.rank}</span>
              <ArtistAvatar name={entry.name} photoUrl={entry.avatar_url} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="font-display font-semibold truncate">{entry.name}</div>
                <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{entry.completedThisWeek} of 5 done this week</div>
              </div>
              <div className="num font-semibold shrink-0" style={{ color: entry.streakWeeks > 0 ? 'var(--ember)' : 'var(--text-faint)' }}>
                {entry.streakWeeks}-week streak
              </div>
            </Link>
          ))}
        </div>
      )}

      {discoveryBoard && (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs m-0" style={{ color: 'var(--text-faint)' }}>
            Ranked by artists found and approved via Submit an Artist — before they were ever on the roster.
          </p>
          {discoveryBoard.length === 0 && (
            <p className="text-center py-10 m-0" style={{ color: 'var(--text-muted)' }}>
              No approved discoveries yet — <Link href="/next/submit-artist" className="underline">submit one</Link> to claim the top spot.
            </p>
          )}
          {discoveryBoard.map((entry) => (
            <Link key={entry.user.id} href={`/next/profile/${entry.user.id}`} className="next-card next-card-hover flex items-center gap-4 px-5 py-4">
              <span className="num w-9 text-center text-sm font-semibold shrink-0" style={{ color: 'var(--text-faint)' }}>#{entry.rank}</span>
              <ArtistAvatar name={entry.user.name} photoUrl={entry.user.avatar_url} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="font-display font-semibold truncate">{entry.user.name}</div>
                <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {entry.approvedDiscoveriesCount} artist{entry.approvedDiscoveriesCount === 1 ? '' : 's'} found
                  {entry.breakoutDiscoveriesCount > 0 && ` · ${entry.breakoutDiscoveriesCount} breakout${entry.breakoutDiscoveriesCount === 1 ? '' : 's'}`}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
