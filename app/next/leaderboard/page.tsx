import Link from 'next/link';
import type { Metadata } from 'next';
import { getAvailableGenres, getGenreLeaderboard, getScoutLeaderboard } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import { LeaderboardWindow } from '@/lib/types';
import ArtistAvatar from '@/components/ArtistAvatar';

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

export default async function LeaderboardPage({ searchParams }: { searchParams: { genre?: string; window?: string } }) {
  await requireUser();
  const genres = getAvailableGenres();
  const activeGenre = searchParams.genre && genres.includes(searchParams.genre) ? searchParams.genre : null;
  const activeWindow: LeaderboardWindow = WINDOWS.includes(searchParams.window as LeaderboardWindow) ? (searchParams.window as LeaderboardWindow) : 'all';

  // Anti-gaming baseline: a Scout with zero activity doesn't appear on the
  // competitive board at all, so an untouched account can't sit tied at the
  // top by default before anything is ever staked on rank. Same rule the
  // genre board already applies (see getGenreLeaderboard) — deeper abuse
  // detection (wash trading, coordinated accounts) is Phase 8 scope, for
  // once real prizes/rewards are on the table.
  const topScouts = activeGenre ? null : getScoutLeaderboard(activeWindow).filter((e) => e.artistsBackedCount > 0);
  const genreBoard = activeGenre ? getGenreLeaderboard(activeGenre) : null;

  const pillClass = (active: boolean) => `next-pill ${active ? 'next-pill-active' : ''}`;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">Leaderboard</h1>
        <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>Ranked by paper-trading performance. No real money changes hands.</p>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Link href="/next/leaderboard" className={pillClass(!activeGenre)}>Top Scouts</Link>
          {genres.map((g) => (
            <Link key={g} href={`/next/leaderboard?genre=${encodeURIComponent(g)}`} className={pillClass(activeGenre === g)}>
              {g} Scouts
            </Link>
          ))}
        </div>
        {!activeGenre && (
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
                    {entry.artistsBackedCount} artists backed (Founding Believer) · {entry.earlyDiscoveriesCount} early calls
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
    </div>
  );
}
