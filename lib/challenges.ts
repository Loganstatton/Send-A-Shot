import { db } from './pg';
import { genreParts } from './genre-match';
import { marketSentiment } from './next-market';
import { EARLY_DISCOVERY_RANK_THRESHOLD } from './scout-score';

// Weekly challenges. Like Scout badges (lib/scout-badges.ts), nothing is
// stored: each challenge is worked out on demand from records NEXT already
// keeps — first backings (next_founding_believers, which never change),
// preview listens and league memberships. Only NEXT's own activity is
// used, never outside streaming or social numbers.
//
// Weeks run Monday 00:00 UTC to the next Monday 00:00 UTC. Completing at
// least STREAK_MIN of them in a week keeps a streak going. There are no
// prizes: it's bragging rights and a reason to come back.

export const STREAK_MIN = 3;
const STREAK_LOOKBACK_WEEKS = 52;
const LISTEN_TARGET = 5;

export type ChallengeKey = 'early_call' | 'new_genre' | 'scouts_call' | 'listen' | 'recruit';
export type ChallengeProgress = { key: ChallengeKey; title: string; description: string; progress: number; target: number; done: boolean };
export type WeeklyChallenges = {
  weekStart: string;
  weekEnd: string;
  challenges: ChallengeProgress[];
  completedCount: number;
  streakWeeks: number;
};

