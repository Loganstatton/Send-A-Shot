import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Same isolation trick as lib/db.test.ts and lib/feed-signals.test.ts.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-items-test-'));

const {
  addLogEntry, addToWatchlist, createArtist, createFeedEvent, createUser, db, executeTrade, getFoundingBelieverRecord, setFeedReaction,
} = await import('./db');
const { buildFeedAssemblyContext, buildFeedItems } = await import('./feed-items');

function makeArtist(name: string, overrides: Partial<Parameters<typeof createArtist>[0]> = {}) {
  return createArtist({
    name, music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8,
    brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8, ...overrides,
  });
}

describe('buildFeedAssemblyContext', () => {
  it('followedArtistIds is the union of watched and backed artists, and favoriteGenres reflects their genres', () => {
    const user = createUser({ name: 'Feed Ctx User', email: 'feed-ctx-user@example.com', password_hash: 'hash' });
    const watched = makeArtist('Feed Ctx Watched Artist', { genre: 'Pop' });
    const backed = makeArtist('Feed Ctx Backed Artist', { genre: 'Rock' });
    const neither = makeArtist('Feed Ctx Unrelated Artist', { genre: 'Jazz' });
    addToWatchlist(user.id, watched.id);
    const buy = executeTrade(user.id, backed.id, 'buy', 50_000);
    if (!buy.ok) throw new Error(buy.error);

    const ctx = buildFeedAssemblyContext(user.id, []);
    expect(ctx.followedArtistIds.has(watched.id)).toBe(true);
    expect(ctx.followedArtistIds.has(backed.id)).toBe(true);
    expect(ctx.followedArtistIds.has(neither.id)).toBe(false);
    expect(ctx.favoriteGenres.has('Pop')).toBe(true);
    expect(ctx.favoriteGenres.has('Rock')).toBe(true);
    expect(ctx.favoriteGenres.has('Jazz')).toBe(false);
    // Followed artists resolve in marketByArtistId even with zero events passed in.
    expect(ctx.marketByArtistId.has(watched.id)).toBe(true);
    expect(ctx.marketByArtistId.has(backed.id)).toBe(true);
  });
});

