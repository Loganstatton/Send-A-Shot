// The MVP metrics dashboard's computation layer — every number here is
// derived fresh from analytics_events, preview_listens, and
// next_transactions (see lib/db.ts for the raw reads), never from a
// separately-maintained rollup table. This app's scale makes "fetch the
// whole table, compute in JS" simpler and just as fast as SQL window
// functions would be, and far more readable for the gap-based session
// grouping several of these metrics need.

import { db, getAllEvents, getAllPreviewListenEvents, getAllTransactionsForAnalytics, getAllUsers, getArtist } from './db';
import { AnalyticsEvent } from './types';

function groupByUser<T extends { user_id: number | null }>(rows: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    if (row.user_id == null) continue;
    const list = map.get(row.user_id) ?? [];
    list.push(row);
    map.set(row.user_id, list);
  }
  return map;
}

// Gap-based sessionization: a new session starts after 30 minutes with no
// activity — the same default GA4 uses. Input must already be sorted
// ascending by created_at (every getAll* reader in lib/db.ts already is).
const SESSION_GAP_MS = 30 * 60 * 1000;
function sessionize<T extends { created_at: string }>(events: T[]): T[][] {
  const sessions: T[][] = [];
  let current: T[] = [];
  let lastTime = -Infinity;
  for (const e of events) {
    const t = new Date(e.created_at).getTime();
    if (current.length > 0 && t - lastTime > SESSION_GAP_MS) {
      sessions.push(current);
      current = [];
    }
    current.push(e);
    lastTime = t;
  }
  if (current.length > 0) sessions.push(current);
  return sessions;
}

function metadataArtistId(e: AnalyticsEvent): number | null {
  const id = (e.metadata as any)?.artistId;
  return typeof id === 'number' ? id : null;
}

export type ConversionFunnel = { totalUsers: number; viewedArtist: number; listened: number; traded: number };

export async function getSignupConversionFunnel(): Promise<ConversionFunnel> {
  const totalUsers = (await getAllUsers()).length;
  const viewedArtist = new Set((await getAllEvents()).filter((e) => e.event_type === 'artist_detail_opened').map((e) => e.user_id)).size;
  const listened = new Set((await getAllPreviewListenEvents()).filter((l) => l.event === 'started').map((l) => l.user_id)).size;
  const traded = new Set((await getAllTransactionsForAnalytics()).map((t) => t.user_id)).size;
  return { totalUsers, viewedArtist, listened, traded };
}

export type TimeToFirstTradeResult = { avgHours: number; medianHours: number; tradedUserCount: number };

async function firstTradeByUser(): Promise<Map<number, { artistId: number; createdAt: string }>> {
  const map = new Map<number, { artistId: number; createdAt: string }>();
  for (const t of await getAllTransactionsForAnalytics()) {
    if (!map.has(t.user_id)) map.set(t.user_id, { artistId: t.artist_id, createdAt: t.created_at });
  }
  return map;
}

export async function getTimeToFirstTrade(): Promise<TimeToFirstTradeResult | null> {
  const usersById = new Map((await getAllUsers()).map((u) => [u.id, u]));
  const hours: number[] = [];
  for (const [userId, first] of await firstTradeByUser()) {
    const user = usersById.get(userId);
    if (!user) continue;
    hours.push(Math.max(0, (new Date(first.createdAt).getTime() - new Date(user.created_at).getTime()) / (1000 * 60 * 60)));
  }
  if (hours.length === 0) return null;
  const sorted = [...hours].sort((a, b) => a - b);
  const median = sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return {
    avgHours: Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10,
    medianHours: Math.round(median * 10) / 10,
    tradedUserCount: hours.length,
  };
}

export async function getAvgArtistsViewedBeforeFirstTrade(): Promise<number | null> {
  const firstTrades = await firstTradeByUser();
  if (firstTrades.size === 0) return null;
  const viewsByUser = groupByUser((await getAllEvents()).filter((e) => e.event_type === 'artist_detail_opened'));

  const counts: number[] = [];
  for (const [userId, first] of firstTrades) {
    const views = viewsByUser.get(userId) ?? [];
    const distinct = new Set(
      views.filter((v) => v.created_at < first.createdAt).map(metadataArtistId).filter((id): id is number => id != null)
    );
    counts.push(distinct.size);
  }
  return Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10;
}

