import { describe, expect, it } from 'vitest';

const { createArtist, createUser, db, executeTrade } = await import('./db');
const {
  createLeague, getLeagueByCode, getLeagueById, getLeagueMemberCount, getLeaguesForUser, getLeagueStandings, isLeagueMember,
  joinLeague, LEAGUE_MAX_MEMBERS, LEAGUE_MAX_OWNED, leaveLeague, normalizeInviteCode, removeLeagueMember, resetLeagueInviteCode,
  validateLeagueName,
} = await import('./leagues');

let seq = 0;
async function makeUser(label = 'Member') {
  seq++;
  return createUser({ name: `${label} ${seq}`, email: `league-${seq}@example.com`, password_hash: 'hash' });
}
async function makeArtist() {
  seq++;
  return createArtist({
    name: `League Artist ${seq}`, genre: 'Pop', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7,
    brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7,
  });
}
async function newLeague(ownerId: number, name = 'Crate Diggers') {
  const r = await createLeague(ownerId, name);
  if (!r.ok) throw new Error(r.error);
  return r.league;
}

describe('league names and codes', () => {
  it('trims and collapses whitespace, and enforces length', () => {
    expect(validateLeagueName('  Group   Chat  ')).toEqual({ ok: true, name: 'Group Chat' });
    expect(validateLeagueName('ab').ok).toBe(false);
    expect(validateLeagueName('x'.repeat(41)).ok).toBe(false);
    expect(validateLeagueName(42).ok).toBe(false);
  });

  it('accepts a pasted code in any case, with dashes, or as the full invite URL', () => {
    expect(normalizeInviteCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizeInviteCode('https://example.com/next/leagues/join/abcd2345/')).toBe('ABCD2345');
  });
});