describe('buildFeedItems', () => {
  it('resolves a new_artist event into a full artist DTO with parsed metadata and the right base strength', () => {
    const user = createUser({ name: 'Feed Items User', email: 'feed-items-user@example.com', password_hash: 'hash' });
    const artist = makeArtist('Feed Items New Artist', { genre: 'Pop' });
    const event = createFeedEvent({ eventType: 'new_artist', artistId: artist.id, metadata: { genre: 'Pop', score: 80 } })!;

    const ctx = buildFeedAssemblyContext(user.id, [event]);
    const [item] = buildFeedItems([event], ctx);

    expect(item.eventType).toBe('new_artist');
    expect(item.artist?.id).toBe(artist.id);
    expect(item.artist?.name).toBe('Feed Items New Artist');
    expect(item.metadata).toEqual({ genre: 'Pop', score: 80 });
    expect(item.factors.baseStrength).toBeGreaterThan(0);
    expect(item.factors.isFollowed).toBe(false);
  });

  it('resolves an early_discovery event\'s actor into a real user', () => {
    const viewer = createUser({ name: 'Feed Items Viewer', email: 'feed-items-viewer@example.com', password_hash: 'hash' });
    const submitter = createUser({ name: 'Feed Items Submitter', email: 'feed-items-submitter@example.com', password_hash: 'hash' });
    const artist = makeArtist('Feed Items Early Discovery Artist');
    const event = createFeedEvent({ eventType: 'early_discovery', actorUserId: submitter.id, artistId: artist.id, metadata: { followersAtDiscovery: 4000 } })!;

    const ctx = buildFeedAssemblyContext(viewer.id, [event]);
    const [item] = buildFeedItems([event], ctx);
    expect(item.actor?.id).toBe(submitter.id);
    expect(item.actor?.name).toBe('Feed Items Submitter');
  });

  it('resolves an artist_update event\'s ref into the real contact_log message', () => {
    const user = createUser({ name: 'Feed Items Update User', email: 'feed-items-update@example.com', password_hash: 'hash' });
    const artist = makeArtist('Feed Items Update Artist');
    const entry = addLogEntry(artist.id, { type: 'note', message: 'Artist self-update: new single dropping soon.' });
    const event = createFeedEvent({ eventType: 'artist_update', artistId: artist.id, refType: 'contact_log', refId: entry.id })!;

    const ctx = buildFeedAssemblyContext(user.id, [event]);
    const [item] = buildFeedItems([event], ctx);
    expect(item.extra?.logMessage).toBe('Artist self-update: new single dropping soon.');
  });

  it('resolves a founding_believer_share event\'s ref into tier/rank/serial', () => {
    const sharer = createUser({ name: 'Feed Items Sharer', email: 'feed-items-sharer@example.com', password_hash: 'hash' });
    const artist = makeArtist('Feed Items Founding Artist');
    const buy = executeTrade(sharer.id, artist.id, 'buy', 50_000);
    if (!buy.ok) throw new Error(buy.error);
    const record = getFoundingBelieverRecord(sharer.id, artist.id)!;
    const event = createFeedEvent({ eventType: 'founding_believer_share', actorUserId: sharer.id, artistId: artist.id, refType: 'founding_believer', refId: record.id })!;

    const ctx = buildFeedAssemblyContext(sharer.id, [event]);
    const [item] = buildFeedItems([event], ctx);
    expect(item.extra?.founding?.discoveryRank).toBe(1); // first-ever buyer of this artist
    expect(item.extra?.founding?.tierKey).toBe('genesis');
    expect(item.extra?.founding?.serial).toContain('FB-');
  });

  it('marks isFollowed true only when the viewer watches or backs that specific artist', () => {
    const viewer = createUser({ name: 'Feed Items Follow Viewer', email: 'feed-items-follow-viewer@example.com', password_hash: 'hash' });
    const followed = makeArtist('Feed Items Followed Artist');
    const notFollowed = makeArtist('Feed Items Not Followed Artist');
    addToWatchlist(viewer.id, followed.id);
    const e1 = createFeedEvent({ eventType: 'new_artist', artistId: followed.id })!;
    const e2 = createFeedEvent({ eventType: 'new_artist', artistId: notFollowed.id })!;

    const ctx = buildFeedAssemblyContext(viewer.id, [e1, e2]);
    const items = buildFeedItems([e1, e2], ctx);
    expect(items.find((i) => i.id === e1.id)?.factors.isFollowed).toBe(true);
    expect(items.find((i) => i.id === e2.id)?.factors.isFollowed).toBe(false);
  });

  it('drops an event whose artist does not resolve in the market map instead of rendering it half-blank', () => {
    const user = createUser({ name: 'Feed Items Orphan User', email: 'feed-items-orphan@example.com', password_hash: 'hash' });
    const artist = makeArtist('Feed Items Orphan Artist');
    const event = createFeedEvent({ eventType: 'new_artist', artistId: artist.id })!;

    // A context that never resolved this artist (simulating a stale/missing row).
    const emptyCtx = {
      followedArtistIds: new Set<number>(), favoriteGenres: new Set<string>(), marketByArtistId: new Map(), scoreChanges: {},
      usersById: new Map(), reactionCountsByEventId: new Map(), viewerReactionByEventId: new Map(),
    };
    expect(buildFeedItems([event], emptyCtx)).toHaveLength(0);
  });

  it('gives a real score jump higher unusualness/momentum than a quiet artist', () => {
    const user = createUser({ name: 'Feed Items Momentum User', email: 'feed-items-momentum@example.com', password_hash: 'hash' });
    const mover = makeArtist('Feed Items Momentum Artist');
    const quiet = makeArtist('Feed Items Quiet Artist');
    const later = new Date(Date.now() + 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO score_history (artist_id, recorded_at, stage, breakout_score, music_talent, growth_velocity, engagement_quality, original_song_response, brand_personality, content_consistency, commercial_potential, professionalism)
      VALUES (?, ?, 'flagship', 95, 8, 8, 8, 8, 8, 8, 8, 8)
    `).run(mover.id, later); // 80 -> 95, well past ALERT_SCORE_THRESHOLD
    const moverEvent = createFeedEvent({ eventType: 'signal_score_up', artistId: mover.id, metadata: { changeAbs: 15, scoreAfter: 95 } })!;
    const quietEvent = createFeedEvent({ eventType: 'new_artist', artistId: quiet.id })!;

    const ctx = buildFeedAssemblyContext(user.id, [moverEvent, quietEvent]);
    const items = buildFeedItems([moverEvent, quietEvent], ctx);
    const moverItem = items.find((i) => i.id === moverEvent.id)!;
    const quietItem = items.find((i) => i.id === quietEvent.id)!;
    expect(moverItem.factors.unusualness).toBeGreaterThan(0);
    expect(moverItem.factors.momentum).toBeGreaterThan(quietItem.factors.momentum);
  });

  it('carries real reaction counts and the viewer\'s own reaction onto the DTO, feeding the engagement factor', () => {
    const viewer = createUser({ name: 'Feed Items Reaction Viewer', email: 'feed-items-reaction-viewer@example.com', password_hash: 'hash' });
    const other = createUser({ name: 'Feed Items Reaction Other', email: 'feed-items-reaction-other@example.com', password_hash: 'hash' });
    const artist = makeArtist('Feed Items Reaction Artist');
    const reacted = createFeedEvent({ eventType: 'new_artist', artistId: artist.id })!;
    const quiet = createFeedEvent({ eventType: 'new_artist', artistId: artist.id })!;

    setFeedReaction(reacted.id, viewer.id, 'fire');
    setFeedReaction(reacted.id, other.id, 'fire');

    const ctx = buildFeedAssemblyContext(viewer.id, [reacted, quiet]);
    const items = buildFeedItems([reacted, quiet], ctx);
    const reactedItem = items.find((i) => i.id === reacted.id)!;
    const quietItem = items.find((i) => i.id === quiet.id)!;

    expect(reactedItem.reactionCounts.fire).toBe(2);
    expect(reactedItem.viewerReaction).toBe('fire');
    expect(reactedItem.factors.engagement).toBeGreaterThan(0);
    expect(quietItem.reactionCounts).toEqual({ fire: 0, eyes: 0, early: 0 });
    expect(quietItem.viewerReaction).toBeNull();
    expect(quietItem.factors.engagement).toBe(0);
  });
});
