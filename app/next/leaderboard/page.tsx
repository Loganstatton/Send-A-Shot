import Link from 'next/link';
import type { Metadata } from 'next';
import { getAvailableGenres, getGenreLeaderboard, getScoutLeaderboard } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import ArtistAvatar from '@/components/ArtistAvatar';

export const metadata: Metadata = { title: 'Leaderboard' };
export const dynamic = 'force-dynamic';

export default async function LeaderboardPage({ searchParams }: { searchParams: { genre?: string } }) {
  await requireUser();
  const genres = getAvailableGenres();
  const activeGenre = searchParams.genre && genres.includes(searchParams.genre) ? searchParams.genre : null;

  const topScouts = activeGenre ? null : getScoutLeaderboard();
  const genreBoard = activeGenre ? getGenreLeaderboard(activeGenre) : null;

  const pillClass = (active: boolean) => `next-pill ${active ? 'next-pill-active' : ''}`;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">Leaderboard</h1>
        <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>Ranked by paper-trading performance. No real money changes hands.</p>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap">
        <Link href="/next/leaderboard" className={pillClass(!activeGenre)}>Top Scouts</Link>
        {genres.map((g) => (
          <Link key={g} href={`/next/leaderboard?genre=${encodeURIComponent(g)}`} className={pillClass(activeGenre === g)}>
            {g} Scouts
          </Link>
        ))}
      </div>

      {topScouts && (
        <div className="flex flex-col gap-2.5">
          {topScouts.length === 0 && <p className="text-center py-10 m-0" style={{ color: 'var(--text-muted)' }}>No Scouts yet.</p>}
          {topScouts.map((entry) => {
            const up = entry.totalReturnPct >= 0;
            return (
              <Link key={entry.user.id} href={`/next/profile/${entry.user.id}`} className="next-card next-card-hover flex items-center gap-4 px-5 py-4">
                <span className="num w-9 text-center text-sm font-semibold shrink-0" style={{ color: 'var(--text-faint)' }}>#{entry.rank}</span>
                <ArtistAvatar name={entry.user.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="font-display font-semibold truncate">{entry.user.name}</div>
                  <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{entry.artistsBackedCount} artists backed</div>
                </div>
                <div className="num font-semibold shrink-0" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
                  {up ? '+' : ''}{entry.totalReturnPct}%
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
                <ArtistAvatar name={entry.user.name} size="sm" />
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
