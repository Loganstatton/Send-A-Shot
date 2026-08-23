import type { Metadata } from 'next';
import { requireInternal } from '@/lib/auth';
import {
  getAvgArtistsViewedBeforeFirstTrade, getAvgTradesPerUser, getAvgWatchlistAddsPerUser, getGenreRetention,
  getMostEffectiveFilters, getPctTradesPrecededByListen, getRetention, getSessionAverages,
  getSignupConversionFunnel, getTimeToFirstTrade, getTopEngagementArtists,
} from '@/lib/analytics';
import StatTile from '@/components/StatTile';

export const metadata: Metadata = { title: { absolute: 'MVP Metrics — Scout' } };
export const dynamic = 'force-dynamic';

function pct(n: number, of: number): string {
  return of > 0 ? `${Math.round((n / of) * 1000) / 10}%` : '—';
}

function pctOrPending(value: number | null, eligibleUsers: number): string {
  if (eligibleUsers === 0) return 'Not enough time has passed yet';
  return value != null ? `${value}%` : '0%';
}

export default async function MetricsPage() {
  await requireInternal();

  const funnel = getSignupConversionFunnel();
  const timeToFirstTrade = getTimeToFirstTrade();
  const artistsViewedBeforeTrade = getAvgArtistsViewedBeforeFirstTrade();
  const pctPrecededByListen = getPctTradesPrecededByListen();
  const sessions = getSessionAverages();
  const avgTradesPerUser = getAvgTradesPerUser();
  const avgWatchlistAddsPerUser = getAvgWatchlistAddsPerUser();
  const day1 = getRetention(1);
  const day7 = getRetention(7);
  const day30 = getRetention(30);
  const filters = getMostEffectiveFilters();
  const topArtists = getTopEngagementArtists();
  const genreRetention = getGenreRetention();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">MVP Metrics</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Every number below is computed live from analytics_events, preview_listens, and next_transactions — nothing here is a rollup that can go stale.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">Signup funnel</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Total signups" value={String(funnel.totalUsers)} />
          <StatTile label="→ Viewed an artist" value={pct(funnel.viewedArtist, funnel.totalUsers)} delta={`${funnel.viewedArtist} users`} />
          <StatTile label="→ Listened to a preview" value={pct(funnel.listened, funnel.totalUsers)} delta={`${funnel.listened} users`} />
          <StatTile label="→ Made a trade" value={pct(funnel.traded, funnel.totalUsers)} delta={`${funnel.traded} users`} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Path to first trade</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile
            label="Time to first trade (avg)"
            value={timeToFirstTrade ? `${timeToFirstTrade.avgHours}h` : '—'}
            delta={timeToFirstTrade ? `median ${timeToFirstTrade.medianHours}h · ${timeToFirstTrade.tradedUserCount} traders` : 'No trades yet'}
          />
          <StatTile
            label="Artists viewed before first trade"
            value={artistsViewedBeforeTrade != null ? artistsViewedBeforeTrade.toFixed(1) : '—'}
          />
          <StatTile
            label="Trades preceded by a listen"
            value={pctPrecededByListen != null ? `${pctPrecededByListen}%` : '—'}
          />
          <StatTile label="Avg trades / user" value={avgTradesPerUser.toFixed(2)} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Engagement per session</h2>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          A "session" is a gap-based grouping (30 minutes of inactivity starts a new one) — there's no explicit session-start event, so each metric is sessionized over its own event stream.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile
            label="Artists viewed / session"
            value={sessions.avgArtistsViewedPerSession != null ? sessions.avgArtistsViewedPerSession.toFixed(1) : '—'}
            delta={`${sessions.artistViewSessionCount} sessions`}
          />
          <StatTile
            label="Listens / session"
            value={sessions.avgListensPerSession != null ? sessions.avgListensPerSession.toFixed(1) : '—'}
            delta={`${sessions.listenSessionCount} sessions`}
          />
          <StatTile label="Watchlist adds / user" value={avgWatchlistAddsPerUser.toFixed(2)} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Retention</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatTile label="Day 1" value={pctOrPending(day1.pct, day1.eligibleUsers)} delta={day1.eligibleUsers > 0 ? `${day1.retainedUsers}/${day1.eligibleUsers} eligible` : undefined} />
          <StatTile label="Day 7" value={pctOrPending(day7.pct, day7.eligibleUsers)} delta={day7.eligibleUsers > 0 ? `${day7.retainedUsers}/${day7.eligibleUsers} eligible` : undefined} />
          <StatTile label="Day 30" value={pctOrPending(day30.pct, day30.eligibleUsers)} delta={day30.eligibleUsers > 0 ? `${day30.retainedUsers}/${day30.eligibleUsers} eligible` : undefined} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Most effective discovery filters</h2>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          "Effective" = led the same user to open an artist or complete a buy within 15 minutes. Filters used fewer than twice aren't ranked — too small a sample.
        </p>
        {filters.length === 0 ? (
          <div className="card text-center py-8" style={{ color: 'var(--text-muted)' }}>Not enough filter usage yet.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]" style={{ borderCollapse: 'collapse' }}>
              <thead className="text-left">
                <tr>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Filter</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Uses</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Led to action</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Effectiveness</th>
                </tr>
              </thead>
              <tbody>
                {filters.map((f) => (
                  <tr key={f.filter} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="py-2 pr-3 capitalize">{f.filter.replace(/_/g, ' ')}</td>
                    <td className="num py-2 text-right">{f.uses}</td>
                    <td className="num py-2 text-right">{f.conversions}</td>
                    <td className="num py-2 text-right font-semibold">{f.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Artists generating the most engagement</h2>
        {topArtists.length === 0 ? (
          <div className="card text-center py-8" style={{ color: 'var(--text-muted)' }}>No engagement data yet.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]" style={{ borderCollapse: 'collapse' }}>
              <thead className="text-left">
                <tr>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Artist</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Views</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Listens</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Watchlist adds</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Trades</th>
                </tr>
              </thead>
              <tbody>
                {topArtists.map((a) => (
                  <tr key={a.artistId} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="py-2 pr-3 font-medium">{a.artistName}</td>
                    <td className="num py-2 text-right">{a.views}</td>
                    <td className="num py-2 text-right">{a.listens}</td>
                    <td className="num py-2 text-right">{a.watchlistAdds}</td>
                    <td className="num py-2 text-right">{a.trades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Genre retention differences</h2>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          A Scout's genre is whichever genre their first trade's artist belongs to. Day-7 retention, compared across genres.
        </p>
        {genreRetention.length === 0 ? (
          <div className="card text-center py-8" style={{ color: 'var(--text-muted)' }}>No trades yet.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[360px]" style={{ borderCollapse: 'collapse' }}>
              <thead className="text-left">
                <tr>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Genre</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Scouts</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Day-7 retention</th>
                </tr>
              </thead>
              <tbody>
                {genreRetention.map((g) => (
                  <tr key={g.genre} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="py-2 pr-3">{g.genre}</td>
                    <td className="num py-2 text-right">{g.userCount}</td>
                    <td className="num py-2 text-right">{g.day7RetentionPct != null ? `${g.day7RetentionPct}%` : 'Pending'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
