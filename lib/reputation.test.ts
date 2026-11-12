import { describe, expect, it } from 'vitest';

const { createArtist, createUser, db, executeTrade } = await import('./db');
const { getReputation, getReputationLeaderboard, MISS_AFTER_DAYS, MISS_PENALTY, pickCredit, positionWeight, QUALIFYING_MIN_BACKINGS } = await import('./reputation');
const { getChallengeLeaderboard } = await import('./challenges');

let seq = 0;
async function makeUser(label = 'Rep') {
  seq++;
  return createUser({ name: `${label} ${seq}`, email: `rep-${seq}@example.com`, password_hash: 'x' });
}
async function makeArtist() {
  seq++;
  return createArtist({
    name: `Rep Artist ${seq}`, genre: 'Pop', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7,
    brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7,
  });
}
const back = (userId: number, artistId: number) => executeTrade(userId, artistId, 'buy', 5_000);

// A "real" player: has backed QUALIFYING_MIN_BACKINGS different artists.
async function qualifiedPlayer() {
  const u = await makeUser('Real');
  for (let i = 0; i < QUALIFYING_MIN_BACKINGS; i++) await back(u.id, (await makeArtist()).id);
  return u;
}

describe('pick credit', () => {
  it('weights early positions more and grows slowly with followers', () => {
    expect(positionWeight(1)).toBe(1);
    expect(positionWeight(10)).toBe(1);
    expect(positionWeight(11)).toBe(0.5);
    expect(positionWeight(51)).toBe(0.25);
    expect(pickCredit(1, 0)).toBe(0);
    expect(pickCredit(1, 1)).toBe(1);
    expect(pickCredit(1, 3)).toBe(2);
    expect(pickCredit(20, 3)).toBe(1);
    expect(pickCredit(1, 1000)).toBeLessThan(10.0);
  });
});

describe('discovery reputation', () => {
  it('an early pick earns credit for qualifying players who back it later', async () => {
    const scout = await makeUser('Scout');
    const artist = await makeArtist();
    await back(scout.id, artist.id);
    for (let i = 0; i < 3; i++) await back((await qualifiedPlayer()).id, artist.id);
    const rep = await getReputation(scout.id);
    expect(rep.followers).toBe(3);
    expect(rep.reputation).toBe(2); // log2(1 + 3) at full weight
  });

  it('throwaway accounts that back only your artist do not count', async () => {
    const scout = await makeUser('Gamer');
    const artist = await makeArtist();
    await back(scout.id, artist.id);
    for (let i = 0; i < 5; i++) await back((await makeUser('Sock')).id, artist.id);
    expect((await getReputation(scout.id)).reputation).toBe(0);
  });

  it('backing an artist late, after the crowd, earns nothing', async () => {
    const artist = await makeArtist();
    for (let i = 0; i < 4; i++) await back((await qualifiedPlayer()).id, artist.id);
    const late = await makeUser('Late');
    await back(late.id, artist.id);
    expect((await getReputation(late.id)).reputation).toBe(0);
  });

  it('being first on an artist nobody else backs earns nothing', async () => {
    const loner = await makeUser('Loner');
    await back(loner.id, (await makeArtist()).id);
    expect((await getReputation(loner.id)).reputation).toBe(0);
  });

  it(`a pick nobody followed for ${MISS_AFTER_DAYS} days costs ${MISS_PENALTY}; a fresh unfollowed pick does not`, async () => {
    const scout = await makeUser('Sprayer');
    const hit = await makeArtist();
    await back(scout.id, hit.id);
    for (let i = 0; i < 3; i++) await back((await qualifiedPlayer()).id, hit.id); // +2.0
    const old1 = await makeArtist();
    const old2 = await makeArtist();
    const fresh = await makeArtist();
    for (const a of [old1, old2, fresh]) await back(scout.id, a.id);
    const longAgo = new Date(Date.now() - (MISS_AFTER_DAYS + 1) * 86_400_000).toISOString();
    await db.prepare('UPDATE next_founding_believers SET purchased_at = ? WHERE user_id = ? AND artist_id IN (?, ?)').run(longAgo, scout.id, old1.id, old2.id);
    const rep = await getReputation(scout.id);
    expect(rep.misses).toBe(2);
    expect(rep.reputation).toBe(2 - 2 * MISS_PENALTY);
  });

  it('never goes below zero', async () => {
    const scout = await makeUser('AllMiss');
    const a = await makeArtist();
    await back(scout.id, a.id);
    await db.prepare('UPDATE next_founding_believers SET purchased_at = ? WHERE user_id = ?').run('2020-01-01T00:00:00.000Z', scout.id);
    expect((await getReputation(scout.id)).reputation).toBe(0);
  });

  it('the leaderboard needs 3+ picks and some credit, best first', async () => {
    const strong = await makeUser('Strong');
    const weak = await makeUser('Weak');
    const fewPicks = await makeUser('FewPicks');
    const artists = await Promise.all(Array.from({ length: 3 }, () => makeArtist()));
    for (const a of artists) { await back(strong.id, a.id); await back(weak.id, a.id); }
    const solo = await makeArtist();
    await back(fewPicks.id, solo.id);
    const followers = await Promise.all(Array.from({ length: 2 }, () => qualifiedPlayer()));
    for (const f of followers) { for (const a of artists) await back(f.id, a.id); await back(f.id, solo.id); }

    const board = await getReputationLeaderboard();
    const ids = board.map((e) => e.userId);
    expect(ids.indexOf(strong.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(strong.id)).toBeLessThan(ids.indexOf(weak.id)); // strong was first on each, weak second
    expect(ids).not.toContain(fewPicks.id); // only 1 pick
    const s = board.find((e) => e.userId === strong.id)!;
    expect(s.creditedPicks).toBe(3);
    expect(board.map((e) => e.rank)).toEqual(board.map((_, i) => i + 1));
  });
});

describe('challenge leaderboard', () => {
  it('lists active players by streak then this week, skipping the idle', async () => {
    const active = await makeUser('Active');
    await back(active.id, (await makeArtist()).id); // Early call + New sound
    const idle = await makeUser('Idle');
    const board = await getChallengeLeaderboard();
    const mine = board.find((e) => e.userId === active.id);
    expect(mine?.completedThisWeek).toBeGreaterThanOrEqual(2);
    expect(board.find((e) => e.userId === idle.id)).toBeUndefined();
  });
});
