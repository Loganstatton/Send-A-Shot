import { randomInt } from 'node:crypto';
import { db, isUniqueViolation } from './pg';
import { getStandingsSince, StandingSince } from './db';

// Private leagues: a group of friends ranked against each other. A league
// is found only through its invite code — there is no public directory —
// and its standings are visible to its members only.
//
// Ranking is by return since each member JOINED the league, not since
// signup, so a newcomer starts level with people who've been playing for
// months, and nobody can join a league already holding a big all-time lead.

export const LEAGUE_MAX_MEMBERS = 50;
export const LEAGUE_MAX_OWNED = 10;
export const LEAGUE_MAX_JOINED = 25;
export const LEAGUE_NAME_MIN = 3;
export const LEAGUE_NAME_MAX = 40;

// No 0/O/1/I/L: codes get read aloud and typed from screenshots.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export type League = { id: number; name: string; invite_code: string; owner_id: number; created_at: string };
export type LeagueSummary = League & { member_count: number; joined_at: string };
export type LeagueStanding = StandingSince & { rank: number; joined_at: string; isOwner: boolean };

export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

// Accepts what people actually paste: lowercase, spaces, dashes, or the
// whole invite URL.
export function normalizeInviteCode(input: string): string {
  const last = input.trim().split('/').filter(Boolean).pop() ?? '';
  return last.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function validateLeagueName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (name.length < LEAGUE_NAME_MIN) return { ok: false, error: `League name needs at least ${LEAGUE_NAME_MIN} characters.` };
  if (name.length > LEAGUE_NAME_MAX) return { ok: false, error: `League name can be at most ${LEAGUE_NAME_MAX} characters.` };
  return { ok: true, name };
}

const LEAGUE_COLUMNS = 'id, name, invite_code, owner_id, created_at';

export async function getLeagueById(id: number): Promise<League | undefined> {
  return (await db.prepare(`SELECT ${LEAGUE_COLUMNS} FROM next_leagues WHERE id = ?`).get(id)) as League | undefined;
}

export async function getLeagueByCode(code: string): Promise<League | undefined> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return undefined;
  return (await db.prepare(`SELECT ${LEAGUE_COLUMNS} FROM next_leagues WHERE invite_code = ?`).get(normalized)) as League | undefined;
}

export async function getLeagueMemberCount(leagueId: number): Promise<number> {
  const row = (await db.prepare('SELECT COUNT(*) AS c FROM next_league_members WHERE league_id = ?').get(leagueId)) as { c: number };
  return row.c;
}

export async function isLeagueMember(leagueId: number, userId: number): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 AS x FROM next_league_members WHERE league_id = ? AND user_id = ?').get(leagueId, userId));
}

export async function getLeaguesForUser(userId: number): Promise<LeagueSummary[]> {
  return (await db.prepare(`
    SELECT l.id, l.name, l.invite_code, l.owner_id, l.created_at, m.joined_at,
      (SELECT COUNT(*) FROM next_league_members c WHERE c.league_id = l.id) AS member_count
    FROM next_league_members m
    JOIN next_leagues l ON l.id = m.league_id
    WHERE m.user_id = ?
    ORDER BY m.joined_at DESC, l.id DESC
  `).all(userId)) as LeagueSummary[];
}

export type CreateLeagueResult = { ok: true; league: League } | { ok: false; error: string };

