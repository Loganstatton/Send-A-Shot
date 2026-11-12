import { db } from './pg';

// Discovery reputation: how good a player is at finding artists BEFORE
// other people do — separate from trading returns.
//
// A pick (a player's first backing of an artist) earns credit only for the
// real players who backed that same artist AFTER them. So:
//  - backing an artist who's already popular earns almost nothing (few or
//    no qualifying backers come after you);
//  - backing an obscure artist nobody else ever backs earns nothing either
//    (being "first" alone isn't skill);
//  - the credit grows with how many followed, but logarithmically, so one
//    pile-on artist can't dominate a whole record;
//  - earlier positions earn more of it;
//  - a miss costs a little: a pick nobody followed within MISS_AFTER_DAYS
//    subtracts MISS_PENALTY, so backing everything early in the hope that
//    some of it sticks scores worse than choosing well. Newer picks aren't
//    counted as misses until they've had that long.
//
// Manipulation: a later backer only counts if they're a "qualifying"
// player — one who has backed at least QUALIFYING_MIN_BACKINGS different
// artists. Spinning up throwaway accounts to back your own picks costs
// several real backings per account, and every one of them is recorded,
// visible and covered by the existing market-integrity flags.
//
// Measured only from NEXT's own permanent first-backing records. Once
// verified real-world growth data exists it should become a second input;
// until then the page that shows this says what it measures.

export const QUALIFYING_MIN_BACKINGS = 3;
export const REPUTATION_MIN_PICKS = 3;
export const MISS_PENALTY = 0.5;
export const MISS_AFTER_DAYS = 14;

// Position weight: first 10 backers get full credit, 11–50 half, later a
// quarter.
export function positionWeight(rank: number): number {
  if (rank <= 10) return 1;
  if (rank <= 50) return 0.5;
  return 0.25;
}

export function pickCredit(rank: number, laterQualifyingBackers: number): number {
  if (laterQualifyingBackers <= 0) return 0;
  return positionWeight(rank) * Math.log2(1 + laterQualifyingBackers);
}

export type ReputationEntry = {
  userId: number;
  name: string;
  avatar_url?: string;
  reputation: number;
  picks: number;
  creditedPicks: number;
  misses: number;
  followers: number; // qualifying players who backed their picks afterwards
  rank: number;
};

type PickRow = { user_id: number; discovery_rank: number; purchased_at: string; later: number };

async function loadPicks(userId?: number): Promise<PickRow[]> {
  return (await db.prepare(`
    WITH qualifying AS (
      SELECT user_id FROM next_founding_believers GROUP BY user_id HAVING COUNT(DISTINCT artist_id) >= ?
    )
    SELECT b.user_id, b.discovery_rank, b.purchased_at,
      (SELECT COUNT(*) FROM next_founding_believers l
        WHERE l.artist_id = b.artist_id AND l.discovery_rank > b.discovery_rank AND l.user_id <> b.user_id
          AND l.user_id IN (SELECT user_id FROM qualifying)) AS later
    FROM next_founding_believers b
    ${userId != null ? 'WHERE b.user_id = ?' : ''}
  `).all(...(userId != null ? [QUALIFYING_MIN_BACKINGS, userId] : [QUALIFYING_MIN_BACKINGS]))) as PickRow[];
}

function summarize(rows: PickRow[], now: Date = new Date()) {
  const missCutoff = new Date(now.getTime() - MISS_AFTER_DAYS * 86_400_000).toISOString();
  let reputation = 0, creditedPicks = 0, followers = 0, misses = 0;
  for (const r of rows) {
    const credit = pickCredit(r.discovery_rank, r.later);
    reputation += credit;
    if (credit > 0) creditedPicks++;
    else if (r.purchased_at <= missCutoff) misses++;
    followers += r.later;
  }
  reputation = Math.max(0, reputation - misses * MISS_PENALTY);
  return { reputation: Math.round(reputation * 10) / 10, picks: rows.length, creditedPicks, misses, followers };
}

export async function getReputation(userId: number) {
  return summarize(await loadPicks(userId));
}

// Players with at least REPUTATION_MIN_PICKS picks and some credit,
// highest first; ties go to more credited picks, then fewer total picks
// (a higher hit rate).
export async function getReputationLeaderboard(limit = 100): Promise<ReputationEntry[]> {
  const byUser = new Map<number, PickRow[]>();
  for (const r of await loadPicks()) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }
  const ids = [...byUser.keys()];
  if (ids.length === 0) return [];
  const users = (await db
    .prepare(`SELECT id, name, avatar_url FROM users WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids)) as { id: number; name: string; avatar_url: string | null }[];
  const nameById = new Map(users.map((u) => [u.id, u]));

  const entries: ReputationEntry[] = [];
  for (const [userId, rows] of byUser) {
    const s = summarize(rows);
    const u = nameById.get(userId);
    if (!u || s.picks < REPUTATION_MIN_PICKS || s.reputation <= 0) continue;
    entries.push({ userId, name: u.name, avatar_url: u.avatar_url ?? undefined, ...s, rank: 0 });
  }
  entries.sort((a, b) => b.reputation - a.reputation || b.creditedPicks - a.creditedPicks || a.picks - b.picks);
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries.slice(0, limit);
}
