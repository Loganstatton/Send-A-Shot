// The Notification center's composition layer: every notification is
// computed fresh, on every call, from data this app already tracks
// (score_history, next_price_history, next_founding_believers, portfolio
// value, leaderboard rank) — there is no persisted "notifications" table
// and no cron job writing rows into one. That means a server restart or a
// skipped scheduled run can never leave a stale or duplicated notification
// behind; the only thing actually persisted is which notification keys the
// user has already seen (lib/db.ts's notification_reads table).
//
// The tradeoff: a few of these are inherently state-based rather than
// event-based (Undervalued/Overheated, for instance) because there's no
// snapshot log of "was it different a moment ago" to compare against.
// Those use a key that changes only when the underlying state changes
// (e.g. the tone itself, or the day), so re-viewing the same true state
// doesn't re-surface it as new, but a genuine change does.

import { Artist, FavoriteGenre, FoundingBelieverRecord, User, WatchlistEntry } from './types';
import {
  getFavoriteGenres, getFoundingBelieverCountForArtist, getFoundingBelieverRecordsForUser, getNewArtistsThisWeek,
  getNextMarket, getPortfolioValue, getRankMovements, getReadNotificationKeys, getScoreHistory, getUserWatchlist,
  setNotificationsEmailedThrough, valueAtOrBefore,
} from './db';
import { ALERT_PRICE_PCT_THRESHOLD, ALERT_SCORE_THRESHOLD, changePctForWindow, marketSentiment } from './next-market';
import { emailConfigured, sendEmail } from './email';

export type NotificationKind =
  | 'watchlist_score' | 'watchlist_price' | 'watchlist_growth' | 'watchlist_sentiment' | 'watchlist_trending'
  | 'new_artist_genre' | 'founding_believer_milestone' | 'portfolio_milestone' | 'leaderboard_rank';

export type NotificationCategory = 'watchlist_moves' | 'new_artists' | 'founding_believer' | 'portfolio_milestones' | 'leaderboard_rank';

const CATEGORY_BY_KIND: Record<NotificationKind, NotificationCategory> = {
  watchlist_score: 'watchlist_moves',
  watchlist_price: 'watchlist_moves',
  watchlist_growth: 'watchlist_moves',
  watchlist_sentiment: 'watchlist_moves',
  watchlist_trending: 'watchlist_moves',
  new_artist_genre: 'new_artists',
  founding_believer_milestone: 'founding_believer',
  portfolio_milestone: 'portfolio_milestones',
  leaderboard_rank: 'leaderboard_rank',
};

export type Notification = {
  key: string;
  kind: NotificationKind;
  category: NotificationCategory;
  message: string;
  artistId?: number;
  occurredAt: string;
  read: boolean;
};