export async function createLeague(ownerId: number, rawName: unknown): Promise<CreateLeagueResult> {
  const valid = validateLeagueName(rawName);
  if (!valid.ok) return valid;
  return await db.transaction(async (): Promise<CreateLeagueResult> => {
    // Serializes one user's concurrent creates so the cap can't be raced.
    await db.prepare('SELECT id FROM users WHERE id = ? FOR UPDATE').get(ownerId);
    const owned = (await db.prepare('SELECT COUNT(*) AS c FROM next_leagues WHERE owner_id = ?').get(ownerId)) as { c: number };
    if (owned.c >= LEAGUE_MAX_OWNED) return { ok: false, error: `You can run at most ${LEAGUE_MAX_OWNED} leagues.` };
    if ((await countMemberships(ownerId)) >= LEAGUE_MAX_JOINED) {
      return { ok: false, error: `You're already in ${LEAGUE_MAX_JOINED} leagues — leave one first.` };
    }

    const now = new Date().toISOString();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        // Nested transaction = savepoint, so a code collision only rolls
        // back this one insert, not the whole create.
        const league = await db.transaction(async () => {
          const code = generateInviteCode();
          const info = await db
            .prepare('INSERT INTO next_leagues (name, invite_code, owner_id, created_at) VALUES (?, ?, ?, ?)')
            .run(valid.name, code, ownerId, now);
          return { id: info.lastInsertRowid, name: valid.name, invite_code: code, owner_id: ownerId, created_at: now };
        });
        await db.prepare('INSERT INTO next_league_members (league_id, user_id, joined_at) VALUES (?, ?, ?)').run(league.id, ownerId, now);
        return { ok: true, league };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new Error('Could not generate a unique invite code.');
  });
}

async function countMemberships(userId: number): Promise<number> {
  const row = (await db.prepare('SELECT COUNT(*) AS c FROM next_league_members WHERE user_id = ?').get(userId)) as { c: number };
  return row.c;
}

export type JoinLeagueResult =
  | { ok: true; league: League; alreadyMember: boolean }
  | { ok: false; status: 404 | 409; error: string };

