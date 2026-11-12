import type { Metadata } from 'next';
import { requireInternal } from '@/lib/auth';
import {
  getAvgArtistsViewedBeforeFirstTrade, getAvgTradesPerUser, getAvgWatchlistAddsPerUser, getGenreRetention,
  getMostEffectiveFilters, getPctTradesPrecededByListen, getRetention, getSessionAverages,
  getActivityPulse, getGrowthLoops, getSignupConversionFunnel, getTimeToFirstTrade, getTopEngagementArtists,
} from '@/lib/analytics';
import StatTile from '@/components/StatTile';
import { getFeedbackSummary } from '@/lib/feedback';
import Link from 'next/link';

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

  const funnel = await getSignupConversionFunnel();
  const timeToFirstTrade = await getTimeToFirstTrade();
  const artistsViewedBeforeTrade = await getAvgArtistsViewedBeforeFirstTrade();
  const pctPrecededByListen = await getPctTradesPrecededByListen();
  const sessions = await getSessionAverages();
  const avgTradesPerUser = await getAvgTradesPerUser();
  const avgWatchlistAddsPerUser = await getAvgWatchlistAddsPerUser();
  const day1 = await getRetention(1);
  const day7 = await getRetention(7);
  const day30 = await getRetention(30);
  const filters = await getMostEffectiveFilters();
  const topArtists = await getTopEngagementArtists();
  const genreRetention = await getGenreRetention();
  const loops = await getGrowthLoops();
  const pulse = await getActivityPulse();
  const feedback = await getFeedbackSummary();

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
        <h2 className="font-semibold">Activity pulse</h2>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          Active = signed-in players who viewed a page, played a preview or traded in the window. Beta targets from the plan
          (pilot goals, not benchmarks): of 100 users, 50 back an artist and 20 return the following week.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Active today" value={String(pulse.dau)} />
          <StatTile label="Active this week" value={String(pulse.wau)} delta={`${pulse.mau} in 30 days`} />
          <StatTile
            label="Came back the next week"
            value={pulse.returnedNextWeek.eligible > 0 ? pct(pulse.returnedNextWeek.returned, pulse.returnedNextWeek.eligible) : 'Not enough time has passed yet'}
            delta={`${pulse.returnedNextWeek.returned} of ${pulse.returnedNextWeek.eligible} who joined 7–14 days ago`}
          />
          <StatTile label="Did a weekly challenge" value={String(pulse.challengeParticipants)} delta="players, this week" />
          <StatTile label="Artists viewed this week" value={`${pulse.activeArtists7d} / ${pulse.artistsOnNext}`} delta="artists on NEXT with a page view" />
          <StatTile label="Artist claims" value={`${pulse.claims.approved} approved`} delta={`${pulse.claims.requested} requested`} />
          <StatTile
            label="Understood the scoring"
            value={feedback.total > 0 ? pct(feedback.yes, feedback.yes + feedback.partly + feedback.no) : '—'}
            delta={`${feedback.yes} yes · ${feedback.partly} partly · ${feedback.no} no`}
          />
        </div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>Where signups came from (30 days)</h3>
        {pulse.signupsBySource.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No signups in the last 30 days.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {pulse.signupsBySource.map((s) => (
              <li key={s.via}><span className="num font-semibold">{s.count}</span> — {s.via.replace(/_/g, ' ')}</li>
            ))}
          </ul>
        )}
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          Source = the page a new player was sent back to after signing up (e.g. a league invite or a proof link). &ldquo;unknown&rdquo; =
          signups from before this was recorded. <Link href="/admin/feedback" className="underline">Read beta feedback</Link>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Growth loops</h2>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          How NEXT spreads. Signed-out figures are page views, not people — a visitor without an account can&apos;t be counted
          individually. Shares count taps of a Share/Copy button, so a share sheet the person then cancelled isn&apos;t included.
        </p>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>Visitor → player</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Signed-out Discover views" value={String(loops.guestDiscoverViews)} delta={`${loops.guestArtistViews} signed-out artist page views`} />
          <StatTile label="Accounts" value={String(loops.signups)} />
          <StatTile label="→ Finished onboarding" value={pct(loops.onboardingCompleted, loops.signups)} delta={`${loops.onboardingCompleted} users · ${loops.pickedGenres} picked genres`} />
          <StatTile label="→ Backed an artist" value={pct(loops.backedAnArtist, loops.signups)} delta={`${loops.backedAnArtist} users`} />
        </div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>Early-proof links</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Proof links shared" value={String(loops.proofLinksShared)} />
          <StatTile label="Proof page views (signed out)" value={String(loops.proofViewsSignedOut)} />
          <StatTile label="Proof page views (signed in)" value={String(loops.proofViewsSignedIn)} />
        </div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>Private leagues</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Leagues" value={String(loops.leaguesActive)} delta={loops.leaguesActive > 0 ? `${(loops.leagueMembers / loops.leaguesActive).toFixed(1)} members on average` : undefined} />
          <StatTile label="Invites shared" value={String(loops.leagueInvitesShared)} />
          <StatTile label="Invite page views" value={String(loops.inviteViewsSignedOut + loops.inviteViewsSignedIn)} delta={`${loops.inviteViewsSignedOut} signed out`} />
          <StatTile label="Joins via invite" value={String(loops.leagueJoins)} />
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