const TRENDING_TOP_N = 5;
const TRENDING_WINDOW_HOURS = 24;
// Descending so the loop below finds the HIGHEST tier reached first — an
// artist that's grown to 100 backers should report "crossed 100," not stop
// at the first (lowest) tier it also technically passed on the way there.
const FOUNDING_BELIEVER_MILESTONES = [1000, 500, 250, 100, 50, 25, 10];
// Ordered so the loop always finds the deepest tier reached first: biggest
// gain checked first on the way up, biggest loss checked first on the way
// down — a -30% return should report the -25% tier, not stop at -10%.
const PORTFOLIO_MILESTONE_TIERS = [100, 50, 25, 10, -50, -25, -10];

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function watchlistNotifications(watchlist: WatchlistEntry[], trendingIds: Set<number>): Notification[] {
  const notifications: Notification[] = [];
  for (const entry of watchlist) {
    if (!entry.alertsEnabled) continue;
    const { artist, score, priceCents } = entry;

    const scoreHistory = getScoreHistory(artist.id);
    const latestSnapshot = scoreHistory[scoreHistory.length - 1];
    if (latestSnapshot && entry.scoreAtWatch != null) {
      const scoreDelta = Math.round((score - entry.scoreAtWatch) * 10) / 10;
      if (Math.abs(scoreDelta) >= ALERT_SCORE_THRESHOLD) {
        notifications.push({
          key: `watchlist_score:${artist.id}:${latestSnapshot.id}`,
          kind: 'watchlist_score',
          category: 'watchlist_moves',
          message: `${artist.name}'s NEXT Score ${scoreDelta >= 0 ? 'jumped' : 'dropped'} ${scoreDelta >= 0 ? '+' : ''}${scoreDelta.toFixed(1)} since you added it.`,
          artistId: artist.id,
          occurredAt: latestSnapshot.recorded_at,
          read: false,
        });
      }

      const priorGrowthPct = valueAtOrBefore(scoreHistory, entry.watchedAt, (s) => s.recorded_at)?.growth_velocity_pct;
      const currentGrowthPct = latestSnapshot.growth_velocity_pct;
      if (priorGrowthPct != null && currentGrowthPct != null) {
        const growthDelta = Math.round((currentGrowthPct - priorGrowthPct) * 10) / 10;
        if (growthDelta >= ALERT_SCORE_THRESHOLD) {
          notifications.push({
            key: `watchlist_growth:${artist.id}:${latestSnapshot.id}`,
            kind: 'watchlist_growth',
            category: 'watchlist_moves',
            message: `${artist.name} is showing a real growth spike — 30D growth is up ${growthDelta >= 0 ? '+' : ''}${growthDelta.toFixed(1)}pts since you added it.`,
            artistId: artist.id,
            occurredAt: latestSnapshot.recorded_at,
            read: false,
          });
        }
      }
    }

    if (entry.priceAtWatchCents != null && entry.priceAtWatchCents !== 0) {
      const priceDeltaPct = Math.round(((priceCents - entry.priceAtWatchCents) / entry.priceAtWatchCents) * 1000) / 10;
      if (Math.abs(priceDeltaPct) >= ALERT_PRICE_PCT_THRESHOLD) {
        const latestPricePoint = entry.priceHistory[entry.priceHistory.length - 1];
        notifications.push({
          key: `watchlist_price:${artist.id}:${latestPricePoint?.recorded_at ?? entry.watchedAt}`,
          kind: 'watchlist_price',
          category: 'watchlist_moves',
          message: `${artist.name}'s NEXT Price ${priceDeltaPct >= 0 ? 'is up' : 'is down'} ${priceDeltaPct >= 0 ? '+' : ''}${priceDeltaPct.toFixed(1)}% since you added it.`,
          artistId: artist.id,
          occurredAt: latestPricePoint?.recorded_at ?? entry.watchedAt,
          read: false,
        });
      }
    }

    const sentiment = marketSentiment(score, priceCents);
    if (sentiment.tone !== 'fair') {
      notifications.push({
        key: `watchlist_sentiment:${artist.id}:${sentiment.tone}`,
        kind: 'watchlist_sentiment',
        category: 'watchlist_moves',
        message: sentiment.tone === 'undervalued'
          ? `${artist.name} looks undervalued right now — Score is running ahead of Price.`
          : `${artist.name} looks overheated right now — Price is running ahead of Score.`,
        artistId: artist.id,
        occurredAt: new Date().toISOString(),
        read: false,
      });
    }

    if (trendingIds.has(artist.id)) {
      notifications.push({
        key: `watchlist_trending:${artist.id}:${todayKey()}`,
        kind: 'watchlist_trending',
        category: 'watchlist_moves',
        message: `${artist.name} is one of today's biggest movers on NEXT.`,
        artistId: artist.id,
        occurredAt: new Date().toISOString(),
        read: false,
      });
    }
  }
  return notifications;
}

function newArtistNotifications(favoriteGenres: FavoriteGenre[], newArtists: Artist[]): Notification[] {
  const genres = new Set(favoriteGenres.map((g) => g.genre));
  if (genres.size === 0) return [];
  return newArtists
    .filter((a) => a.genre && genres.has(a.genre))
    .map((a) => ({
      key: `new_artist_genre:${a.id}`,
      kind: 'new_artist_genre' as const,
      category: 'new_artists' as const,
      message: `A new ${a.genre} artist joined NEXT this week: ${a.name}.`,
      artistId: a.id,
      occurredAt: a.created_at,
      read: false,
    }));
}

function foundingBelieverNotifications(records: (FoundingBelieverRecord & { artist_name: string })[]): Notification[] {
  const notifications: Notification[] = [];
  for (const record of records) {
    const currentCount = getFoundingBelieverCountForArtist(record.artist_id);
    for (const tier of FOUNDING_BELIEVER_MILESTONES) {
      // Only tiers reached AFTER this user backed the artist — otherwise a
      // late Founding Believer would get credited with milestones the
      // artist had already passed before they ever showed up.
      if (tier > record.discovery_rank && tier <= currentCount) {
        notifications.push({
          key: `founding_believer_milestone:${record.artist_id}:${tier}`,
          kind: 'founding_believer_milestone',
          category: 'founding_believer',
          message: `${record.artist_name} just crossed ${tier} backers — you were Founding Believer #${record.discovery_rank}.`,
          artistId: record.artist_id,
          occurredAt: new Date().toISOString(),
          read: false,
        });
        break; // one notification per artist — the highest tier reached, not every tier on the way up
      }
    }
  }
  return notifications;
}