// Reads next_transactions.listened_before_buy directly — that column is
// already stamped on every buy by executeTrade (see lib/db.ts), so this
// needed no new tracking, just an aggregate over data that already existed.
export async function getPctTradesPrecededByListen(): Promise<number | null> {
  const buys = (await getAllTransactionsForAnalytics()).filter((t) => t.type === 'buy');
  if (buys.length === 0) return null;
  const preceded = buys.filter((t) => t.listened_before_buy === 1).length;
  return Math.round((preceded / buys.length) * 1000) / 10;
}

export type SessionAverages = {
  avgArtistsViewedPerSession: number | null;
  artistViewSessionCount: number;
  avgListensPerSession: number | null;
  listenSessionCount: number;
};

// Each average is computed over sessions of its OWN event stream (view
// sessions vs. listen sessions), not one shared "browsing session" concept
// — there's no session-start/end event to anchor a single definition to,
// and per-stream sessionizing is a defensible, simple approximation.
export async function getSessionAverages(): Promise<SessionAverages> {
  const viewsByUser = groupByUser((await getAllEvents()).filter((e) => e.event_type === 'artist_detail_opened'));
  let artistViewSessionCount = 0;
  let totalDistinctArtists = 0;
  for (const events of viewsByUser.values()) {
    for (const session of sessionize(events)) {
      artistViewSessionCount++;
      totalDistinctArtists += new Set(session.map(metadataArtistId).filter((id): id is number => id != null)).size;
    }
  }

  const listensByUser = groupByUser((await getAllPreviewListenEvents()).filter((l) => l.event === 'started'));
  let listenSessionCount = 0;
  let totalListens = 0;
  for (const events of listensByUser.values()) {
    for (const session of sessionize(events)) {
      listenSessionCount++;
      totalListens += session.length;
    }
  }

  return {
    avgArtistsViewedPerSession: artistViewSessionCount > 0 ? Math.round((totalDistinctArtists / artistViewSessionCount) * 10) / 10 : null,
    artistViewSessionCount,
    avgListensPerSession: listenSessionCount > 0 ? Math.round((totalListens / listenSessionCount) * 10) / 10 : null,
    listenSessionCount,
  };
}

export async function getAvgTradesPerUser(): Promise<number> {
  const totalUsers = (await getAllUsers()).length;
  if (totalUsers === 0) return 0;
  return Math.round(((await getAllTransactionsForAnalytics()).length / totalUsers) * 100) / 100;
}

export async function getAvgWatchlistAddsPerUser(): Promise<number> {
  const totalUsers = (await getAllUsers()).length;
  if (totalUsers === 0) return 0;
  const adds = (await getAllEvents()).filter((e) => e.event_type === 'watchlist_added').length;
  return Math.round((adds / totalUsers) * 100) / 100;
}

async function getAllActivityTimestampsByUser(): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  const add = (userId: number | null, createdAt: string) => {
    if (userId == null) return;
    const list = map.get(userId) ?? [];
    list.push(new Date(createdAt).getTime());
    map.set(userId, list);
  };
  for (const e of await getAllEvents()) add(e.user_id, e.created_at);
  for (const l of await getAllPreviewListenEvents()) add(l.user_id, l.created_at);
  for (const t of await getAllTransactionsForAnalytics()) add(t.user_id, t.created_at);
  return map;
}

export type RetentionResult = { eligibleUsers: number; retainedUsers: number; pct: number | null };

