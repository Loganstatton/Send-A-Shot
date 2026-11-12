import { describe, expect, it } from 'vitest';

const { createArtist, createUser, executeTrade } = await import('./db');
const { getTrackRecord } = await import('./track-record');

let seq = 0;
async function makeUser() {
  seq++;
  return createUser({ name: `Tracker ${seq}`, email: `track-${seq}@example.com`, password_hash: 'x' });
}
async function makeArtist() {
  seq++;
  return createArtist({
    name: `Track Artist ${seq}`, genre: 'Pop', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7,
    brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7,
  });
}

describe('getTrackRecord', () => {
  it('is empty for someone who has backed nobody', async () => {
    const user = await makeUser();
    expect(await getTrackRecord(user.id)).toMatchObject({ picks: 0, upCount: 0, medianChangePct: null, laterBackers: 0, best: null });
  });

  it('counts picks that rose since backing, later backers, and the best pick', async () => {
    const scout = await makeUser();
    const hit = await makeArtist();
    const flat = await makeArtist();
    await executeTrade(scout.id, hit.id, 'buy', 10_000);
    await executeTrade(scout.id, flat.id, 'buy', 10_000);
    // Two people pile into `hit` afterwards, pushing its price up.
    for (let i = 0; i < 2; i++) {
      const fan = await makeUser();
      await executeTrade(fan.id, hit.id, 'buy', 500_000);
    }

    const tr = await getTrackRecord(scout.id);
    expect(tr.picks).toBe(2);
    expect(tr.upCount).toBe(1);
    expect(tr.laterBackers).toBe(2);
    expect(tr.best?.artistId).toBe(hit.id);
    const hitOutcome = Object.values(tr.byRecord).find((o) => o.artistId === hit.id)!;
    const flatOutcome = Object.values(tr.byRecord).find((o) => o.artistId === flat.id)!;
    expect(hitOutcome.changePct).toBeGreaterThan(0);
    expect(hitOutcome.laterBackers).toBe(2);
    expect(flatOutcome.laterBackers).toBe(0);
    // The scout's own (small) buy moved `flat` by less than the flat band.
    expect(Math.abs(flatOutcome.changePct)).toBeLessThan(0.5);
    // Median of two = their mean, rounded to one decimal.
    expect(Math.abs(tr.medianChangePct! - (hitOutcome.changePct + flatOutcome.changePct) / 2)).toBeLessThanOrEqual(0.051);
  });

  it('a later backer of the same artist gets no credit for the people before them', async () => {
    const artist = await makeArtist();
    const first = await makeUser();
    const second = await makeUser();
    await executeTrade(first.id, artist.id, 'buy', 10_000);
    await executeTrade(second.id, artist.id, 'buy', 10_000);
    expect((await getTrackRecord(first.id)).laterBackers).toBe(1);
    expect((await getTrackRecord(second.id)).laterBackers).toBe(0);
  });
});
