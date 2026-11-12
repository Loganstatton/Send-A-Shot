import { describe, expect, it } from 'vitest';

const { createArtist, createUser, db, executeTrade, recordPreviewListen } = await import('./db');
const { getWeeklyChallenges, STREAK_MIN, weekStartUtc } = await import('./challenges');
const { createLeague, joinLeague } = await import('./leagues');

let seq = 0;
async function makeUser(label = 'Player') {
  seq++;
  return createUser({ name: `${label} ${seq}`, email: `challenge-${seq}@example.com`, password_hash: 'x' });
}
async function makeArtist(genre: string | null, rating = 7) {
  seq++;
  return createArtist({
    name: `Challenge Artist ${seq}`, genre: genre ?? undefined, music_talent: rating, growth_velocity: rating, engagement_quality: rating,
    original_song_response: rating, brand_personality: rating, content_consistency: rating, commercial_potential: rating, professionalism: rating,
  });
}
const done = (week: Awaited<ReturnType<typeof getWeeklyChallenges>>, key: string) => week.challenges.find((c) => c.key === key)!.done;

describe('weekStartUtc', () => {
  it('is the Monday 00:00 UTC on or before the date', () => {
    expect(weekStartUtc(new Date('2026-11-12T01:00:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z'); // Thursday
    expect(weekStartUtc(new Date('2026-11-09T00:00:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z'); // Monday itself
    expect(weekStartUtc(new Date('2026-11-15T23:59:59Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z'); // Sunday
  });
});

describe('weekly challenges', () => {
  it('starts with nothing done and no streak', async () => {
    const user = await makeUser();
    const week = await getWeeklyChallenges(user.id);
    expect(week.challenges).toHaveLength(5);
    expect(week.completedCount).toBe(0);
    expect(week.streakWeeks).toBe(0);
  });

  it('an early first backing in a new genre completes Early call and New sound', async () => {
    const user = await makeUser();
    const artist = await makeArtist('Country');
    expect((await executeTrade(user.id, artist.id, 'buy', 10_000)).ok).toBe(true);
    const week = await getWeeklyChallenges(user.id);
    expect(done(week, 'early_call')).toBe(true);
    expect(done(week, 'new_genre')).toBe(true);
  });

  it('New sound needs a genre with no part you have backed before', async () => {
    const user = await makeUser();
    const pop = await makeArtist('Pop');
    const popRnb = await makeArtist('Pop/R&B');
    // An earlier Pop backing, moved to last week.
    await executeTrade(user.id, pop.id, 'buy', 10_000);
    const lastWeek = new Date(weekStartUtc(new Date()).getTime() - 2 * 86_400_000).toISOString();
    await db.prepare('UPDATE next_founding_believers SET purchased_at = ? WHERE user_id = ?').run(lastWeek, user.id);
    await executeTrade(user.id, popRnb.id, 'buy', 10_000);
    expect(done(await getWeeklyChallenges(user.id), 'new_genre')).toBe(false);
  });

  it('a backing after many others is not an Early call', async () => {
    const artist = await makeArtist('Rock');
    for (let i = 0; i < 10; i++) {
      const u = await makeUser('Crowd');
      await executeTrade(u.id, artist.id, 'buy', 10_000);
    }
    const late = await makeUser('Late');
    await executeTrade(late.id, artist.id, 'buy', 10_000);
    expect(done(await getWeeklyChallenges(late.id), 'early_call')).toBe(false);
  });

  it('Trust the Scouts uses the Score and Price recorded at the moment of backing', async () => {
    const user = await makeUser();
    const artist = await makeArtist('Electronic', 9);
    await executeTrade(user.id, artist.id, 'buy', 10_000);
    // Freshly listed artists start at the price their Score implies ("in line").
    expect(done(await getWeeklyChallenges(user.id), 'scouts_call')).toBe(false);
    // Recorded with the price well below what the Score implies.
    await db.prepare('UPDATE next_founding_believers SET next_price_cents = 100 WHERE user_id = ?').run(user.id);
    expect(done(await getWeeklyChallenges(user.id), 'scouts_call')).toBe(true);
  });

  it('Crate digger needs previews from 5 different artists this week', async () => {
    const user = await makeUser();
    const artists = await Promise.all(Array.from({ length: 5 }, () => makeArtist('Pop')));
    for (let i = 0; i < 4; i++) await recordPreviewListen(user.id, artists[i].id, 'started');
    await recordPreviewListen(user.id, artists[0].id, 'started'); // repeat doesn't count twice
    let c = (await getWeeklyChallenges(user.id)).challenges.find((x) => x.key === 'listen')!;
    expect(c).toMatchObject({ progress: 4, target: 5, done: false });
    await recordPreviewListen(user.id, artists[4].id, 'started');
    c = (await getWeeklyChallenges(user.id)).challenges.find((x) => x.key === 'listen')!;
    expect(c).toMatchObject({ progress: 5, done: true });
  });

  it('Bring a friend counts someone else joining a league you run', async () => {
    const owner = await makeUser('Owner');
    const friend = await makeUser('Friend');
    const league = await createLeague(owner.id, 'Challenge League');
    if (!league.ok) throw new Error(league.error);
    expect(done(await getWeeklyChallenges(owner.id), 'recruit')).toBe(false); // creating it yourself doesn't count
    await joinLeague(friend.id, league.league.invite_code);
    expect(done(await getWeeklyChallenges(owner.id), 'recruit')).toBe(true);
    expect(done(await getWeeklyChallenges(friend.id), 'recruit')).toBe(false);
  });

  it(`a streak counts consecutive weeks with ${STREAK_MIN}+ done, and survives a fresh week not yet played`, async () => {
    const user = await makeUser('Streaker');
    const now = new Date();
    const thisWeek = weekStartUtc(now).getTime();
    // Two previous weeks, each with an early first backing in a new genre
    // that Scouts rated higher (3 challenges), 1 and 2 weeks ago.
    for (const [weeksAgo, genre] of [[1, 'Latin'], [2, 'Indie']] as const) {
      const artist = await makeArtist(genre);
      await executeTrade(user.id, artist.id, 'buy', 10_000);
      const at = new Date(thisWeek - weeksAgo * 7 * 86_400_000 + 3600_000).toISOString();
      await db.prepare('UPDATE next_founding_believers SET purchased_at = ?, next_price_cents = 100 WHERE user_id = ? AND artist_id = ?').run(at, user.id, artist.id);
    }
    const week = await getWeeklyChallenges(user.id, now);
    expect(week.completedCount).toBe(0);
    expect(week.streakWeeks).toBe(2);

    // A gap week breaks it: shift the older one back a further week.
    await db.prepare('UPDATE next_founding_believers SET purchased_at = ? WHERE user_id = ? AND purchased_at < ?')
      .run(new Date(thisWeek - 3 * 7 * 86_400_000 + 3600_000).toISOString(), user.id, new Date(thisWeek - 7 * 86_400_000).toISOString());
    expect((await getWeeklyChallenges(user.id, now)).streakWeeks).toBe(1);
  });
});