function portfolioMilestoneNotifications(totalReturnPct: number): Notification[] {
  for (const tier of PORTFOLIO_MILESTONE_TIERS) {
    const reached = tier >= 0 ? totalReturnPct >= tier : totalReturnPct <= tier;
    if (reached) {
      return [{
        key: `portfolio_milestone:${tier}`,
        kind: 'portfolio_milestone',
        category: 'portfolio_milestones',
        message: `Your portfolio has ${tier >= 0 ? 'returned' : 'fallen'} ${tier >= 0 ? '+' : ''}${tier}% all-time.`,
        occurredAt: new Date().toISOString(),
        read: false,
      }];
    }
  }
  return [];
}

function leaderboardRankNotification(rankChange: number | null): Notification[] {
  if (!rankChange) return [];
  return [{
    key: `leaderboard_rank:${todayKey()}`,
    kind: 'leaderboard_rank',
    category: 'leaderboard_rank',
    message: `You've ${rankChange > 0 ? 'climbed' : 'dropped'} ${Math.abs(rankChange)} spot${Math.abs(rankChange) === 1 ? '' : 's'} on the Leaderboard this week.`,
    occurredAt: new Date().toISOString(),
    read: false,
  }];
}

export function getNotificationsForUser(user: User): Notification[] {
  const watchlist = user.notify_watchlist_moves ? getUserWatchlist(user.id) : [];

  let trendingIds = new Set<number>();
  if (watchlist.length > 0) {
    const market = getNextMarket();
    trendingIds = new Set(
      [...market]
        .map((row) => ({ id: row.artist.id, changePct: changePctForWindow(row.priceCents, row.priceHistory, TRENDING_WINDOW_HOURS) }))
        .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
        .slice(0, TRENDING_TOP_N)
        .map((m) => m.id)
    );
  }

  let all: Notification[] = [];
  if (user.notify_watchlist_moves) all = all.concat(watchlistNotifications(watchlist, trendingIds));
  if (user.notify_new_artists) {
    all = all.concat(newArtistNotifications(getFavoriteGenres(user.id), getNewArtistsThisWeek(7)));
  }
  if (user.notify_founding_believer) all = all.concat(foundingBelieverNotifications(getFoundingBelieverRecordsForUser(user.id)));
  if (user.notify_portfolio_milestones) all = all.concat(portfolioMilestoneNotifications(getPortfolioValue(user.id).totalReturnPct));
  if (user.notify_leaderboard_rank) all = all.concat(leaderboardRankNotification(getRankMovements()[user.id] ?? null));

  const readKeys = getReadNotificationKeys(user.id);
  all.forEach((n) => { n.read = readKeys.has(n.key); });
  all.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  return all;
}

// Sends a digest email of whatever's new since notifications_emailed_through
// (a cursor, not a per-item send log — see that column's comment in
// lib/db.ts). Called from the notification center page itself rather than
// a scheduled job: this app has no background job runner (see the alert
// flag on Watchlist and the rank-movement math on Leaderboard for the same
// constraint handled the same way — compute on demand instead of relying
// on a cron), so "next time the user actually looks" is the trigger. A
// no-op whenever email isn't configured, same as every other email this
// app sends — nothing here requires it to arrive.
export async function maybeSendNotificationDigestEmail(user: User, notifications: Notification[]): Promise<void> {
  if (!user.email_notifications_enabled || !emailConfigured()) return;

  const cursor = user.notifications_emailed_through ?? '1970-01-01T00:00:00.000Z';
  const unsent = notifications.filter((n) => n.occurredAt > cursor);
  if (unsent.length === 0) return;

  const html = `
    <p>Here's what's new on NEXT:</p>
    <ul>${unsent.map((n) => `<li>${n.message}</li>`).join('')}</ul>
    <p style="color:#888;font-size:12px;">You're getting this because email notifications are on in your NEXT settings.</p>
  `;
  const result = await sendEmail({ to: user.email, subject: `${unsent.length} new update${unsent.length === 1 ? '' : 's'} on NEXT`, html });
  if (result.ok) setNotificationsEmailedThrough(user.id, new Date().toISOString());
}