// "Retained on day N" = had any tracked activity in the 24h window that
// starts exactly N days after signup. A user only counts toward
// eligibleUsers once that window has fully elapsed — someone who signed up
// 3 days ago can't yet be scored for Day-7 retention either way, so they're
// excluded rather than counted as "not retained." pct is null (not 0%)
// when eligibleUsers is 0 — "no data yet," never a fake zero.
function computeRetention(userIds: number[], days: number, usersById: Map<number, { created_at: string }>, activityByUser: Map<number, number[]>): RetentionResult {
  const now = Date.now();
  const windowMs = days * 24 * 60 * 60 * 1000;
  let eligibleUsers = 0;
  let retainedUsers = 0;
  for (const userId of userIds) {
    const user = usersById.get(userId);
    if (!user) continue;
    const signupTime = new Date(user.created_at).getTime();
    const windowStart = signupTime + windowMs;
    const windowEnd = windowStart + 24 * 60 * 60 * 1000;
    if (now < windowEnd) continue;
    eligibleUsers++;
    const timestamps = activityByUser.get(userId) ?? [];
    if (timestamps.some((t) => t >= windowStart && t < windowEnd)) retainedUsers++;
  }
  return { eligibleUsers, retainedUsers, pct: eligibleUsers > 0 ? Math.round((retainedUsers / eligibleUsers) * 1000) / 10 : null };
}

export async function getRetention(days: number): Promise<RetentionResult> {
  const users = await getAllUsers();
  return computeRetention(users.map((u) => u.id), days, new Map(users.map((u) => [u.id, u])), await getAllActivityTimestampsByUser());
}

export type FilterEffectiveness = { filter: string; uses: number; conversions: number; pct: number };

const FILTER_CONVERSION_WINDOW_MS = 15 * 60 * 1000;

// "Effective" = led to a real next step (opening an artist, or completing
// a buy) within 15 minutes, by the same user. Filters used fewer than
// minUses times are dropped rather than ranked on a tiny, noisy sample.
export async function getMostEffectiveFilters(minUses = 2): Promise<FilterEffectiveness[]> {
  const events = await getAllEvents();
  const filterEvents = events.filter((e) => e.event_type === 'filter_used' || e.event_type === 'search_used');
  const actionsByUser = groupByUser(events.filter((e) => e.event_type === 'artist_detail_opened' || e.event_type === 'buy_completed'));

  const byFilter = new Map<string, { uses: number; conversions: number }>();
  for (const fe of filterEvents) {
    if (fe.user_id == null) continue;
    const label = fe.event_type === 'search_used' ? 'search' : String((fe.metadata as any)?.filter ?? 'unknown');
    const entry = byFilter.get(label) ?? { uses: 0, conversions: 0 };
    entry.uses++;
    const feTime = new Date(fe.created_at).getTime();
    const converted = (actionsByUser.get(fe.user_id) ?? []).some((a) => {
      const delta = new Date(a.created_at).getTime() - feTime;
      return delta > 0 && delta <= FILTER_CONVERSION_WINDOW_MS;
    });
    if (converted) entry.conversions++;
    byFilter.set(label, entry);
  }

  return [...byFilter.entries()]
    .filter(([, v]) => v.uses >= minUses)
    .map(([filter, v]) => ({ filter, uses: v.uses, conversions: v.conversions, pct: Math.round((v.conversions / v.uses) * 1000) / 10 }))
    .sort((a, b) => b.pct - a.pct);
}

export type ArtistEngagement = { artistId: number; artistName: string; views: number; listens: number; watchlistAdds: number; trades: number; score: number };

