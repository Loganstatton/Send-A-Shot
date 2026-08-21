import Link from 'next/link';
import type { Metadata } from 'next';
import { getAvailableGenres, getGenreLeaderboard, getScoutLeaderboard } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import ArtistAvatar from '@/components/ArtistAvatar';

export const metadata: Metadata = { title: 'Leaderboard' };
export const dynamic = 'force-dynamic';

const RANK_MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default async function LeaderboardPage({ searchParams }: { searchParams: { genre?: string } }) {
  await requireUser();
  const genres = getAvailableGenres();
  const activeGenre = searchParams.genre && genres.includes(searchParams.genre) ? searchParams.genre : null;

  const topScouts = activeGenre ? null : getScoutLeaderboard();
  const genreBoard = activeGenre ? getGenreLeaderboard(activeGenre) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Leaderboard</h1>
        <p className="text-neutral-400 text-sm">Ranked by paper-trading performance. No real money changes hands.</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/next/leaderboard" className={`btn text-sm ${!activeGenre ? 'bg-white/20' : ''}`}>Top Scouts</Link>
        {genres.map((g) => (
          <Link
            key={g}
            href={`/next/leaderboard?genre=${encodeURIComponent(g)}`}
            className={`btn text-sm ${activeGenre === g ? 'bg-white/20' : ''}`}
          >
            {g} Scouts
          </Link>
        ))}
      </div>

      {topScouts && (
        <div className="space-y-2">
          {topScouts.length === 0 && <p className="text-neutral-400 text-center py-8">No Scouts yet.</p>}
          {topScouts.map((entry) => (
            <Link
              key={entry.user.id}
              href={`/next/profile/${entry.user.id}`}
              className="card flex items-center gap-4 hover:border-neutral-600 transition-colors"
            >
              <span className="w-8 text-center text-neutral-500 font-mono text-sm shrink-0">
                {RANK_MEDAL[entry.rank] ?? `#${entry.rank}`}
              </span>
              <ArtistAvatar name={entry.user.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{entry.user.name}</div>
                <div className="text-xs text-neutral-500">{entry.artistsBackedCount} artists backed</div>
              </div>
              <div className={`font-semibold shrink-0 ${entry.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {entry.totalReturnPct >= 0 ? '+' : ''}{entry.totalReturnPct}%
              </div>
            </Link>
          ))}
        </div>
      )}

      {genreBoard && (
        <div className="space-y-2">
          <p className="text-xs text-neutral-500">Ranked by total profit &amp; loss earned specifically from {activeGenre} artists.</p>
          {genreBoard.length === 0 && <p className="text-neutral-400 text-center py-8">No {activeGenre} Scouts yet — be the first to back one.</p>}
          {genreBoard.map((entry) => (
            <Link
              key={entry.user.id}
              href={`/next/profile/${entry.user.id}`}
              className="card flex items-center gap-4 hover:border-neutral-600 transition-colors"
            >
              <span className="w-8 text-center text-neutral-500 font-mono text-sm shrink-0">
                {RANK_MEDAL[entry.rank] ?? `#${entry.rank}`}
              </span>
              <ArtistAvatar name={entry.user.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{entry.user.name}</div>
                <div className="text-xs text-neutral-500">{entry.artistsBackedCount} {activeGenre} artists backed</div>
              </div>
              <div className={`font-semibold shrink-0 ${entry.pnlCents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {entry.pnlCents >= 0 ? '+' : ''}{formatCents(entry.pnlCents)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