describe('creating and joining', () => {
  it('makes the creator the owner and first member, with an 8-character invite code', async () => {
    const owner = await makeUser('Owner');
    const league = await newLeague(owner.id);
    expect(league.owner_id).toBe(owner.id);
    expect(league.invite_code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(await isLeagueMember(league.id, owner.id)).toBe(true);
    expect((await getLeagueByCode(league.invite_code.toLowerCase()))?.id).toBe(league.id);
  });

  it('joins by code; joining twice is a harmless no-op', async () => {
    const owner = await makeUser('Owner');
    const friend = await makeUser('Friend');
    const league = await newLeague(owner.id);

    const first = await joinLeague(friend.id, league.invite_code);
    expect(first).toMatchObject({ ok: true, alreadyMember: false });
    const again = await joinLeague(friend.id, league.invite_code);
    expect(again).toMatchObject({ ok: true, alreadyMember: true });
    expect(await getLeagueMemberCount(league.id)).toBe(2);
    expect((await getLeaguesForUser(friend.id)).map((l) => l.id)).toContain(league.id);
  });

  it('rejects an unknown code', async () => {
    const user = await makeUser();
    expect(await joinLeague(user.id, 'ZZZZZZZZ')).toMatchObject({ ok: false, status: 404 });
    expect(await joinLeague(user.id, '')).toMatchObject({ ok: false, status: 404 });
  });

  it('caps how many leagues one person can run', async () => {
    const owner = await makeUser('Busy Owner');
    for (let i = 0; i < LEAGUE_MAX_OWNED; i++) await newLeague(owner.id, `League ${i}`);
    const over = await createLeague(owner.id, 'One too many');
    expect(over.ok).toBe(false);
  });

  it('never lets simultaneous joins push a league past its member cap', async () => {
    const owner = await makeUser('Owner');
    const league = await newLeague(owner.id);
    // Fill to one short of the cap, then race five people for the last seat.
    const fillers = await Promise.all(Array.from({ length: LEAGUE_MAX_MEMBERS - 2 }, () => makeUser('Filler')));
    for (const f of fillers) expect((await joinLeague(f.id, league.invite_code)).ok).toBe(true);
    const racers = await Promise.all(Array.from({ length: 5 }, () => makeUser('Racer')));
    const results = await Promise.all(racers.map((r) => joinLeague(r.id, league.invite_code)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.status === 409)).toHaveLength(4);
    expect(await getLeagueMemberCount(league.id)).toBe(LEAGUE_MAX_MEMBERS);
  });
});

describe('leaving, removing and resetting the link', () => {
  it('hands ownership to the longest-standing member when the owner leaves, and deletes an empty league', async () => {
    const owner = await makeUser('Owner');
    const early = await makeUser('Early');
    const late = await makeUser('Late');
    const league = await newLeague(owner.id);
    await joinLeague(early.id, league.invite_code);
    await joinLeague(late.id, league.invite_code);

    expect(await leaveLeague(league.id, owner.id)).toEqual({ ok: true, deleted: false });
    expect((await getLeagueById(league.id))?.owner_id).toBe(early.id);

    await leaveLeague(league.id, late.id);
    expect(await leaveLeague(league.id, early.id)).toEqual({ ok: true, deleted: true });
    expect(await getLeagueById(league.id)).toBeUndefined();
  });

  it('only the owner can remove members or reset the invite code', async () => {
    const owner = await makeUser('Owner');
    const a = await makeUser('A');
    const b = await makeUser('B');
    const league = await newLeague(owner.id);
    await joinLeague(a.id, league.invite_code);
    await joinLeague(b.id, league.invite_code);

    expect(await removeLeagueMember(league.id, a.id, b.id)).toMatchObject({ ok: false, status: 403 });
    expect(await removeLeagueMember(league.id, owner.id, owner.id)).toMatchObject({ ok: false, status: 400 });
    expect(await removeLeagueMember(league.id, owner.id, b.id)).toEqual({ ok: true });
    expect(await isLeagueMember(league.id, b.id)).toBe(false);

    expect(await resetLeagueInviteCode(league.id, a.id)).toMatchObject({ ok: false, status: 403 });
    const reset = await resetLeagueInviteCode(league.id, owner.id);
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(reset.code).not.toBe(league.invite_code);
    expect(await joinLeague(b.id, league.invite_code)).toMatchObject({ ok: false, status: 404 });
    expect((await joinLeague(b.id, reset.code)).ok).toBe(true);
  });
});

describe('standings', () => {
  it('ranks by return since joining, so gains made before joining do not count', async () => {
    const veteran = await makeUser('Veteran');
    const newcomer = await makeUser('Newcomer');
    const artist = await makeArtist();

    // The veteran buys first; the newcomer's buy afterwards pushes the price
    // up, so the veteran is well ahead all-time…
    expect((await executeTrade(veteran.id, artist.id, 'buy', 500_000)).ok).toBe(true);
    expect((await executeTrade(newcomer.id, artist.id, 'buy', 500_000)).ok).toBe(true);

    // …but the league only started after both of those trades.
    const league = await newLeague(veteran.id, 'Fresh Start');
    await joinLeague(newcomer.id, league.invite_code);
    // Make sure joined_at is strictly after the price points just written.
    await db.prepare("UPDATE next_league_members SET joined_at = ? WHERE league_id = ?").run(new Date(Date.now() + 1000).toISOString(), league.id);

    const standings = await getLeagueStandings(league);
    expect(standings).toHaveLength(2);
    const vet = standings.find((s) => s.user.id === veteran.id)!;
    expect(vet.totalReturnPct).toBeGreaterThan(0);
    for (const s of standings) expect(s.returnSincePct).toBe(0);
    expect(standings.map((s) => s.rank)).toEqual([1, 2]);
    expect(standings.find((s) => s.isOwner)?.user.id).toBe(veteran.id);
  });

  it('counts a gain made after joining', async () => {
    const early = await makeUser('Early Backer');
    const pusher = await makeUser('Pusher');
    const artist = await makeArtist();
    const league = await newLeague(early.id, 'Live League');
    await joinLeague(pusher.id, league.invite_code);

    expect((await executeTrade(early.id, artist.id, 'buy', 300_000)).ok).toBe(true);
    expect((await executeTrade(pusher.id, artist.id, 'buy', 800_000)).ok).toBe(true);

    const standings = await getLeagueStandings(league);
    expect(standings[0].user.id).toBe(early.id);
    expect(standings[0].returnSincePct).toBeGreaterThan(0);
  });
});