// score weights active signals above a passive view (trade > watchlist add
// > listen > view) — a deliberately simple, transparent formula, not a
// tuned model.
export async function getTopEngagementArtists(limit = 10): Promise<ArtistEngagement[]> {
  const counts = new Map<number, { views: number; listens: number; watchlistAdds: number; trades: number }>();
  const bump = (artistId: number, key: 'views' | 'listens' | 'watchlistAdds' | 'trades') => {
    const entry = counts.get(artistId) ?? { views: 0, listens: 0, watchlistAdds: 0, trades: 0 };
    entry[key]++;
    counts.set(artistId, entry);
  };

  for (const e of await getAllEvents()) {
    const artistId = metadataArtistId(e);
    if (artistId == null) continue;
    if (e.event_type === 'artist_detail_opened') bump(artistId, 'views');
    else if (e.event_type === 'watchlist_added') bump(artistId, 'watchlistAdds');
  }
  for (const l of await getAllPreviewListenEvents()) if (l.event === 'started') bump(l.artist_id, 'listens');
  for (const t of await getAllTransactionsForAnalytics()) bump(t.artist_id, 'trades');

  const results: ArtistEngagement[] = [];
  for (const [artistId, c] of counts) {
    const artist = await getArtist(artistId);
    if (!artist) continue;
    results.push({ artistId, artistName: artist.name, ...c, score: c.views + c.listens * 2 + c.watchlistAdds * 3 + c.trades * 5 });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export type GenreRetention = { genre: string; userCount: number; day7RetentionPct: number | null };

// A user's "genre" is whichever genre their first-ever trade's artist
// belongs to — users who never traded have no defined cohort and are
// excluded, same reasoning getFavoriteGenres (Public Profile section)
// already established for "which genres are yours."
export async function getGenreRetention(): Promise<GenreRetention[]> {
  const usersByGenre = new Map<string, number[]>();
  for (const [userId, first] of await firstTradeByUser()) {
    const genre = (await getArtist(first.artistId))?.genre;
    if (!genre) continue;
    const list = usersByGenre.get(genre) ?? [];
    list.push(userId);
    usersByGenre.set(genre, list);
  }

  const usersById = new Map((await getAllUsers()).map((u) => [u.id, u]));
  const activityByUser = await getAllActivityTimestampsByUser();

  return [...usersByGenre.entries()]
    .map(([genre, userIds]) => {
      const retention = computeRetention(userIds, 7, usersById, activityByUser);
      return { genre, userCount: userIds.length, day7RetentionPct: retention.pct };
    })
    .sort((a, b) => b.userCount - a.userCount);
}

// --- Growth loops ---
// The paths by which NEXT is meant to spread: a signed-out visitor browsing,
// a shared "I was early" proof link, and a private-league invite. Counted
// with SQL (these tables only grow), each figure labelled for what it
// actually is — e.g. signed-out page views are views, not unique people,
// because a visitor without an account has no id to count them by.
export type GrowthLoops = {
  guestDiscoverViews: number;
  guestArtistViews: number;
  signups: number;
  onboardingCompleted: number;
  pickedGenres: number;
  backedAnArtist: number;
  proofLinksShared: number;
  proofViewsSignedOut: number;
  proofViewsSignedIn: number;
  leaguesActive: number;
  leagueMembers: number;
  leagueInvitesShared: number;
  inviteViewsSignedOut: number;
  inviteViewsSignedIn: number;
  leagueJoins: number;
};

export async function getGrowthLoops(): Promise<GrowthLoops> {
  const count = async (sql: string, ...params: unknown[]) => ((await db.prepare(sql).get(...params)) as { c: number }).c;
  const events = async (type: string, extra = '') => count(`SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = ? ${extra}`, type);
  const meta = (key: string) => `(CASE WHEN metadata IS NULL THEN NULL ELSE metadata::jsonb ->> '${key}' END)`;

  return {
    guestDiscoverViews: await events('discover_viewed', 'AND user_id IS NULL'),
    guestArtistViews: await events('artist_detail_opened', `AND user_id IS NULL AND ${meta('via')} IS DISTINCT FROM 'proof_page'`),
    signups: await count('SELECT COUNT(*) AS c FROM users'),
    onboardingCompleted: await count('SELECT COUNT(*) AS c FROM users WHERE next_onboarded_at IS NOT NULL'),
    pickedGenres: await count('SELECT COUNT(*) AS c FROM users WHERE next_genre_prefs IS NOT NULL'),
    backedAnArtist: await count('SELECT COUNT(DISTINCT user_id) AS c FROM next_founding_believers'),
    proofLinksShared: await events('proof_link_shared'),
    proofViewsSignedOut: await events('artist_detail_opened', `AND user_id IS NULL AND ${meta('via')} = 'proof_page'`),
    proofViewsSignedIn: await events('artist_detail_opened', `AND user_id IS NOT NULL AND ${meta('via')} = 'proof_page'`),
    leaguesActive: await count('SELECT COUNT(*) AS c FROM next_leagues'),
    leagueMembers: await count('SELECT COUNT(*) AS c FROM next_league_members'),
    leagueInvitesShared: await events('league_invite_shared'),
    inviteViewsSignedOut: await events('league_invite_viewed', 'AND user_id IS NULL'),
    inviteViewsSignedIn: await events('league_invite_viewed', 'AND user_id IS NOT NULL'),
    leagueJoins: await events('league_joined'),
  };
}

// --- Activity pulse ---
// Active = did anything recorded on NEXT (a page view event, a preview
// play or a trade) in the window. Signed-in players only: signed-out
// visitors can't be told apart.
export type ActivityPulse = {
  dau: number; wau: number; mau: number;
  returnedNextWeek: { eligible: number; returned: number };
  signupsBySource: { via: string; count: number }[];
  activeArtists7d: number; artistsOnNext: number;
  claims: { requested: number; approved: number };
  challengeParticipants: number;
};

export async function getActivityPulse(now: Date = new Date()): Promise<ActivityPulse> {
  const iso = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const activeSince = async (since: string) => ((await db.prepare(`
    SELECT COUNT(DISTINCT user_id) AS c FROM (
      SELECT user_id FROM analytics_events WHERE user_id IS NOT NULL AND created_at >= ?
      UNION ALL SELECT user_id FROM preview_listens WHERE created_at >= ?
      UNION ALL SELECT user_id FROM next_transactions WHERE created_at >= ?
    ) a
  `).get(since, since, since)) as { c: number }).c;

  // "Came back the following week": accounts created 7–14 days ago that
  // did something on NEXT 7+ days after signing up.
  const cohort = (await db.prepare(`
    SELECT u.id, u.created_at FROM users u WHERE u.created_at >= ? AND u.created_at < ?
  `).all(iso(14), iso(7))) as { id: number; created_at: string }[];
  let returned = 0;
  for (const u of cohort) {
    const after = new Date(new Date(u.created_at).getTime() + 7 * 86_400_000).toISOString();
    const hit = await db.prepare(`
      SELECT 1 AS x FROM analytics_events WHERE user_id = ? AND created_at >= ?
      UNION ALL SELECT 1 FROM preview_listens WHERE user_id = ? AND created_at >= ?
      UNION ALL SELECT 1 FROM next_transactions WHERE user_id = ? AND created_at >= ?
      LIMIT 1
    `).get(u.id, after, u.id, after, u.id, after);
    if (hit) returned++;
  }

  const signupsBySource = (await db.prepare(`
    SELECT COALESCE(CASE WHEN metadata IS NULL THEN NULL ELSE metadata::jsonb ->> 'via' END, 'unknown') AS via, COUNT(*) AS count
    FROM analytics_events WHERE event_type = 'signup_completed' AND created_at >= ?
    GROUP BY 1 ORDER BY 2 DESC
  `).all(iso(30))) as { via: string; count: number }[];

  const activeArtists7d = ((await db.prepare(`
    SELECT COUNT(DISTINCT (metadata::jsonb ->> 'artistId')) AS c FROM analytics_events
    WHERE event_type = 'artist_detail_opened' AND created_at >= ? AND metadata IS NOT NULL
  `).get(iso(7))) as { c: number }).c;
  const artistsOnNext = ((await db.prepare("SELECT COUNT(*) AS c FROM artists WHERE stage <> 'passed'").get()) as { c: number }).c;
  const claims = (await db.prepare("SELECT COUNT(*) AS requested, COUNT(*) FILTER (WHERE status = 'approved') AS approved FROM artist_claims").get()) as { requested: number; approved: number };

  const { getChallengeLeaderboard } = await import('./challenges');
  const challengeParticipants = (await getChallengeLeaderboard(100_000, now)).filter((e) => e.completedThisWeek > 0).length;

  return {
    dau: await activeSince(iso(1)), wau: await activeSince(iso(7)), mau: await activeSince(iso(30)),
    returnedNextWeek: { eligible: cohort.length, returned },
    signupsBySource, activeArtists7d, artistsOnNext, claims, challengeParticipants,
  };
}