const DEFINITIONS: { key: ChallengeKey; title: string; description: string; target: number }[] = [
  { key: 'early_call', title: 'Early call', description: `Be one of the first ${EARLY_DISCOVERY_RANK_THRESHOLD} backers of an artist.`, target: 1 },
  { key: 'new_genre', title: 'New sound', description: "Back an artist in a genre you've never backed before.", target: 1 },
  { key: 'scouts_call', title: 'Trust the Scouts', description: 'Back an artist while our Scouts rate them higher than the market.', target: 1 },
  { key: 'listen', title: 'Crate digger', description: `Listen to previews from ${LISTEN_TARGET} different artists.`, target: LISTEN_TARGET },
  { key: 'recruit', title: 'Bring a friend', description: 'Get someone to join a league you run.', target: 1 },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function weekStartUtc(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

type Backing = { purchased_at: string; discovery_rank: number; next_score: number; next_price_cents: number; genre: string | null };
type Listen = { artist_id: number; created_at: string };
type Join = { joined_at: string };

type Activity = { backings: Backing[]; listens: Listen[]; joins: Join[] };

async function loadActivity(userId: number, sinceIso: string): Promise<Activity> {
  // Every backing ever (not just since `sinceIso`): "a genre you've never
  // backed" needs the full history before each one.
  const backings = (await db.prepare(`
    SELECT b.purchased_at, b.discovery_rank, b.next_score, b.next_price_cents, a.genre
    FROM next_founding_believers b
    JOIN artists a ON a.id = b.artist_id
    WHERE b.user_id = ?
    ORDER BY b.purchased_at ASC, b.id ASC
  `).all(userId)) as Backing[];
  const listens = (await db.prepare(
    "SELECT artist_id, created_at FROM preview_listens WHERE user_id = ? AND event = 'started' AND created_at >= ?",
  ).all(userId, sinceIso)) as Listen[];
  const joins = (await db.prepare(`
    SELECT m.joined_at
    FROM next_league_members m
    JOIN next_leagues l ON l.id = m.league_id
    WHERE l.owner_id = ? AND m.user_id <> ? AND m.joined_at >= ?
  `).all(userId, userId, sinceIso)) as Join[];
  return { backings, listens, joins };
}

function progressForWeek(activity: Activity, startIso: string, endIso: string): ChallengeProgress[] {
  const inWeek = (iso: string) => iso >= startIso && iso < endIso;
  let earlyCall = 0;
  let newGenre = 0;
  let scoutsCall = 0;
  const seenParts = new Set<string>();
  for (const b of activity.backings) {
    const parts = b.genre ? genreParts(b.genre) : [];
    if (inWeek(b.purchased_at)) {
      if (b.discovery_rank <= EARLY_DISCOVERY_RANK_THRESHOLD) earlyCall++;
      if (parts.length > 0 && parts.every((p) => !seenParts.has(p))) newGenre++;
      if (marketSentiment(b.next_score, b.next_price_cents).tone === 'undervalued') scoutsCall++;
    }
    for (const p of parts) seenParts.add(p);
  }
  const listened = new Set(activity.listens.filter((l) => inWeek(l.created_at)).map((l) => l.artist_id)).size;
  const recruits = activity.joins.filter((j) => inWeek(j.joined_at)).length;
  const raw: Record<ChallengeKey, number> = { early_call: earlyCall, new_genre: newGenre, scouts_call: scoutsCall, listen: listened, recruit: recruits };

  return DEFINITIONS.map((d) => ({ ...d, progress: Math.min(raw[d.key], d.target), done: raw[d.key] >= d.target }));
}

export async function getWeeklyChallenges(userId: number, now: Date = new Date()): Promise<WeeklyChallenges> {
  const thisWeek = weekStartUtc(now);
  const lookbackStart = new Date(thisWeek.getTime() - STREAK_LOOKBACK_WEEKS * WEEK_MS);
  const activity = await loadActivity(userId, lookbackStart.toISOString());

  const weekAt = (offset: number) => {
    const start = new Date(thisWeek.getTime() - offset * WEEK_MS);
    const end = new Date(start.getTime() + WEEK_MS);
    return progressForWeek(activity, start.toISOString(), end.toISOString());
  };
  const completed = (week: ChallengeProgress[]) => week.filter((c) => c.done).length;

  const challenges = weekAt(0);
  const completedCount = completed(challenges);

  // A streak counts finished weeks in a row up to last week, plus this
  // week once it's already reached the bar — so it doesn't reset to 0 on
  // Monday morning before anyone has had a chance to play.
  let streakWeeks = completedCount >= STREAK_MIN ? 1 : 0;
  for (let offset = 1; offset <= STREAK_LOOKBACK_WEEKS; offset++) {
    if (completed(weekAt(offset)) < STREAK_MIN) break;
    streakWeeks++;
  }

  return {
    weekStart: thisWeek.toISOString(),
    weekEnd: new Date(thisWeek.getTime() + WEEK_MS).toISOString(),
    challenges,
    completedCount,
    streakWeeks,
  };
}

export type ChallengeLeaderboardEntry = { userId: number; name: string; avatar_url?: string; streakWeeks: number; completedThisWeek: number; rank: number };

// Longest current streaks, then most challenges done this week. Only
// players with some challenge activity in the streak window are worked
// out at all, so this stays cheap while most accounts are idle.
export async function getChallengeLeaderboard(limit = 50, now: Date = new Date()): Promise<ChallengeLeaderboardEntry[]> {
  const since = new Date(weekStartUtc(now).getTime() - STREAK_LOOKBACK_WEEKS * WEEK_MS).toISOString();
  const active = (await db.prepare(`
    SELECT DISTINCT u.id, u.name, u.avatar_url FROM users u
    WHERE EXISTS (SELECT 1 FROM next_founding_believers b WHERE b.user_id = u.id AND b.purchased_at >= ?)
       OR EXISTS (SELECT 1 FROM preview_listens p WHERE p.user_id = u.id AND p.event = 'started' AND p.created_at >= ?)
       OR EXISTS (SELECT 1 FROM next_leagues l JOIN next_league_members m ON m.league_id = l.id
                  WHERE l.owner_id = u.id AND m.user_id <> u.id AND m.joined_at >= ?)
  `).all(since, since, since)) as { id: number; name: string; avatar_url: string | null }[];

  const entries: ChallengeLeaderboardEntry[] = [];
  for (const u of active) {
    const week = await getWeeklyChallenges(u.id, now);
    if (week.streakWeeks === 0 && week.completedCount === 0) continue;
    entries.push({ userId: u.id, name: u.name, avatar_url: u.avatar_url ?? undefined, streakWeeks: week.streakWeeks, completedThisWeek: week.completedCount, rank: 0 });
  }
  entries.sort((a, b) => b.streakWeeks - a.streakWeeks || b.completedThisWeek - a.completedThisWeek || a.name.localeCompare(b.name));
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries.slice(0, limit);
}