export async function joinLeague(userId: number, code: string): Promise<JoinLeagueResult> {
  const normalized = normalizeInviteCode(code);
  return await db.transaction(async (): Promise<JoinLeagueResult> => {
    // Locking the league row serializes joins to it, so two people taking
    // the last open seat at once can't both get in.
    const league = normalized
      ? ((await db.prepare(`SELECT ${LEAGUE_COLUMNS} FROM next_leagues WHERE invite_code = ? FOR UPDATE`).get(normalized)) as League | undefined)
      : undefined;
    if (!league) return { ok: false, status: 404, error: "That invite code doesn't match any league. Check it and try again." };
    if (await isLeagueMember(league.id, userId)) return { ok: true, league, alreadyMember: true };

    if ((await getLeagueMemberCount(league.id)) >= LEAGUE_MAX_MEMBERS) {
      return { ok: false, status: 409, error: `${league.name} is full (${LEAGUE_MAX_MEMBERS} members).` };
    }
    await db.prepare('SELECT id FROM users WHERE id = ? FOR UPDATE').get(userId);
    if ((await countMemberships(userId)) >= LEAGUE_MAX_JOINED) {
      return { ok: false, status: 409, error: `You're already in ${LEAGUE_MAX_JOINED} leagues — leave one first.` };
    }
    await db
      .prepare('INSERT INTO next_league_members (league_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
      .run(league.id, userId, new Date().toISOString());
    return { ok: true, league, alreadyMember: false };
  });
}

export type LeaveLeagueResult = { ok: true; deleted: boolean } | { ok: false; error: string };

// Leaving is always allowed. If the owner leaves, the longest-standing
// remaining member takes over; if nobody is left, the league is deleted.
export async function leaveLeague(leagueId: number, userId: number): Promise<LeaveLeagueResult> {
  return await db.transaction(async (): Promise<LeaveLeagueResult> => {
    const league = (await db.prepare(`SELECT ${LEAGUE_COLUMNS} FROM next_leagues WHERE id = ? FOR UPDATE`).get(leagueId)) as League | undefined;
    if (!league) return { ok: false, error: 'League not found.' };
    const removed = await db.prepare('DELETE FROM next_league_members WHERE league_id = ? AND user_id = ?').run(leagueId, userId);
    if (removed.changes === 0) return { ok: false, error: "You're not in this league." };

    if (league.owner_id === userId) {
      const next = (await db
        .prepare('SELECT user_id FROM next_league_members WHERE league_id = ? ORDER BY joined_at ASC, user_id ASC LIMIT 1')
        .get(leagueId)) as { user_id: number } | undefined;
      if (!next) {
        await db.prepare('DELETE FROM next_leagues WHERE id = ?').run(leagueId);
        return { ok: true, deleted: true };
      }
      await db.prepare('UPDATE next_leagues SET owner_id = ? WHERE id = ?').run(next.user_id, leagueId);
    }
    return { ok: true, deleted: false };
  });
}

export type OwnerActionResult = { ok: true } | { ok: false; status: 403 | 404 | 400; error: string };

// Owner-only: take someone out of the league (e.g. a stranger who got
// hold of the invite link). They can rejoin only if they still have a
// valid code — the owner can reset it below to stop that.
export async function removeLeagueMember(leagueId: number, ownerId: number, memberId: number): Promise<OwnerActionResult> {
  return await db.transaction(async (): Promise<OwnerActionResult> => {
    const league = (await db.prepare(`SELECT ${LEAGUE_COLUMNS} FROM next_leagues WHERE id = ? FOR UPDATE`).get(leagueId)) as League | undefined;
    if (!league) return { ok: false, status: 404, error: 'League not found.' };
    if (league.owner_id !== ownerId) return { ok: false, status: 403, error: 'Only the league owner can remove members.' };
    if (memberId === ownerId) return { ok: false, status: 400, error: 'Use "Leave league" to leave your own league.' };
    const removed = await db.prepare('DELETE FROM next_league_members WHERE league_id = ? AND user_id = ?').run(leagueId, memberId);
    if (removed.changes === 0) return { ok: false, status: 404, error: "That person isn't in this league." };
    return { ok: true };
  });
}

// Owner-only: replace the invite code, so links already shared stop working.
export async function resetLeagueInviteCode(leagueId: number, ownerId: number): Promise<{ ok: true; code: string } | Extract<OwnerActionResult, { ok: false }>> {
  return await db.transaction(async () => {
    const league = (await db.prepare(`SELECT ${LEAGUE_COLUMNS} FROM next_leagues WHERE id = ? FOR UPDATE`).get(leagueId)) as League | undefined;
    if (!league) return { ok: false as const, status: 404 as const, error: 'League not found.' };
    if (league.owner_id !== ownerId) return { ok: false as const, status: 403 as const, error: 'Only the league owner can reset the invite link.' };
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const code = generateInviteCode();
        await db.transaction(async () => {
          await db.prepare('UPDATE next_leagues SET invite_code = ? WHERE id = ?').run(code, leagueId);
        });
        return { ok: true as const, code };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new Error('Could not generate a unique invite code.');
  });
}

// Members ranked by return since they joined; ties go to whoever has backed
// more artists, then to whoever joined first.
export async function getLeagueStandings(league: League): Promise<LeagueStanding[]> {
  const members = (await db
    .prepare('SELECT user_id, joined_at FROM next_league_members WHERE league_id = ?')
    .all(league.id)) as { user_id: number; joined_at: string }[];
  const joinedAt = new Map(members.map((m) => [m.user_id, m.joined_at]));
  const standings = await getStandingsSince(joinedAt);
  const ranked = standings
    .map((s) => ({ ...s, rank: 0, joined_at: joinedAt.get(s.user.id)!, isOwner: s.user.id === league.owner_id }))
    .sort((a, b) => b.returnSincePct - a.returnSincePct || b.artistsBackedCount - a.artistsBackedCount || a.joined_at.localeCompare(b.joined_at));
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return ranked;
}

export type LeagueActivityItem = { userId: number; userName: string; artistId: number; artistName: string; backerNumber: number; at: string; recordId: number };

// Members' first backings since they joined this league, newest first —
// "who found what" within the group.
export async function getLeagueActivity(leagueId: number, limit = 15): Promise<LeagueActivityItem[]> {
  return (await db.prepare(`
    SELECT b.user_id AS "userId", u.name AS "userName", b.artist_id AS "artistId", a.name AS "artistName",
      b.discovery_rank AS "backerNumber", b.purchased_at AS at, b.id AS "recordId"
    FROM next_league_members m
    JOIN next_founding_believers b ON b.user_id = m.user_id AND b.purchased_at >= m.joined_at
    JOIN users u ON u.id = b.user_id
    JOIN artists a ON a.id = b.artist_id
    WHERE m.league_id = ?
    ORDER BY b.purchased_at DESC, b.id DESC
    LIMIT ?
  `).all(leagueId, limit)) as LeagueActivityItem[];
}
