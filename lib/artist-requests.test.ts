import { describe, expect, it } from 'vitest';

const { createArtist, createUser, db, executeTrade, getArtist, recordPreviewListen, addToWatchlist, logEvent } = await import('./db');
const {
  createArtistRequest, getArtistProfileStats, getOpenRequestCount, getOwnerRequests, getRequestQueue, resolveArtistRequest, REQUESTS_PER_DAY,
} = await import('./artist-requests');

let seq = 0;
async function user(label = 'User') {
  seq++;
  return createUser({ name: `${label} ${seq}`, email: `areq-${seq}@example.com`, password_hash: 'x' });
}
async function artist() {
  seq++;
  return createArtist({ name: `Req Artist ${seq}`, genre: 'Pop', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7, brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7 });
}
async function claimed() {
  const owner = await user('Owner');
  const a = await artist();
  await db.prepare('UPDATE artists SET claimed_by_user_id = ? WHERE id = ?').run(owner.id, a.id);
  return { owner, a };
}
const MSG = 'Please take a look at this, thank you.';

describe('artist requests', () => {
  it('the verified artist can ask for corrections, rating reviews and opt-out; others cannot', async () => {
    const { owner, a } = await claimed();
    const stranger = await user('Stranger');
    for (const kind of ['correction', 'rating_review', 'opt_out']) {
      expect((await createArtistRequest({ artistId: a.id, userId: owner.id, kind, message: MSG })).ok).toBe(true);
    }
    expect(await createArtistRequest({ artistId: a.id, userId: stranger.id, kind: 'opt_out', message: MSG })).toMatchObject({ ok: false, status: 403 });
    expect(await createArtistRequest({ artistId: a.id, userId: stranger.id, kind: 'rating_review', message: MSG })).toMatchObject({ ok: false, status: 403 });
    expect((await createArtistRequest({ artistId: a.id, userId: stranger.id, kind: 'impersonation', message: MSG })).ok).toBe(true);
    expect(await createArtistRequest({ artistId: a.id, userId: owner.id, kind: 'impersonation', message: MSG })).toMatchObject({ ok: false, status: 400 });
    expect((await getOwnerRequests(a.id, owner.id)).every((r) => r.from_owner)).toBe(true);
  });

  it('validates the message, blocks duplicates and rate-limits', async () => {
    const a = await artist();
    const u = await user();
    expect(await createArtistRequest({ artistId: a.id, userId: u.id, kind: 'correction', message: 'short' })).toMatchObject({ ok: false, status: 400 });
    expect(await createArtistRequest({ artistId: a.id, userId: u.id, kind: 'nonsense', message: MSG })).toMatchObject({ ok: false, status: 400 });
    expect((await createArtistRequest({ artistId: a.id, userId: u.id, kind: 'correction', message: MSG })).ok).toBe(true);
    expect(await createArtistRequest({ artistId: a.id, userId: u.id, kind: 'correction', message: MSG })).toMatchObject({ ok: false, status: 409 });
    for (let i = 1; i < REQUESTS_PER_DAY; i++) await createArtistRequest({ artistId: (await artist()).id, userId: u.id, kind: 'correction', message: MSG });
    expect(await createArtistRequest({ artistId: (await artist()).id, userId: u.id, kind: 'impersonation', message: MSG })).toMatchObject({ ok: false, status: 429 });
  });

  it('staff resolve with a required note; resolving an opt-out takes the artist off NEXT', async () => {
    const { owner, a } = await claimed();
    const staff = await user('Staff');
    const r = await createArtistRequest({ artistId: a.id, userId: owner.id, kind: 'opt_out', message: MSG });
    if (!r.ok) throw new Error(r.error);
    expect(await getOpenRequestCount()).toBeGreaterThan(0);
    expect((await getRequestQueue('open')).some((q) => q.id === r.request.id)).toBe(true);
    expect(await resolveArtistRequest(r.request.id, 'resolved', '  ', { id: staff.id, name: staff.name })).toMatchObject({ ok: false, status: 400 });
    expect((await resolveArtistRequest(r.request.id, 'resolved', 'Removed as asked.', { id: staff.id, name: staff.name })).ok).toBe(true);
    expect((await getArtist(a.id))!.stage).toBe('passed');
    const mine = await getOwnerRequests(a.id, owner.id);
    expect(mine[0]).toMatchObject({ status: 'resolved', resolution_note: 'Removed as asked.' });
    expect(await resolveArtistRequest(r.request.id, 'rejected', 'again', { id: staff.id, name: staff.name })).toMatchObject({ ok: false, status: 409 });
    // A removed artist can't be newly backed.
    const fan = await user('Fan');
    expect((await executeTrade(fan.id, a.id, 'buy', 10_000)).ok).toBe(false);
  });

  it('rejecting leaves the profile unchanged', async () => {
    const { owner, a } = await claimed();
    const staff = await user('Staff');
    const r = await createArtistRequest({ artistId: a.id, userId: owner.id, kind: 'opt_out', message: MSG });
    if (!r.ok) throw new Error(r.error);
    await resolveArtistRequest(r.request.id, 'rejected', 'Need confirmation from you first.', { id: staff.id, name: staff.name });
    expect((await getArtist(a.id))!.stage).not.toBe('passed');
  });
});

describe('artist profile stats', () => {
  it('counts views, plays, listeners, watchers and backers for the window', async () => {
    const a = await artist();
    const other = await artist();
    const [u1, u2] = [await user(), await user()];
    await logEvent(u1.id, 'artist_detail_opened', { artistId: a.id });
    await logEvent(null, 'artist_detail_opened', { artistId: a.id, guest: true });
    await logEvent(u1.id, 'artist_detail_opened', { artistId: other.id });
    await recordPreviewListen(u1.id, a.id, 'started');
    await recordPreviewListen(u1.id, a.id, 'started');
    await recordPreviewListen(u2.id, a.id, 'started');
    await addToWatchlist(u1.id, a.id);
    await executeTrade(u2.id, a.id, 'buy', 10_000);
    expect(await getArtistProfileStats(a.id, 30)).toEqual({ days: 30, pageViews: 2, previewPlays: 3, listeners: 2, newWatchers: 1, newBackers: 1 });
  });
});
