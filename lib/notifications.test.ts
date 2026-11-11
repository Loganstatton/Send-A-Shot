import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Same isolation trick as lib/db.test.ts: DATA_DIR must be set before
// lib/db.ts (imported transitively by lib/notifications.ts) is ever
// imported, so this runs against a throwaway SQLite file.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'notifications-test-'));
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;

const {
  addToWatchlist, createArtist, createUser, db, executeTrade, getReadNotificationKeys, getUserById,
  markNotificationRead, updateUserProfile,
} = await import('./db');
const { getNotificationsForUser, maybeSendNotificationDigestEmail } = await import('./notifications');

async function makeArtist(name: string, overrides: Partial<Parameters<typeof createArtist>[0]> = {}) {
  return await createArtist({
    name, music_talent: 8, growth_velocity: 8, growth_velocity_pct: 32, engagement_quality: 8, engagement_rate_pct: 16,
    original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8, ...overrides,
  });
}

describe('getNotificationsForUser — watchlist moves', () => {
  it('flags a watched artist whose Score jumped significantly since it was added, only when notify_watchlist_moves is on', async () => {
    const user = await createUser({ name: 'Notif Watcher', email: 'notif-watcher@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Notif Score Artist');
    await addToWatchlist(user.id, artist.id);
    await db.prepare('UPDATE artists SET music_talent = 10 WHERE id = ?').run(artist.id); // +5 score, crosses ALERT_SCORE_THRESHOLD
    // Forced 10 minutes into the future (JS-computed, matching the app's
    // own ISO format exactly) rather than relying on real elapsed time —
    // two calls this close together can land in the same millisecond as
    // the watch itself, which is the exact race the Watchlist section's
    // own tests already had to guard against for this same lookup.
    const later = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await db.prepare(`
      INSERT INTO score_history (artist_id, recorded_at, stage, breakout_score, music_talent, growth_velocity, engagement_quality, original_song_response, brand_personality, content_consistency, commercial_potential, professionalism)
      VALUES (?, ?, 'watchlist', 85, 10, 8, 8, 8, 8, 8, 8, 8)
    `).run(artist.id, later);

    const on = await getNotificationsForUser((await getUserById(user.id))!);
    expect(on.some((n) => n.kind === 'watchlist_score' && n.artistId === artist.id)).toBe(true);

    await updateUserProfile(user.id, { notify_watchlist_moves: false });
    const off = await getNotificationsForUser((await getUserById(user.id))!);
    expect(off.some((n) => n.kind === 'watchlist_score')).toBe(false);
  });

  it('flags a watched artist whose Price moved significantly since it was added', async () => {
    const user = await createUser({ name: 'Notif Price Watcher', email: 'notif-price@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Notif Price Artist');
    await addToWatchlist(user.id, artist.id);
    const mover = await createUser({ name: 'Notif Price Mover', email: 'notif-price-mover@example.com', password_hash: 'hash' });
    await db.prepare('UPDATE users SET next_credits_cents = 5000000 WHERE id = ?').run(mover.id); // $50,000 — enough to fund the buy below
    // priceImpactPct = (creditsAmountCents / 1,000,000) * 0.05 (see
    // lib/next-market.ts) — needs > $20,000 to clear the 10% threshold.
    const buy = await executeTrade(mover.id, artist.id, 'buy', 3_000_000); // $30,000 -> ~15% impact
    if (!buy.ok) throw new Error(buy.error);
    // Same race as above, for the price point this buy just wrote.
    await db.prepare(`
      UPDATE next_price_history SET recorded_at = ?
      WHERE id = (SELECT MAX(id) FROM next_price_history WHERE artist_id = ?)
    `).run(new Date(Date.now() + 10 * 60 * 1000).toISOString(), artist.id);

    const notifications = await getNotificationsForUser((await getUserById(user.id))!);
    expect(notifications.some((n) => n.kind === 'watchlist_price' && n.artistId === artist.id)).toBe(true);
  });

  it('does not flag an untouched watched artist with a real score/price move', async () => {
    const user = await createUser({ name: 'Notif Quiet Watcher', email: 'notif-quiet@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Notif Quiet Artist');
    await addToWatchlist(user.id, artist.id);

    // watchlist_sentiment and watchlist_trending are excluded here — both
    // are state-based reads of the whole market (fair-value/undervalued/
    // overheated, or "in today's top 5 movers"), and in an isolated test
    // DB with only one or two artists total, an untouched artist can
    // trivially qualify for "top 5" or land outside the fair-value band
    // by construction, not because anything actually moved.
    const notifications = await getNotificationsForUser((await getUserById(user.id))!);
    expect(notifications.some((n) => n.artistId === artist.id && (n.kind === 'watchlist_score' || n.kind === 'watchlist_price' || n.kind === 'watchlist_growth'))).toBe(false);
  });
});

describe('getNotificationsForUser — new artists, Founding Believer milestones, portfolio milestones', () => {
  it('flags a new artist this week only in a genre the Scout has actually backed before', async () => {
    const user = await createUser({ name: 'Notif Genre Scout', email: 'notif-genre@example.com', password_hash: 'hash' });
    const backedGenreArtist = await makeArtist('Notif Backed Genre Artist', { genre: 'Pop' });
    const buy = await executeTrade(user.id, backedGenreArtist.id, 'buy', 10_000);
    if (!buy.ok) throw new Error(buy.error);

    const newInFollowedGenre = await makeArtist('Notif New Pop Artist', { genre: 'Pop' });
    const newInOtherGenre = await makeArtist('Notif New Jazz Artist', { genre: 'Jazz' });

    const notifications = await getNotificationsForUser((await getUserById(user.id))!);
    const artistIds = notifications.filter((n) => n.kind === 'new_artist_genre').map((n) => n.artistId);
    expect(artistIds).toContain(newInFollowedGenre.id);
    expect(artistIds).not.toContain(newInOtherGenre.id);
  });

  it('flags a Founding Believer milestone once the artist crosses a backer-count tier the Scout joined before', async () => {
    const user = await createUser({ name: 'Notif Founding Scout', email: 'notif-founding@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Notif Milestone Artist');
    const buy = await executeTrade(user.id, artist.id, 'buy', 10_000); // discovery_rank 1
    if (!buy.ok) throw new Error(buy.error);

    // Synthesize 9 more backers directly — the notification only reads the
    // total count, not each backer's own trade history. Real distinct
    // users are required: next_founding_believers has a UNIQUE(user_id,
    // artist_id) constraint plus an FK on user_id.
    for (let i = 0; i < 9; i++) {
      const backer = await createUser({ name: `Synthetic Backer ${i}`, email: `synthetic-backer-${i}@example.com`, password_hash: 'hash' });
      await db.prepare(`
        INSERT INTO next_founding_believers (user_id, artist_id, purchased_at, next_score, next_price_cents, discovery_rank)
        VALUES (?, ?, ?, 80, 1000, ?)
      `).run(backer.id, artist.id, new Date().toISOString(), i + 2);
    }

    const notifications = await getNotificationsForUser((await getUserById(user.id))!);
    const milestone = notifications.find((n) => n.kind === 'founding_believer_milestone' && n.artistId === artist.id);
    expect(milestone).toBeDefined();
    expect(milestone!.message).toContain('10');

    // Push past the 25 tier too — should now report 25 (the highest tier
    // reached), and still only ONE notification for this artist, not one
    // per tier crossed on the way there.
    for (let i = 0; i < 15; i++) {
      const backer = await createUser({ name: `Synthetic Backer B${i}`, email: `synthetic-backer-b${i}@example.com`, password_hash: 'hash' });
      await db.prepare(`
        INSERT INTO next_founding_believers (user_id, artist_id, purchased_at, next_score, next_price_cents, discovery_rank)
        VALUES (?, ?, ?, 80, 1000, ?)
      `).run(backer.id, artist.id, new Date().toISOString(), i + 11);
    }
    const laterNotifications = await getNotificationsForUser((await getUserById(user.id))!);
    const laterMilestones = laterNotifications.filter((n) => n.kind === 'founding_believer_milestone' && n.artistId === artist.id);
    expect(laterMilestones).toHaveLength(1);
    expect(laterMilestones[0].message).toContain('25');
  });

  it('flags a portfolio milestone once all-time return crosses a tier, in either direction', async () => {
    const winner = await createUser({ name: 'Notif Portfolio Winner', email: 'notif-winner@example.com', password_hash: 'hash' });
    await db.prepare('UPDATE users SET next_credits_cents = 1300000 WHERE id = ?').run(winner.id); // +30%, zero holdings so this is exact

    const loser = await createUser({ name: 'Notif Portfolio Loser', email: 'notif-loser@example.com', password_hash: 'hash' });
    await db.prepare('UPDATE users SET next_credits_cents = 700000 WHERE id = ?').run(loser.id); // -30%

    const flat = await createUser({ name: 'Notif Portfolio Flat', email: 'notif-flat@example.com', password_hash: 'hash' });

    expect((await getNotificationsForUser((await getUserById(winner.id))!)).some((n) => n.kind === 'portfolio_milestone' && n.message.includes('+25%'))).toBe(true);
    expect((await getNotificationsForUser((await getUserById(loser.id))!)).some((n) => n.kind === 'portfolio_milestone' && n.message.includes('-25%'))).toBe(true);
    expect((await getNotificationsForUser((await getUserById(flat.id))!)).some((n) => n.kind === 'portfolio_milestone')).toBe(false);
  });
});

describe('getNotificationsForUser — read state', () => {
  it('marks a notification read without removing it from the list', async () => {
    const user = await createUser({ name: 'Notif Reader Scout', email: 'notif-reader-scout@example.com', password_hash: 'hash' });
    await db.prepare('UPDATE users SET next_credits_cents = 1500000 WHERE id = ?').run(user.id);

    const before = await getNotificationsForUser((await getUserById(user.id))!);
    const milestone = before.find((n) => n.kind === 'portfolio_milestone')!;
    expect(milestone.read).toBe(false);

    await markNotificationRead(user.id, milestone.key);
    const after = await getNotificationsForUser((await getUserById(user.id))!);
    const sameMilestone = after.find((n) => n.key === milestone.key)!;
    expect(sameMilestone.read).toBe(true);
    expect(after).toHaveLength(before.length); // still present, just marked read
    expect((await getReadNotificationKeys(user.id)).has(milestone.key)).toBe(true);
  });
});

describe('maybeSendNotificationDigestEmail — guarded no-ops', () => {
  it('does nothing when the user has not opted into email notifications', async () => {
    const user = await createUser({ name: 'Notif No Email', email: 'notif-no-email@example.com', password_hash: 'hash' });
    await maybeSendNotificationDigestEmail((await getUserById(user.id))!, []);
    expect((await getUserById(user.id))!.notifications_emailed_through).toBeFalsy();
  });

  it('does nothing when email is not configured on the server, even if the user opted in', async () => {
    const user = await createUser({ name: 'Notif Unconfigured Email', email: 'notif-unconfigured@example.com', password_hash: 'hash' });
    await updateUserProfile(user.id, { email_notifications_enabled: true });
    const notifications = await getNotificationsForUser((await getUserById(user.id))!);
    await maybeSendNotificationDigestEmail((await getUserById(user.id))!, notifications);
    // No RESEND_API_KEY/EMAIL_FROM in this test environment -> emailConfigured() is false -> no-op.
    expect((await getUserById(user.id))!.notifications_emailed_through).toBeFalsy();
  });
});
