import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Same isolation trick as lib/db.test.ts and lib/feed-signals.test.ts.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-items-test-'));

const {
  addLogEntry, addToWatchlist, createArtist, createFeedEvent, createUser, createUserTakePost, db, deleteUserTakePost, executeTrade,
  getFoundingBelieverRecord, hideUserTakePost, setFeedReaction,
} = await import('./db');
const { buildFeedAssemblyContext, buildFeedItems } = await import('./feed-items');

async function makeArtist(name: string, overrides: Partial<Parameters<typeof createArtist>[0]> = {}) {
  return await createArtist({
    name, music_talent: 8, growth_velocity: 8, growth_velocity_pct: 32, engagement_quality: 8, engagement_rate_pct: 16,
    original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8, ...overrides,
  });
}

describe('buildFeedAssemblyContext', () => {
  it('followedArtistIds is the union of watched and backed artists, and favoriteGenres reflects their genres', async () => {
    const user = await createUser({ name: 'Feed Ctx User', email: 'feed-ctx-user@example.com', password_hash: 'hash' });
    const watched = await makeArtist('Feed Ctx Watched Artist', { genre: 'Pop' });
    const backed = await makeArtist('Feed Ctx Backed Artist', { genre: 'Rock' });
    const neither = await makeArtist('Feed Ctx Unrelated Artist', { genre: 'Jazz' });
    await addToWatchlist(user.id, watched.id);
    const buy = await executeTrade(user.id, backed.id, 'buy', 50_000);
    if (!buy.ok) throw new Error(buy.error);

    const ctx = await buildFeedAssemblyContext(user.id, []);
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
  it('resolves a new_artist event into a full artist DTO with parsed metadata and the right base strength', async () => {
    const user = await createUser({ name: 'Feed Items User', email: 'feed-items-user@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Feed Items New Artist', { genre: 'Pop' });
    const event = (await createFeedEvent({ eventType: 'new_artist', artistId: artist.id, metadata: { genre: 'Pop', score: 80 } }))!;

    const ctx = await buildFeedAssemblyContext(user.id, [event]);
    const [item] = await buildFeedItems([event], ctx);

    expect(item.eventType).toBe('new_artist');
    expect(item.artist?.id).toBe(artist.id);
    expect(item.artist?.name).toBe('Feed Items New Artist');
    expect(item.metadata).toEqual({ genre: 'Pop', score: 80 });
    expect(item.factors.baseStrength).toBeGreaterThan(0);
    expect(item.factors.isFollowed).toBe(false);
  });

  it('resolves an early_discovery event\'s actor into a real user', async () => {
    const viewer = await createUser({ name: 'Feed Items Viewer', email: 'feed-items-viewer@example.com', password_hash: 'hash' });
    const submitter = await createUser({ name: 'Feed Items Submitter', email: 'feed-items-submitter@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Feed Items Early Discovery Artist');
    const event = (await createFeedEvent({ eventType: 'early_discovery', actorUserId: submitter.id, artistId: artist.id, metadata: { followersAtDiscovery: 4000 } }))!;

    const ctx = await buildFeedAssemblyContext(viewer.id, [event]);
    const [item] = await buildFeedItems([event], ctx);
    expect(item.actor?.id).toBe(submitter.id);
    expect(item.actor?.name).toBe('Feed Items Submitter');
  });

  it('resolves an artist_update event\'s ref into the real contact_log message', async () => {
    const user = await createUser({ name: 'Feed Items Update User', email: 'feed-items-update@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Feed Items Update Artist');
    const entry = await addLogEntry(artist.id, { type: 'note', message: 'Artist self-update: new single dropping soon.' });
    const event = (await createFeedEvent({ eventType: 'artist_update', artistId: artist.id, refType: 'contact_log', refId: entry.id }))!;

    const ctx = await buildFeedAssemblyContext(user.id, [event]);
    const [item] = await buildFeedItems([event], ctx);
    expect(item.extra?.logMessage).toBe('Artist self-update: new single dropping soon.');
  });

  it('resolves a founding_believer_share event\'s ref into tier/rank/serial', async () => {
    const sharer = await createUser({ name: 'Feed Items Sharer', email: 'feed-items-sharer@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Feed Items Founding Artist');
    const buy = await executeTrade(sharer.id, artist.id, 'buy', 50_000);
    if (!buy.ok) throw new Error(buy.error);
    const record = (await getFoundingBelieverRecord(sharer.id, artist.id))!;
    const event = (await createFeedEvent({ eventType: 'founding_believer_share', actorUserId: sharer.id, artistId: artist.id, refType: 'founding_believer', refId: record.id }))!;

    const ctx = await buildFeedAssemblyContext(sharer.id, [event]);
    const [item] = await buildFeedItems([event], ctx);
    expect(item.extra?.founding?.discoveryRank).toBe(1); // first-ever buyer of this artist
    expect(item.extra?.founding?.tierKey).toBe('genesis');
    expect(item.extra?.founding?.serial).toContain('FB-');
  });

  it('marks isFollowed true only when the viewer watches or backs that specific artist', async () => {
    const viewer = await createUser({ name: 'Feed Items Follow Viewer', email: 'feed-items-follow-viewer@example.com', password_hash: 'hash' });
    const followed = await makeArtist('Feed Items Followed Artist');
    const notFollowed = await makeArtist('Feed Items Not Followed Artist');
    await addToWatchlist(viewer.id, followed.id);
    const e1 = (await createFeedEvent({ eventType: 'new_artist', artistId: followed.id }))!;
    const e2 = (await createFeedEvent({ eventType: 'new_artist', artistId: notFollowed.id }))!;

    const ctx = await buildFeedAssemblyContext(viewer.id, [e1, e2]);
    const items = await buildFeedItems([e1, e2], ctx);
    expect(items.find((i) => i.id === e1.id)?.factors.isFollowed).toBe(true);
    expect(items.find((i) => i.id === e2.id)?.factors.isFollowed).toBe(false);
  });

  it('drops an event whose artist does not resolve in the market map instead of rendering it half-blank', async () => {
    const user = await createUser({ name: 'Feed Items Orphan User', email: 'feed-items-orphan@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Feed Items Orphan Artist');
    const event = (await createFeedEvent({ eventType: 'new_artist', artistId: artist.id }))!;

    // A context that never resolved this artist (simulating a stale/missing row).
    const emptyCtx = {
      viewerUserId: user.id, followedArtistIds: new Set<number>(), favoriteGenres: new Set<string>(), marketByArtistId: new Map(), scoreChanges: {},
      usersById: new Map(), reactionCountsByEventId: new Map(), viewerReactionByEventId: new Map(), userPostsByRefId: new Map(),
    };
    expect(await buildFeedItems([event], emptyCtx)).toHaveLength(0);
  });

  it('gives a real score jump higher unusualness/momentum than a quiet artist', async () => {
    const user = await createUser({ name: 'Feed Items Momentum User', email: 'feed-items-momentum@example.com', password_hash: 'hash' });
    const mover = await makeArtist('Feed Items Momentum Artist');
    const quiet = await makeArtist('Feed Items Quiet Artist');
    const later = new Date(Date.now() + 60 * 1000).toISOString();
    await db.prepare(`
      INSERT INTO score_history (artist_id, recorded_at, stage, breakout_score, music_talent, growth_velocity, engagement_quality, original_song_response, brand_personality, content_consistency, commercial_potential, professionalism)
      VALUES (?, ?, 'flagship', 95, 8, 8, 8, 8, 8, 8, 8, 8)
    `).run(mover.id, later); // 80 -> 95, well past ALERT_SCORE_THRESHOLD
    const moverEvent = (await createFeedEvent({ eventType: 'signal_score_up', artistId: mover.id, metadata: { changeAbs: 15, scoreAfter: 95 } }))!;
    const quietEvent = (await createFeedEvent({ eventType: 'new_artist', artistId: quiet.id }))!;

    const ctx = await buildFeedAssemblyContext(user.id, [moverEvent, quietEvent]);
    const items = await buildFeedItems([moverEvent, quietEvent], ctx);
    const moverItem = items.find((i) => i.id === moverEvent.id)!;
    const quietItem = items.find((i) => i.id === quietEvent.id)!;
    expect(moverItem.factors.unusualness).toBeGreaterThan(0);
    expect(moverItem.factors.momentum).toBeGreaterThan(quietItem.factors.momentum);
  });

  it('carries real reaction counts and the viewer\'s own reaction onto the DTO, feeding the engagement factor', async () => {
    const viewer = await createUser({ name: 'Feed Items Reaction Viewer', email: 'feed-items-reaction-viewer@example.com', password_hash: 'hash' });
    const other = await createUser({ name: 'Feed Items Reaction Other', email: 'feed-items-reaction-other@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Feed Items Reaction Artist');
    const reacted = (await createFeedEvent({ eventType: 'new_artist', artistId: artist.id }))!;
    const quiet = (await createFeedEvent({ eventType: 'new_artist', artistId: artist.id }))!;

    await setFeedReaction(reacted.id, viewer.id, 'fire');
    await setFeedReaction(reacted.id, other.id, 'fire');

    const ctx = await buildFeedAssemblyContext(viewer.id, [reacted, quiet]);
    const items = await buildFeedItems([reacted, quiet], ctx);
    const reactedItem = items.find((i) => i.id === reacted.id)!;
    const quietItem = items.find((i) => i.id === quiet.id)!;

    expect(reactedItem.reactionCounts.fire).toBe(2);
    expect(reactedItem.viewerReaction).toBe('fire');
    expect(reactedItem.factors.engagement).toBeGreaterThan(0);
    expect(quietItem.reactionCounts).toEqual({ fire: 0, eyes: 0, early: 0 });
    expect(quietItem.viewerReaction).toBeNull();
    expect(quietItem.factors.engagement).toBe(0);
  });

  it('resolves a user_take event into real post body + author, with isOwn set correctly for both the author and another viewer', async () => {
    const author = await createUser({ name: 'Feed Items Take Author', email: 'feed-items-take-author@example.com', password_hash: 'hash' });
    const otherViewer = await createUser({ name: 'Feed Items Take Other Viewer', email: 'feed-items-take-other-viewer@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Feed Items Take Artist');
    const result = await createUserTakePost(author.id, artist.id, 'I think this artist is massively undervalued.');
    if (!result.ok) throw new Error('expected ok');

    const authorCtx = await buildFeedAssemblyContext(author.id, [result.event]);
    const [asAuthor] = await buildFeedItems([result.event], authorCtx);
    expect(asAuthor.extra?.userPost?.body).toBe('I think this artist is massively undervalued.');
    expect(asAuthor.extra?.userPost?.isOwn).toBe(true);
    expect(asAuthor.actor?.id).toBe(author.id);

    const otherCtx = await buildFeedAssemblyContext(otherViewer.id, [result.event]);
    const [asOther] = await buildFeedItems([result.event], otherCtx);
    expect(asOther.extra?.userPost?.isOwn).toBe(false);
  });

  it('drops a user_take item from the feed once its post is deleted or hidden, for every viewer', async () => {
    const author = await createUser({ name: 'Feed Items Take Deleted Author', email: 'feed-items-take-deleted@example.com', password_hash: 'hash' });
    const admin = await createUser({ name: 'Feed Items Take Admin', email: 'feed-items-take-admin@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Feed Items Take Deleted Artist');

    const deletedResult = await createUserTakePost(author.id, artist.id, 'Will be deleted.');
    const hiddenResult = await createUserTakePost(author.id, artist.id, 'Will be hidden.');
    if (!deletedResult.ok || !hiddenResult.ok) throw new Error('expected ok');
    await deleteUserTakePost(author.id, deletedResult.post.id);
    await hideUserTakePost(admin.id, hiddenResult.post.id);

    const ctx = await buildFeedAssemblyContext(author.id, [deletedResult.event, hiddenResult.event]);
    expect(await buildFeedItems([deletedResult.event, hiddenResult.event], ctx)).toHaveLength(0);
  });

  it('a user_take with no ref_id or an unresolvable post is dropped rather than rendered blank', async () => {
    const user = await createUser({ name: 'Feed Items Take Orphan User', email: 'feed-items-take-orphan@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Feed Items Take Orphan Artist');
    const orphanEvent = (await createFeedEvent({ eventType: 'user_take', actorUserId: user.id, artistId: artist.id, refType: 'user_post', refId: 999_999 }))!;

    const ctx = await buildFeedAssemblyContext(user.id, [orphanEvent]);
    expect(await buildFeedItems([orphanEvent], ctx)).toHaveLength(0);
  });
});
