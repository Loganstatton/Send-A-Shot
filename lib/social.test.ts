import { describe, expect, it } from 'vitest';

const { createArtist, createUser, createFeedEvent, db, executeTrade, addToWatchlist, getFeedEvents, getMutedArtists, getUserById, hideFeedEvent, setFeedArtistMuted, updateUserProfile } = await import('./db');
const { getNotificationsForUser, challengeNotifications } = await import('./notifications');
const { createLeague, joinLeague, getLeagueActivity } = await import('./leagues');
const { weekStartUtc } = await import('./challenges');

let seq = 0;
const user = async (label = 'Social') => { seq++; return createUser({ name: `${label} ${seq}`, email: `social-${seq}@example.com`, password_hash: 'x' }); };
const artist = async () => { seq++; return createArtist({ name: `Social Artist ${seq}`, genre: 'Pop', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7, brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7 }); };
const kinds = (ns: { kind: string }[]) => ns.map((n) => n.kind);

describe('feed controls', () => {
  it('hiding an item and muting an artist only affect that player', async () => {
    const [me, other] = [await user(), await user()];
    const [a, b] = [await artist(), await artist()];
    const e1 = (await createFeedEvent({ eventType: 'artist_update', artistId: a.id, dedupeKey: `t1-${seq}` }))!;
    const e2 = (await createFeedEvent({ eventType: 'artist_update', artistId: b.id, dedupeKey: `t2-${seq}` }))!;
    const e3 = (await createFeedEvent({ eventType: 'artist_update', artistId: b.id, dedupeKey: `t3-${seq}` }))!;
    expect(await hideFeedEvent(me.id, e1.id)).toBe(true);
    expect(await hideFeedEvent(me.id, 999999999)).toBe(false);
    await setFeedArtistMuted(me.id, b.id, true);
    const mine = (await getFeedEvents(200, undefined, me.id)).map((e) => e.id);
    expect(mine).not.toContain(e1.id);
    expect(mine).not.toContain(e2.id);
    expect(mine).not.toContain(e3.id);
    const theirs = (await getFeedEvents(200, undefined, other.id)).map((e) => e.id);
    expect(theirs).toEqual(expect.arrayContaining([e1.id, e2.id, e3.id]));
    expect((await getMutedArtists(me.id)).map((x) => x.id)).toEqual([b.id]);
    await setFeedArtistMuted(me.id, b.id, false);
    expect((await getFeedEvents(200, undefined, me.id)).map((e) => e.id)).toContain(e2.id);
  });
});

describe('notification preferences', () => {
  it('the new social and challenge toggles save and default to on', async () => {
    const u = await user();
    expect((await getUserById(u.id))).toMatchObject({ notify_social: true, notify_challenges: true });
    await updateUserProfile(u.id, { notify_social: false, notify_challenges: false, notify_leaderboard_rank: false });
    expect((await getUserById(u.id))).toMatchObject({ notify_social: false, notify_challenges: false, notify_leaderboard_rank: false });
  });
});

describe('social notifications', () => {
  it('a league owner hears when someone joins; a backer or watcher hears about artist updates', async () => {
    const owner = await user('Owner');
    const friend = await user('Friend');
    const league = await createLeague(owner.id, 'Notify League');
    if (!league.ok) throw new Error(league.error);
    await joinLeague(friend.id, league.league.invite_code);
    const a = await artist();
    await executeTrade(owner.id, a.id, 'buy', 10_000);
    const watched = await artist();
    await addToWatchlist(owner.id, watched.id);
    await createFeedEvent({ eventType: 'artist_update', artistId: a.id, dedupeKey: `u1-${seq}` });
    await createFeedEvent({ eventType: 'artist_update', artistId: watched.id, dedupeKey: `u2-${seq}` });
    await createFeedEvent({ eventType: 'artist_update', artistId: (await artist()).id, dedupeKey: `u3-${seq}` }); // unrelated

    const ns = await getNotificationsForUser((await getUserById(owner.id))!);
    const joins = ns.filter((n) => n.kind === 'league_joined');
    expect(joins).toHaveLength(1);
    expect(joins[0].message).toContain('joined your league Notify League');
    expect(ns.filter((n) => n.kind === 'artist_update').map((n) => n.artistId).sort()).toEqual([a.id, watched.id].sort());
    expect(kinds(await getNotificationsForUser((await getUserById(friend.id))!))).not.toContain('league_joined');

    await updateUserProfile(owner.id, { notify_social: false });
    const off = await getNotificationsForUser((await getUserById(owner.id))!);
    expect(kinds(off)).not.toContain('league_joined');
    expect(kinds(off)).not.toContain('artist_update');
  });
});

describe('challenge notifications', () => {
  it("reports last week's result, and on a weekend reminds a player with a streak", async () => {
    const u = await user('Streak');
    const thisWeek = weekStartUtc(new Date()).getTime();
    // Last week: an early first backing in a new genre the Scouts rated higher = 3 challenges.
    // The week before as well, so there's a streak to keep.
    for (const weeksAgo of [1, 2]) {
      const a = await artist();
      await db.prepare('UPDATE artists SET genre = ? WHERE id = ?').run(`Genre${seq}-${weeksAgo}`, a.id);
      await executeTrade(u.id, a.id, 'buy', 10_000);
      await db.prepare('UPDATE next_founding_believers SET purchased_at = ?, next_price_cents = 100 WHERE user_id = ? AND artist_id = ?')
        .run(new Date(thisWeek - weeksAgo * 7 * 86_400_000 + 3_600_000).toISOString(), u.id, a.id);
    }
    const saturday = new Date(thisWeek + 5 * 86_400_000 + 3_600_000);
    const wednesday = new Date(thisWeek + 2 * 86_400_000 + 3_600_000);
    const sat = await challengeNotifications(u.id, saturday);
    expect(kinds(sat)).toEqual(['challenge_week', 'challenge_streak']);
    expect(sat[0].message).toContain('completed 3 of 5');
    expect(sat[1].message).toContain('3 more weekly challenges keeps your 2-week streak');
    expect(kinds(await challengeNotifications(u.id, wednesday))).toEqual(['challenge_week']); // no weekday nagging
    const idle = await user('Idle');
    expect(await challengeNotifications(idle.id, saturday)).toEqual([]);
  });
});

describe('league activity', () => {
  it("lists members' first backings since they joined, newest first", async () => {
    const owner = await user('LOwner');
    const before = await artist();
    await executeTrade(owner.id, before.id, 'buy', 10_000); // before the league existed
    await db.prepare('UPDATE next_founding_believers SET purchased_at = ? WHERE user_id = ?').run('2020-01-01T00:00:00.000Z', owner.id);
    const league = await createLeague(owner.id, 'Activity League');
    if (!league.ok) throw new Error(league.error);
    const after = await artist();
    await executeTrade(owner.id, after.id, 'buy', 10_000);
    const items = await getLeagueActivity(league.league.id);
    expect(items.map((i) => i.artistId)).toEqual([after.id]);
    expect(items[0]).toMatchObject({ userId: owner.id, backerNumber: 1 });
  });
});
